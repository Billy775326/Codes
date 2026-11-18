import { expect, it } from 'vitest';
import type { Message } from '../src/shared/types';
import { groupActivity, commandCounts, replyTargets } from '../src/web/activity';
const message = (
  id: string,
  kind: Message['kind'],
  turnId = 'first',
  status = 'completed',
): Message => ({ id, kind, turnId, status, text: id });
it('groups only consecutive commands from the same turn without reordering prose or changes', () => {
  const input = [
    message('user', 'user'),
    message('a', 'command'),
    message('b', 'command'),
    message('progress', 'assistant'),
    message('c', 'command'),
    message('patch', 'change'),
    message('d', 'command'),
    message('e', 'command', 'second'),
    message('final', 'assistant', 'second'),
  ];
  const entries = groupActivity(input);
  expect(
    entries.map((entry) =>
      entry.kind === 'commands' ? entry.items.map((item) => item.id) : entry.item.id,
    ),
  ).toEqual(['user', ['a', 'b'], 'progress', ['c'], 'patch', ['d'], ['e'], 'final']);
  expect(
    entries.flatMap((entry) => (entry.kind === 'commands' ? entry.items : [entry.item])),
  ).toEqual(input);
  expect(input.map((item) => item.id)).toEqual([
    'user',
    'a',
    'b',
    'progress',
    'c',
    'patch',
    'd',
    'e',
    'final',
  ]);
});
it('keeps a command run identity stable as native commands append or complete', () => {
  const first = message('a', 'command', 'turn', 'inProgress');
  const original = groupActivity([first]);
  const updated = groupActivity([
    { ...first, status: 'completed' },
    message('b', 'command', 'turn'),
  ]);
  expect(updated[0]!.key).toBe(original[0]!.key);
  expect(updated[0]!.key).not.toBe(groupActivity([message('a', 'command', 'another')])[0]!.key);
  expect(groupActivity([])).toEqual([]);
});
it('distinguishes failed, declined, stopped and missing statuses from successful completion', () => {
  expect(
    commandCounts(
      [
        'inProgress',
        'running',
        'pending',
        'completed',
        'failed',
        'declined',
        'cancelled',
        'interrupted',
        '',
        'future-status',
      ].map((status, index) => message(String(index), 'command', 'turn', status)),
    ),
  ).toEqual({ running: 3, completed: 1, failed: 2, stopped: 2, unknown: 2 });
});

it('assigns actions once per turn to its last assistant reply, excluding user messages and tools', () => {
  expect([
    ...replyTargets([
      message('u', 'user'),
      message('progress', 'assistant'),
      message('command', 'command'),
      message('final', 'assistant'),
      message('next-user', 'user', 'second'),
      message('next-progress', 'assistant', 'second'),
      message('notice', 'notice', 'second'),
    ]),
  ]).toEqual(['final', 'next-progress']);
  expect([...replyTargets([message('unscoped', 'assistant', '')])]).toEqual([]);
});
