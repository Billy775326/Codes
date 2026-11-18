import { expect, it } from 'vitest';
import type { Message } from '../src/shared/types';
import { groupTurns, commandCounts, workDuration } from '../src/web/activity';
const message = (
  id: string,
  kind: Message['kind'],
  turnId = 'first',
  status = 'completed',
): Message => ({ id, kind, turnId, status, text: id });
it('folds the whole native turn including intermediate prose and separated tools, leaving the answer and edits outside', () => {
  const input = [
    message('u', 'user'),
    message('progress', 'assistant'),
    message('a', 'command'),
    message('more', 'assistant'),
    message('integration', 'tool'),
    message('steer', 'user'),
    {
      ...message('patch', 'change'),
      files: [{ path: 'a.ts', kind: 'update' as const, diff: '+a' }],
    },
    message('final', 'assistant'),
    message('next-user', 'user', 'second'),
    message('next-final', 'assistant', 'second'),
  ];
  const turns = groupTurns(input);
  expect(turns.map((turn) => turn.id)).toEqual(['first', 'second']);
  expect(turns[0]!.users.map((item) => item.id)).toEqual(['u', 'steer']);
  expect(turns[0]!.work.map((item) => item.id)).toEqual(['progress', 'a', 'more', 'integration']);
  expect(turns[0]!.replies.map((item) => item.id)).toEqual(['final']);
  expect(turns[0]!.changes?.files).toHaveLength(1);
  expect(input).toHaveLength(10);
});
it('honors native phases and keeps commentary in work even when no final answer exists', () => {
  const commentary = { ...message('commentary', 'assistant'), phase: 'commentary' as const };
  const partial = { ...message('partial', 'assistant'), phase: 'partial_answer' as const };
  const final = { ...message('final', 'assistant'), phase: 'final_answer' as const };
  expect(groupTurns([commentary])[0]!.replies).toEqual([]);
  expect(groupTurns([final, commentary])[0]!.replies).toEqual([final]);
  expect(groupTurns([commentary, partial, final])[0]!.replies).toEqual([partial, final]);
  expect(groupTurns([message('unknown', 'assistant')], [], ['first'])[0]!.replies).toEqual([]);
  expect(groupTurns([final], [], ['first'])[0]!.replies).toEqual([final]);
  expect(groupTurns([])).toEqual([]);
});
it('aggregates multiple file records with bounded previews and preserves repeated edit order', () => {
  const patch = {
    ...message('patch', 'change'),
    files: [{ path: 'a.ts', kind: 'update' as const, diff: '+first' }],
  };
  const next = {
    ...patch,
    id: 'next',
    files: [{ ...patch.files[0]!, diff: '+second' }],
    truncated: true,
  };
  const turn = groupTurns([patch, next])[0]!;
  expect(turn.changes?.files?.map((file) => file.diff)).toEqual(['+first', '+second']);
  expect(turn.changes?.truncated).toBe(true);
  const many = groupTurns(Array.from({ length: 101 }, (_, i) => ({ ...patch, id: String(i) })))[0]!;
  expect(many.changes?.files).toHaveLength(100);
  expect(many.changes?.truncated).toBe(true);
});
it('uses native duration or native timestamps, never fabricated load time for completed legacy history', () => {
  expect(workDuration({ id: 't', durationMs: 125999 })).toBe('2m 5s');
  expect(workDuration({ id: 't', startedAtMs: 1000, completedAtMs: 126000 })).toBe('2m 5s');
  expect(workDuration({ id: 't', startedAtMs: 1000 }, 9000)).toBe('8s');
  expect(workDuration({ id: 't', startedAtMs: 1000 })).toBeUndefined();
  expect(workDuration({ id: 't' })).toBeUndefined();
  expect(workDuration({ id: 't', durationMs: -1 })).toBeUndefined();
});
it('distinguishes failed, declined, stopped and missing statuses from completion', () => {
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
      ].map((status, i) => message(String(i), 'command', 'turn', status)),
    ),
  ).toEqual({ running: 3, completed: 1, failed: 2, stopped: 2, unknown: 2 });
});

it('keeps the native code review result visible outside its work history', () => {
  const start = { ...message('start', 'notice'), phase: 'commentary' as const };
  const result = { ...message('result', 'notice'), phase: 'final_answer' as const };
  const turn = groupTurns([start, message('command', 'command'), result])[0]!;
  expect(turn.work.map((item) => item.id)).toEqual(['start', 'command']);
  expect(turn.replies).toEqual([result]);
});
