import type { Message, Thread } from '../shared/types';
import { historyLimit } from './history';

export type ConversationView = Pick<Thread, 'id' | 'projectId' | 'title' | 'messages' | 'turns'>;

const viewLimit = 6;
const viewTextLimit = 512 * 1024;

function messageSize(message: Message) {
  return (
    message.text.length +
    (message.files?.reduce((total, file) => total + file.path.length + file.diff.length, 0) ?? 0) +
    (message.answeredQuestions?.reduce(
      (total, reply) => total + reply.question.length + reply.answer.length,
      0,
    ) ?? 0)
  );
}

/** Retains the recent transcript only. Receipts, approvals and settings still come from the feed. */
export class ConversationViewCache {
  private readonly views = new Map<string, ConversationView>();

  peek(id: string, projectId: string) {
    const view = this.views.get(id);
    return view?.projectId === projectId ? view : undefined;
  }

  remember(thread: Thread) {
    this.views.delete(thread.id);
    const messages: Message[] = [];
    let size = 0;
    for (let i = thread.messages.length - 1; i >= 0 && messages.length < historyLimit; i--) {
      const item = thread.messages[i]!;
      size += messageSize(item);
      if (size > viewTextLimit) break;
      messages.push(item);
    }
    if (!messages.length) return;
    const turnIds = new Set(messages.map((item) => item.turnId));
    this.views.set(thread.id, {
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      messages: messages.reverse(),
      turns: thread.turns?.filter((turn) => turnIds.has(turn.id)),
    });
    if (this.views.size > viewLimit) this.views.delete(this.views.keys().next().value!);
  }

  refreshRecency(id: string, projectId: string) {
    const view = this.peek(id, projectId);
    if (!view) return;
    this.views.delete(id);
    this.views.set(id, view);
  }

  forget(id: string) {
    this.views.delete(id);
  }

  clear() {
    this.views.clear();
  }
}
