import type { Action, Envelope, Message, QueueState, Thread } from '../shared/types';
import { historyLimit } from './history';

export function applyConversationEvent(thread: Thread | undefined, event: Envelope) {
  const t = thread;
  if (!t || t.id !== event.threadId) return t;
  if (event.kind === 'item') {
    const item = event.data as Message;
    return {
      ...t,
      messages: (t.messages.some((m) => m.id === item.id)
        ? t.messages.map((m) => (m.id === item.id ? item : m))
        : [...t.messages, item]
      ).slice(-historyLimit),
    };
  }
  if (event.kind === 'state') {
    const data = event.data as Partial<Thread>;
    return { ...t, ...data };
  }
  if (event.kind === 'actions') return { ...t, actions: event.data as Action[] };
  if (event.kind === 'queue') return { ...t, queue: event.data as QueueState };
  if (event.kind === 'diff') return { ...t, diff: String(event.data) };
  return t;
}
