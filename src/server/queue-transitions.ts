import type { Thread } from '../shared/types.js';
import type { Store } from './store.js';

export function pauseQueueAfterTurn(store: Store, id: string, outcome: string | undefined) {
  if (outcome === 'failed' || outcome === 'interrupted')
    store.queue.pauseForReview(id, 'A task stopped or failed. Review the queue before resuming.');
}
export function settleQueuedOperations(store: Store, thread: Thread) {
  for (const entry of store.queue.inFlight(thread.id)) {
    const op = store.operation(entry.id);
    if (op?.state === 'completed') {
      const outcome =
        thread.turns?.find((turn) => turn.id === op.turnId)?.status ??
        (thread.turnId === op.turnId ? thread.state : undefined);
      store.queue.set(
        entry.id,
        'completed',
        outcome === 'failed' || outcome === 'interrupted'
          ? `The task ended ${outcome}.`
          : undefined,
      );
      pauseQueueAfterTurn(store, thread.id, outcome);
    } else if (op?.state === 'unknown') {
      if (entry.state !== 'sent')
        store.queue.set(entry.id, 'unknown', 'Check result before continuing.');
      store.queue.pauseForReview(thread.id, 'An execution result is unknown.');
    } else if (op?.state === 'failed') {
      store.queue.set(entry.id, entry.state === 'sent' ? 'completed' : 'failed', op.error);
      store.queue.pauseForReview(thread.id, 'A queued task failed.');
    }
  }
  thread.queue = store.queue.state(thread.id);
}
