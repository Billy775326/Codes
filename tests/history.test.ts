import { expect, it } from 'vitest';
import type { Message, Thread } from '../src/shared/types';
import { earlierWindow, refreshHistory, liveRevision } from '../src/web/history';
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
  messages: rows(240, 479),
  turns: [{ id: 'turn-239', durationMs: 1000 }],
  actions: [],
  settings: { permission: 'read-only' },
  olderCursor: 'live-cursor',
  diff: '',
});
it('bounds older history without mutating or discarding the live latest window', () => {
  const thread = live();
  const window = earlierWindow(thread, undefined, {
    messages: rows(210, 239),
    olderCursor: 'older-cursor',
  });
  expect(window.messages).toHaveLength(240);
  expect(window.messages.at(-1)?.id).toBe('449');
  expect(thread.messages.at(-1)?.id).toBe('479');
  expect(thread.messages).toHaveLength(240);
  const next = earlierWindow(thread, window, {
    messages: rows(180, 209),
    olderCursor: 'earliest-cursor',
  });
  expect(next.messages).toHaveLength(240);
  expect(next.messages[0]?.id).toBe('180');
  expect(next.olderCursor).toBe('earliest-cursor');
  expect(next.liveRevision).toBe(liveRevision(thread));
});
it('trims an entire partial boundary turn and handles empty history', () => {
  const thread = live();
  const window = earlierWindow(thread, undefined, { messages: rows(209, 239), olderCursor: null });
  expect(window.messages).toHaveLength(239);
  expect(window.messages.at(-1)?.id).toBe('447');
  expect(
    earlierWindow({ ...thread, messages: [] }, undefined, { messages: [], olderCursor: null })
      .messages,
  ).toEqual([]);
});
it('deduplicates overlaps, refreshes matching items, and signals activity without appending new items to the reading window', () => {
  const thread = { ...live(), messages: rows(240, 249) };
  const window = earlierWindow(thread, undefined, {
    messages: rows(230, 242),
    olderCursor: 'older',
  });
  expect(new Set(window.messages.map((item) => item.id)).size).toBe(20);
  const changed = {
    ...thread,
    messages: [
      ...thread.messages.slice(0, -1),
      { ...thread.messages.at(-1)!, text: 'A longer live answer' },
      ...rows(250, 251),
    ],
  };
  const visible = refreshHistory(window, changed);
  expect(visible).toHaveLength(20);
  expect(visible.at(-1)?.text).toBe('A longer live answer');
  expect(visible.some((item) => item.id === '251')).toBe(false);
  expect(liveRevision(changed)).not.toBe(window.liveRevision);
  expect(changed.messages.at(-1)?.id).toBe('251');
});
it('keeps historical turn metadata for review while preferring current native timing', () => {
  const thread = live();
  thread.turns!.push({ id: 'turn-120', durationMs: 1000 });
  const window = earlierWindow(thread, undefined, {
    messages: rows(230, 239),
    turns: [
      { id: 'turn-115', durationMs: 2000 },
      { id: 'turn-120', durationMs: 500 },
    ],
    olderCursor: null,
  });
  expect(window.turns).toContainEqual({ id: 'turn-115', durationMs: 2000 });
  expect(window.turns?.some((turn) => turn.id === 'turn-239')).toBe(false);
  expect(window.turns).toContainEqual({ id: 'turn-120', durationMs: 1000 });
});
