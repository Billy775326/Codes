import { expect, it } from 'vitest';
import { conversationStatus, taskActivity } from '../src/web/conversation-status';
import type { Action, State, Summary, Thread } from '../src/shared/types';
import { interactionActivity } from '../src/shared/conversation-activity';
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
  ).toEqual({
    label: 'Check result',
    tone: 'attention',
    queue: '2 in queue · Paused',
    indicator: 'unknown',
  });
  expect(conversationStatus({ ...row, executionPending: true }).label).toBe('Confirming result');
  expect(conversationStatus({ ...row, managementPending: true }).label).toBe('Check archive');
});
it('retains the task status alongside paused, failed, and uncertain queue entries', () => {
  expect(
    conversationStatus({ ...row, state: 'waitingApproval', queueCount: 2, queuePaused: true }),
  ).toEqual({
    label: 'Needs approval',
    tone: 'attention',
    queue: '2 in queue · Paused',
    indicator: 'approval',
  });
  expect(
    conversationStatus({ ...row, queueCount: 1, queuePaused: true, queueIssue: 'failed' }).queue,
  ).toBe('1 in queue · Failed');
  expect(conversationStatus({ ...row, queueCount: 1, queueIssue: 'unknown' }).label).toBe(
    'Check result',
  );
  expect(conversationStatus({ ...row, queuePaused: true }).queue).toBeUndefined();
});
it('distinguishes running work, outstanding interactions, and unconfirmed results', () => {
  expect(conversationStatus({ ...row, state: 'running' }).indicator).toBe('running');
  expect(
    conversationStatus({ ...row, state: 'running', sidebarActivity: 'optionalInput' }).indicator,
  ).toBe('answer');
  expect(conversationStatus({ ...row, state: 'waitingInput' }).indicator).toBe('answer');
  expect(conversationStatus({ ...row, state: 'running', executionUnknown: true }).indicator).toBe(
    'unknown',
  );
  expect(conversationStatus({ ...row, sidebarActivity: 'approvalAndInput' }).indicator).toBe(
    'answer-and-approval',
  );
  expect(conversationStatus({ ...row, sidebarActivity: 'responding' }).indicator).toBe(
    'submitting',
  );
  expect(conversationStatus({ ...row, executionPending: true }).indicator).toBeUndefined();
  expect(conversationStatus(row).indicator).toBeUndefined();
});

it('keeps the conversation and sidebar consistent while answering and checking uncertain replies', () => {
  const question: Action = {
    id: 'ask',
    threadId: row.id,
    turnId: 'turn',
    kind: 'questions',
    async: true,
    blocking: false,
    title: 'Question',
    detail: '',
    decisions: [],
    status: 'responding',
  };
  const thread: Thread = {
    ...row,
    state: 'running',
    actions: [question],
    messages: [],
    olderCursor: null,
    settings: { permission: 'read-only' },
    diff: '',
  };
  const presentation = () =>
    conversationStatus({
      ...thread,
      sidebarActivity: interactionActivity(thread.state, thread.actions),
    });
  expect(taskActivity(thread, true)).toEqual({
    state: presentation().indicator,
    label: presentation().label,
  });
  expect(presentation().label).toBe('Submitting response');
  question.replyUnconfirmed = true;
  expect(taskActivity(thread, true)).toEqual({ state: 'unknown', label: presentation().label });
  expect(presentation().label).toBe('Status unknown');
  expect(taskActivity(thread, false)?.state).toBe('reconnecting');
});
