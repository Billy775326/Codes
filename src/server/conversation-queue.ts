import { AppError } from '../shared/errors.js';
import type { Attachment, Operation, QueuePayload } from '../shared/types.js';
import type { MessageQueue } from './message-queue.js';
import { legacyQueueReview } from './queue-store.js';
import type { Store } from './store.js';

interface QueueExecution {
  isManaging(id: string): boolean;
  requireAdmission(): void;
  checkSteering(id: string): Promise<void>;
  steer(
    id: string,
    operationId: string,
    expectedTurnId: string,
    prompt: string,
    attachments: Attachment[],
  ): Promise<Operation>;
}

/** Applies conversation queue commands. MessageQueue schedules automatic dispatch. */
export class ConversationQueue {
  constructor(
    private readonly store: Store,
    private readonly queue: MessageQueue,
    private readonly execution: QueueExecution,
  ) {}

  queueState(id: string) {
    if (!this.store.thread(id))
      throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
    return this.store.queue.state(id);
  }
  async enqueue(id: string, messageId: string, payload: QueuePayload) {
    this.execution.requireAdmission();
    const saved = this.store.thread(id);
    if (!saved) throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
    if (saved.archived || saved.managementPending || this.execution.isManaging(id))
      throw new AppError(
        'MANAGEMENT_BUSY',
        'Restore or finish managing the conversation before queueing messages.',
        409,
      );
    if (Buffer.byteLength(payload.text) > 100_000)
      throw new AppError('INPUT_LIMIT', 'The queued text exceeds 100 KB.');
    if (this.store.operation(messageId) && !this.store.queue.get(messageId))
      throw new AppError(
        'OPERATION_CONFLICT',
        'This operation ID belongs to a different task.',
        409,
      );
    this.store.queue.add(messageId, id, payload);
    if (this.uncertainExecution(id))
      this.store.queue.pauseForReview(
        id,
        'An execution result is unknown. Check result before resuming.',
      );
    this.queue.notify(id);
    this.queue.wake(id);
    return this.queueState(id);
  }
  editQueued(id: string, messageId: string, text: string, removeFileReferences = false) {
    this.queueState(id);
    this.store.queue.edit(messageId, id, text, removeFileReferences);
    this.queue.notify(id);
    return this.queueState(id);
  }
  cancelQueued(id: string, messageId: string) {
    this.queueState(id);
    this.store.queue.cancel(messageId, id);
    this.queue.notify(id);
    this.queue.wake(id);
    return this.queueState(id);
  }
  async steerQueued(id: string, messageId: string, expectedTurnId: string) {
    const entry = this.store.queue.get(messageId);
    if (!entry || entry.threadId !== id)
      throw new AppError('NOT_FOUND', 'Queued message not found.', 404);
    const operation = this.store.operation(messageId);
    if (operation?.kind === 'steer') {
      await this.execution.steer(id, messageId, expectedTurnId, entry.text, entry.attachments);
      return this.queueState(id);
    }
    if (entry.state !== 'queued')
      throw new AppError('QUEUE_STARTED', 'This message has already started.', 409);
    if (this.store.queue.state(id).reason === legacyQueueReview)
      throw new AppError('QUEUE_REVIEW', legacyQueueReview, 409);
    await this.execution.checkSteering(id);
    this.execution.requireAdmission();
    // Readiness awaits I/O; a completed turn may already have dispatched this entry.
    if (this.store.queue.get(messageId)?.state !== 'queued')
      throw new AppError('QUEUE_STARTED', 'This message has already started.', 409);
    this.store.queue.set(messageId, 'dispatching');
    this.queue.notify(id);
    try {
      const receipt = await this.execution.steer(
        id,
        messageId,
        expectedTurnId,
        entry.text,
        entry.attachments,
      );
      const latest = this.store.queue.get(messageId);
      if (latest?.state === 'dispatching')
        this.store.queue.set(
          messageId,
          receipt.state === 'completed'
            ? 'completed'
            : receipt.state === 'unknown'
              ? 'unknown'
              : receipt.state === 'failed'
                ? 'failed'
                : 'sent',
          receipt.error,
        );
    } catch (error) {
      if (error instanceof AppError && error.code === 'FILE_REFERENCE_CHANGED') {
        this.store.queue.set(messageId, 'queued', error.message);
        this.store.queue.pauseForReview(id, error.message);
        throw error;
      }
      if (
        error instanceof AppError &&
        ['MAINTENANCE_ACTIVE', 'STEER_UNAVAILABLE', 'STEER_LIMIT'].includes(error.code)
      ) {
        this.store.queue.set(messageId, 'queued');
        throw error;
      }
      const receipt = this.store.operation(messageId);
      this.store.queue.set(
        messageId,
        receipt?.state === 'unknown' ? 'unknown' : 'failed',
        error instanceof Error ? error.message : 'Follow-up dispatch failed.',
      );
      this.store.queue.pauseForReview(id, 'A follow-up needs review before continuing.');
      throw error;
    } finally {
      this.queue.notify(id);
    }
    return this.queueState(id);
  }
  private uncertainExecution(id: string) {
    return (
      this.store.active(id)?.state === 'unknown' ||
      this.store.steers(id).some((entry) => entry.state === 'unknown')
    );
  }
  controlQueue(id: string, paused: boolean) {
    const state = this.queueState(id);
    if (
      !paused &&
      (this.uncertainExecution(id) ||
        state.items.some((row) => ['unknown', 'failed'].includes(row.state)))
    )
      throw new AppError(
        'QUEUE_REVIEW',
        'Check unknown results and remove failed messages before resuming.',
        409,
      );
    if (paused) this.store.queue.pause(id);
    else this.store.queue.resume(id);
    this.queue.notify(id);
    if (!paused) this.queue.wake(id);
    return this.queueState(id);
  }
}
