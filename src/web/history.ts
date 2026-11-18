import type { Message, Thread, TurnInfo } from '../shared/types';
export const historyLimit = 240;
export const historyPages = 3;
export type HistoryDirection = 'older' | 'newer';
export interface HistoryPage {
  messages: Message[];
  turns?: TurnInfo[];
  olderCursor: string | null;
  newerCursor?: string | null;
  hasNewer?: boolean;
}
export interface HistoryWindow extends HistoryPage {
  threadId: string;
  liveRevision: string;
  pages: HistoryPage[];
}
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
function mergeMessages(pages: readonly Message[][]) {
  const merged = new Map<string, Message>();
  for (const page of pages) for (const item of page) merged.set(item.id, item);
  return [...merged.values()];
}
/** Keep whole native pages. Evict only at the opposite scrolling edge. */
export function earlierWindow(
  thread: Thread,
  current: HistoryWindow | undefined,
  page: HistoryPage,
  direction: HistoryDirection = 'older',
): HistoryWindow {
  const previous = current?.threadId === thread.id ? current : undefined;
  let pages = previous?.pages ?? [
    {
      messages: thread.messages,
      turns: thread.turns,
      olderCursor: thread.olderCursor,
      newerCursor: thread.newerCursor,
      hasNewer: false,
    },
  ];
  const ids = new Set(pages.flatMap((p) => p.messages.map((item) => item.id)));
  const novel = page.messages.some((item) => !ids.has(item.id));
  if (novel)
    pages =
      direction === 'older'
        ? [page, ...pages].slice(0, historyPages)
        : [...pages, page].slice(-historyPages);
  else {
    const edge = direction === 'older' ? 0 : pages.length - 1;
    const updates = new Map(page.messages.map((item) => [item.id, item]));
    pages = pages.map((p, index) => ({
      ...p,
      messages: p.messages.map((item) => updates.get(item.id) ?? item),
      ...(index !== edge
        ? {}
        : direction === 'older'
          ? {
              olderCursor: page.olderCursor,
              ...(pages.length === 1 &&
              page.messages.some((item) => item.id === p.messages.at(-1)?.id)
                ? {
                    newerCursor: page.newerCursor ?? p.newerCursor,
                    hasNewer: page.hasNewer ?? p.hasNewer,
                  }
                : {}),
            }
          : { newerCursor: page.newerCursor, hasNewer: page.hasNewer }),
    }));
  }
  const turns = new Map<string, TurnInfo>();
  for (const p of pages) for (const turn of p.turns ?? []) turns.set(turn.id, turn);
  for (const turn of page.turns ?? []) if (turns.has(turn.id)) turns.set(turn.id, turn);
  const last = pages.at(-1)!;
  return {
    threadId: thread.id,
    pages,
    messages: mergeMessages(pages.map((p) => p.messages)),
    turns: [...turns.values()],
    olderCursor: pages[0]!.olderCursor,
    newerCursor: last.newerCursor,
    hasNewer: last.hasNewer,
    liveRevision: previous?.liveRevision ?? liveRevision(thread),
  };
}
export function linkedToLatest(window: HistoryWindow, thread: Thread): boolean {
  if (window.hasNewer) return false;
  if (!window.messages.length && !thread.messages.length) return true;
  const live = new Set(thread.messages.map((item) => item.id));
  return window.pages.at(-1)!.messages.some((item) => live.has(item.id));
}
/** One ordered timeline; live updates join only after a contiguous overlap. */
export function refreshHistory(window: HistoryWindow, thread: Thread): Message[] {
  const live = new Map(thread.messages.map((item) => [item.id, item]));
  const historical = window.messages.map((item) => live.get(item.id) ?? item);
  return linkedToLatest(window, thread) ? mergeMessages([historical, thread.messages]) : historical;
}
