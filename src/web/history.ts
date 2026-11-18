import type { Message, Thread, TurnInfo } from '../shared/types';
export const historyLimit = 240;
export interface HistoryPage {
  messages: Message[];
  turns?: TurnInfo[];
  olderCursor: string | null;
}
export interface HistoryWindow extends HistoryPage {
  threadId: string;
  liveRevision: string;
}
/** A cheap change marker; no transcript text is copied into navigation state. */
export function liveRevision(thread: Thread): string {
  const last = thread.messages.at(-1);
  return JSON.stringify([
    thread.turnId,
    thread.state,
    thread.updatedAt,
    thread.messages.length,
    last?.id,
    last?.text.length,
    last?.status,
  ]);
}
export function earlierWindow(
  thread: Thread,
  current: HistoryWindow | undefined,
  page: HistoryPage,
): HistoryWindow {
  const previous = current?.threadId === thread.id ? current : undefined;
  const existing = previous?.messages ?? thread.messages;
  const seen = new Set<string>();
  const combined = [...page.messages, ...existing].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  let messages = combined.slice(0, historyLimit);
  // Do not mistake a clipped progress paragraph for a legacy final answer.
  if (
    combined.length > historyLimit &&
    combined[historyLimit]?.turnId === messages.at(-1)?.turnId
  ) {
    const cut = messages.at(-1)!.turnId;
    messages = messages.filter((item) => item.turnId !== cut);
  }
  const ids = new Set(messages.map((item) => item.turnId));
  const turns = new Map<string, TurnInfo>();
  for (const turn of [...(page.turns ?? []), ...(previous?.turns ?? []), ...(thread.turns ?? [])])
    if (ids.has(turn.id)) turns.set(turn.id, turn);
  return {
    threadId: thread.id,
    messages,
    turns: [...turns.values()],
    olderCursor: page.olderCursor,
    liveRevision: previous?.liveRevision ?? liveRevision(thread),
  };
}
/** Keep the historical window stable while refreshing matching live items. */
export function refreshHistory(window: HistoryWindow, thread: Thread): Message[] {
  const live = new Map(thread.messages.map((item) => [item.id, item]));
  return window.messages.map((item) => live.get(item.id) ?? item);
}
