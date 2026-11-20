import { expect, it } from 'vitest';
import { conversationStatus } from '../src/web/conversation-status';
import type { State, Summary } from '../src/shared/types';
const row: Summary = {
  id: 'a',
  projectId: 'p',
  title: 'Example',
  state: 'completed',
  updatedAt: 1,
};
it.each<[State, string]>([
  ['idle', 'Ready'],
  ['running', 'Running'],
  ['waitingApproval', 'Needs approval'],
  ['waitingInput', 'Needs answer'],
  ['completed', 'Completed'],
  ['failed', 'Failed'],
  ['interrupted', 'Stopped'],
  ['unknown', 'Status unknown'],
])('labels %s without inferring a different task state', (state, label) => {
  expect(conversationStatus({ ...row, state }).label).toBe(label);
});
it('keeps uncertain receipts visible over terminal state and queue metadata', () => {
  expect(
    conversationStatus({
      ...row,
      executionPending: true,
      executionUnknown: true,
      queueCount: 2,
      queuePaused: true,
    }),
  ).toEqual({ label: 'Check result', tone: 'attention', queue: '2 in queue · Paused' });
  expect(conversationStatus({ ...row, executionPending: true }).label).toBe('Confirming result');
  expect(conversationStatus({ ...row, managementPending: true }).label).toBe('Check archive');
});
it('retains the task status alongside paused, failed, and uncertain queue entries', () => {
  expect(
    conversationStatus({ ...row, state: 'waitingApproval', queueCount: 2, queuePaused: true }),
  ).toEqual({ label: 'Needs approval', tone: 'attention', queue: '2 in queue · Paused' });
  expect(
    conversationStatus({ ...row, queueCount: 1, queuePaused: true, queueIssue: 'failed' }).queue,
  ).toBe('1 in queue · Failed');
  expect(conversationStatus({ ...row, queueCount: 1, queueIssue: 'unknown' }).label).toBe(
    'Check result',
  );
  expect(conversationStatus({ ...row, queuePaused: true }).queue).toBeUndefined();
});
