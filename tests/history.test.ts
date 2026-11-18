import { expect, it } from 'vitest';
import type { Message, Thread } from '../src/shared/types';
import { earlierWindow, refreshHistory, linkedToLatest, liveRevision } from '../src/web/history';
const rows = (first: number, last: number): Message[] =>
  Array.from({ length: last - first + 1 }, (_, n) => ({
    id: String(first + n),
    turnId: 'turn-' + Math.floor((first + n) / 2),
    kind: (first + n) % 2 ? 'assistant' : 'user',
    text: 'message ' + (first + n),
  }));
const live = (): Thread => ({
  id: 'conversation',
  projectId: 'project',
  title: 'Fixture',
  state: 'completed',
  updatedAt: 1000,
  messages: rows(720, 959),
  turns: [{ id: 'turn-479', durationMs: 1000 }],
  actions: [],
  settings: { permission: 'read-only' },
  olderCursor: 'older-720',
  newerCursor: 'newer-959',
  diff: '',
});
const page = (first: number, last: number) => ({
  messages: rows(first, last),
  olderCursor: 'older-' + first,
  newerCursor: 'newer-' + last,
  hasNewer: true,
});
it('keeps older and latest records in one ordered timeline until a whole page must be evicted', () => {
  const thread = live();
  let window = earlierWindow(thread, undefined, page(480, 719));
  expect(window.messages).toHaveLength(480);
  expect(window.messages.at(-1)?.id).toBe('959');
  expect(linkedToLatest(window, thread)).toBe(true);
  window = earlierWindow(thread, window, page(240, 479));
  expect(window.messages).toHaveLength(720);
  window = earlierWindow(thread, window, page(0, 239));
  expect(window.pages).toHaveLength(3);
  expect(window.messages).toHaveLength(720);
  expect(window.messages.at(-1)?.id).toBe('719');
  expect(window.newerCursor).toBe('newer-719');
  expect(linkedToLatest(window, thread)).toBe(false);
  expect(thread.messages.at(-1)?.id).toBe('959');
  window = earlierWindow(thread, window, page(718, 957), 'newer');
  window = earlierWindow(thread, window, { ...page(956, 959), hasNewer: false }, 'newer');
  expect(window.pages).toHaveLength(3);
  expect(window.messages.at(-1)?.id).toBe('959');
  expect(new Set(window.messages.map((item) => item.id)).size).toBe(window.messages.length);
  expect(linkedToLatest(window, thread)).toBe(true);
});
it('refreshes native anchor duplicates and advances cursors without accumulating empty pages', () => {
  const thread = live();
  const window = earlierWindow(thread, undefined, page(480, 719));
  const updated = earlierWindow(
    thread,
    window,
    { ...page(958, 959), newerCursor: 'next-forward', hasNewer: true },
    'newer',
  );
  expect(updated.pages).toHaveLength(2);
  expect(updated.messages).toHaveLength(480);
  expect(updated.newerCursor).toBe('next-forward');
  expect(
    earlierWindow(thread, updated, { messages: [], olderCursor: null }).olderCursor,
  ).toBeNull();
});
it('joins new live messages without hiding the reading context and detects an unbridged live gap', () => {
  const thread = live();
  const window = earlierWindow(thread, undefined, page(480, 719));
  const changed = { ...thread, messages: [...thread.messages.slice(2), ...rows(960, 961)] };
  expect(refreshHistory(window, changed).at(-1)?.id).toBe('961');
  expect(refreshHistory(window, changed)[0]?.id).toBe('480');
  expect(liveRevision(changed)).not.toBe(window.liveRevision);
  const farAhead = { ...thread, messages: rows(1200, 1439) };
  expect(linkedToLatest(window, farAhead)).toBe(false);
  expect(refreshHistory(window, farAhead).at(-1)?.id).toBe('959');
});
it('retains complete native turns and their timing without cutting a boundary turn', () => {
  const thread = live();
  const window = earlierWindow(thread, undefined, {
    ...page(711, 719),
    turns: [{ id: 'turn-355', durationMs: 2000 }],
  });
  expect(window.messages[0]?.id).toBe('711');
  expect(window.messages.at(-1)?.id).toBe('959');
  expect(window.turns).toContainEqual({ id: 'turn-355', durationMs: 2000 });
  expect(
    earlierWindow({ ...thread, messages: [] }, undefined, { messages: [], olderCursor: null })
      .messages,
  ).toEqual([]);
});

it('refreshes a growing live cache cursor from an overlapping native latest page', () => {
  const thread = { ...live(), newerCursor: undefined };
  const window = earlierWindow(thread, undefined, {
    ...page(940, 959),
    olderCursor: 'native-older',
    newerCursor: 'native-forward',
    hasNewer: false,
  });
  expect(window.pages).toHaveLength(1);
  expect(window.newerCursor).toBe('native-forward');
  expect(window.olderCursor).toBe('native-older');
  expect(linkedToLatest(window, thread)).toBe(true);
});
