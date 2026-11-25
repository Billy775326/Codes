import { randomUUID } from 'node:crypto';
import type { Driver } from '../codex/driver.js';
import { AppError } from '../shared/errors.js';
import { limits, type Action, type Thread } from '../shared/types.js';
import type { Store } from './store.js';

export type ActionResolution = { decision?: string; answers?: Record<string, string> };

interface InteractionCallbacks {
  publish(threadId: string): void;
  emit(threadId: string): void;
  boundary(thread: Thread): void;
}

const text = (value: unknown, maximum: number = limits.item) =>
  typeof value === 'string' ? value.slice(0, maximum) : '';

/** Tracks blocking CLI requests for the current runtime connection. */
export class NativeInteractions {
  private readonly actions = new Map<
    string,
    { action: Action; rpcId: string | number; epoch: string; permissions?: unknown }
  >();

  constructor(
    private readonly store: Store,
    private readonly driver: Driver,
    private readonly callbacks: InteractionCallbacks,
  ) {}

  get size() {
    return this.actions.size;
  }

  clear() {
    this.actions.clear();
  }

  expireThread(thread: Thread) {
    for (const action of thread.actions) action.status = 'expired';
    for (const [id, entry] of this.actions)
      if (entry.action.threadId === thread.id) this.actions.delete(id);
  }

  expireTurn(turnId: string) {
    for (const entry of this.actions.values())
      if (entry.action.turnId === turnId) {
        entry.action.status = 'expired';
        this.actions.delete(entry.action.id);
      }
  }

  resolve(thread: Thread, requestId: unknown) {
    let questionResolved = false;
    for (const entry of this.actions.values())
      if (entry.action.threadId === thread.id && entry.rpcId === requestId) {
        questionResolved ||= entry.action.kind === 'questions';
        entry.action.status = 'answered';
        this.actions.delete(entry.action.id);
      }
    if (
      questionResolved &&
      thread.pending &&
      !thread.actions.some(
        (a) => a.kind === 'questions' && (a.status === 'pending' || a.status === 'responding'),
      )
    )
      this.store.markWaitingQuestion(thread.pending.id, false);
    this.callbacks.emit(thread.id);
    if (['waitingInput', 'waitingApproval'].includes(thread.state)) {
      const remaining = thread.actions.filter(
        (a) => a.status === 'pending' || a.status === 'responding',
      );
      thread.state = remaining.some((a) => a.kind !== 'questions')
        ? 'waitingApproval'
        : remaining.length
          ? 'waitingInput'
          : 'running';
      this.callbacks.boundary(thread);
    }
  }

  async answer(id: string, operationId: string, resolution: ActionResolution) {
    const receipt = this.store.existing(operationId, undefined, 'answer', { id, resolution });
    if (receipt) return receipt;
    const entry = this.actions.get(id);
    if (!entry || entry.epoch !== this.driver.epoch || entry.action.status !== 'pending') {
      throw new AppError('STALE_ACTION', 'This request was already answered or has expired.', 409);
    }
    const action = entry.action;
    let response: unknown;
    if (action.kind === 'questions') {
      if (resolution.decision === 'skip') {
        if (action.blocking !== false || Object.keys(resolution.answers ?? {}).length)
          throw new AppError('INVALID_ANSWER', 'Only an optional question can be skipped.');
        response = { answers: {} };
      } else {
        if (resolution.decision)
          throw new AppError(
            'INVALID_ANSWER',
            'Submit answers or explicitly skip an optional question.',
          );
        const answers: Record<string, { answers: string[] }> = {};
        if (
          Object.keys(resolution.answers ?? {}).some(
            (id) => !action.questions?.some((question) => question.id === id),
          )
        )
          throw new AppError('INVALID_ANSWER', 'The answer refers to a different question.');
        for (const question of action.questions ?? []) {
          const value = resolution.answers?.[question.id]?.trim();
          if (!value)
            throw new AppError('ANSWER_REQUIRED', 'Answer each question before submitting.');
          if (
            question.options?.length &&
            !question.allowOther &&
            !question.options.some((option) => option.label === value)
          )
            throw new AppError('INVALID_ANSWER', 'Choose one of the supplied options.');
          answers[question.id] = { answers: [value] };
        }
        response = { answers };
      }
    } else {
      if (!action.decisions.includes(resolution.decision ?? ''))
        throw new AppError('INVALID_DECISION', 'Choose an available decision.');
      response =
        action.kind === 'permissions'
          ? {
              permissions: resolution.decision === 'accept' ? entry.permissions : {},
              scope: 'turn',
            }
          : { decision: resolution.decision };
    }
    const { existing } = this.store.begin(operationId, action.threadId, 'answer', {
      id,
      resolution,
    });
    if (existing) return existing;
    if (action.kind === 'questions')
      action.submittedAnswers = Object.fromEntries(
        (action.questions ?? []).flatMap((q) => {
          const answer = resolution.answers?.[q.id];
          return !q.secret && typeof answer === 'string' ? [[q.id, answer]] : [];
        }),
      );
    action.status = 'responding';
    this.callbacks.publish(action.threadId);
    try {
      await this.driver.answer(entry.rpcId, response);
      this.store.update(operationId, 'completed');
      return this.store.operation(operationId)!;
    } catch (error) {
      this.store.update(operationId, 'unknown');
      throw error;
    }
  }

