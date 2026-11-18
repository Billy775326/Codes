import { limits, type Operation, type QueueState } from '../shared/types.js';
import type { QueueStore } from './queue-store.js';

/** Serial dispatch is independent of browser subscriptions and native approval callbacks. */
export class MessageQueue {
  private workers = new Map<string, Promise<void>>();
  private closed = false;
  private again = new Set<string>();
  private waiting = new Set<string>();
  constructor(
    private store: QueueStore,
    private dispatch: (threadId: string, id: string) => Promise<Operation>,
    private ready: (id: string) => Promise<boolean>,
    private publish: (id: string, state: QueueState) => void,
  ) {}
  notify(id: string) {
    this.publish(id, this.store.state(id));
  }
  wake(id: string) {
    if (this.closed) return;
    if (this.workers.has(id)) {
      this.again.add(id);
      return;
    }
    this.waiting.add(id);
    this.drain();
  }
  private drain() {
    while (!this.closed && this.workers.size < limits.active && this.waiting.size) {
      const id = this.waiting.values().next().value!;
      this.waiting.delete(id);
      const work = this.run(id)
        .catch(() => {
          this.store.pause(
            id,
            'The queue could not verify readiness. Review the conversation before resuming.',
          );
          this.notify(id);
        })
        .finally(() => {
          this.workers.delete(id);
          if (this.again.delete(id)) this.waiting.add(id);
          this.drain();
        });
      this.workers.set(id, work);
    }
  }
  private async run(id: string) {
    while (!this.closed) {
      const queue = this.store.state(id);
      if (
        queue.paused ||
        queue.items.some((item) =>
          ['dispatching', 'sent', 'unknown', 'failed'].includes(item.state),
        )
      )
        return;
      const first = queue.items[0];
      if (!first) return;
      if (!(await this.ready(id))) return;
      // Readiness can await native I/O. Recheck after edits, cancellation, or pause.
      const current = this.store.state(id);
      if (
        this.closed ||
        current.paused ||
        current.items[0]?.id !== first.id ||
        this.store.get(first.id)?.state !== 'queued'
      )
        return;
      this.store.set(first.id, 'dispatching');
      this.notify(id);
      try {
        const receipt = await this.dispatch(id, first.id);
        const latest = this.store.get(first.id);
        if (latest?.state === 'dispatching')
          this.store.set(
            first.id,
            receipt.state === 'completed'
              ? 'completed'
              : receipt.state === 'unknown'
                ? 'unknown'
                : receipt.state === 'failed'
                  ? 'failed'
                  : 'sent',
            receipt.error,
          );
        if (receipt.state === 'failed' || receipt.state === 'unknown')
          this.store.pause(id, 'A queued task needs review before continuing.');
      } catch (error) {
        if (this.store.get(first.id)?.state === 'dispatching')
          this.store.set(
            first.id,
            'failed',
            error instanceof Error ? error.message : 'Queued dispatch failed.',
          );
        this.store.pause(id, 'A queued task needs review before continuing.');
      }
      this.notify(id);
      if (this.store.get(first.id)?.state !== 'completed') return;
    }
  }
  async close() {
    this.closed = true;
    await Promise.allSettled(this.workers.values());
  }
}