  request(event: any, thread: Thread | undefined) {
    const p = event.params;
    const kinds: Record<string, Action['kind']> = {
      'item/commandExecution/requestApproval': 'command',
      'item/fileChange/requestApproval': 'file',
      'item/tool/requestUserInput': 'questions',
      'item/permissions/requestApproval': 'permissions',
    };
    const kind = kinds[event.method];
    if (
      !kind ||
      !thread ||
      (kind === 'questions' && p.turnId !== thread.turnId) ||
      this.actions.size >= 32 ||
      !['string', 'number'].includes(typeof event.id)
    ) {
      void this.driver
        .reject(event.id)
        ?.catch(() => console.error('Unable to reject an unsupported CLI interaction.'));
      return;
    }
    const action: Action = {
      id: randomUUID(),
      threadId: thread.id,
      turnId: text(p.turnId),
      kind,
      title:
        kind === 'questions'
          ? 'Your input is needed'
          : kind === 'permissions'
            ? 'Additional permissions requested'
            : kind === 'file'
              ? 'File change approval'
              : 'Command approval',
      detail: text(
        p.command || p.reason || p.cwd || 'Review this request before continuing.',
        8192,
      ),
      decisions: kind === 'permissions' ? ['accept', 'decline'] : ['accept', 'decline', 'cancel'],
      status: 'pending',
      afterMessageId:
        kind === 'questions'
          ? thread.messages.findLast((item) => item.turnId === p.turnId)?.id
          : undefined,
      blocking: kind === 'questions' ? p.isBlocking !== false : undefined,
      files: kind === 'file' ? thread.messages.find((m) => m.id === p.itemId)?.files : undefined,
      truncated:
        kind === 'file' ? thread.messages.find((m) => m.id === p.itemId)?.truncated : undefined,
    };
    action.detail =
      [
        p.command && `Command: ${text(p.command, 8192)}`,
        p.cwd && `Directory: ${text(p.cwd, 2048)}`,
        p.reason && `Reason: ${text(p.reason, 4096)}`,
        kind === 'permissions' &&
          `Requested permissions (this turn only):\n${JSON.stringify(p.permissions ?? {}, null, 2)}`,
        kind === 'file' &&
          (action.files?.length
            ? 'Review the proposed patch below.'
            : thread.messages.find((m) => m.id === p.itemId)?.text ||
              'The CLI did not provide a patch for this approval. Inspect the workspace before approving.'),
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 16384) || action.detail;
    if (kind === 'questions')
      action.questions = (Array.isArray(p.questions) ? p.questions : [])
        .filter((q: any) => typeof q.id === 'string' && typeof q.question === 'string')
        .map((q: any) => ({
          id: q.id,
          question: text(q.question, 4000),
          secret: q.isSecret === true,
          header: text(q.header, 80),
          allowOther: q.isOther === true,
          options: Array.isArray(q.options)
            ? q.options
                .filter((x: any) => typeof x.label === 'string')
                .slice(0, 10)
                .map((x: any) => ({
                  label: text(x.label, 200),
                  description: text(x.description, 1000),
                }))
            : undefined,
        }));
    if (
      kind === 'questions' &&
      (!action.questions?.length ||
        action.questions.length > 8 ||
        new Set(action.questions.map((q) => q.id)).size !== action.questions.length)
    ) {
      void this.driver
        .reject(event.id)
        ?.catch(() => console.error('Unable to reject invalid CLI questions.'));
      return;
    }
    this.actions.set(action.id, {
      action,
      rpcId: event.id,
      epoch: this.driver.epoch,
      permissions: p.permissions,
    });
    thread.actions = thread.actions.filter(
      (a) =>
        a.status === 'pending' ||
        a.status === 'responding' ||
        (a.kind === 'questions' && a.turnId === thread.turnId),
    );
    const settled = thread.actions.filter((a) => a.status === 'answered' || a.status === 'expired');
    if (settled.length >= 32) thread.actions = thread.actions.filter((a) => a !== settled[0]);
    if (kind === 'questions' && thread.pending)
      this.store.markWaitingQuestion(thread.pending.id, true);
    thread.actions.push(action);
    thread.state = thread.actions.some(
      (a) => a.kind !== 'questions' && ['pending', 'responding'].includes(a.status),
    )
      ? 'waitingApproval'
      : 'waitingInput';
    this.callbacks.boundary(thread);
  }
}
