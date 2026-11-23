import type { State, Summary, Thread } from '../shared/types';
import { interfaceLanguages, type Translate } from './interface-language';

const activityLabels: Record<NonNullable<Summary['sidebarActivity']>, string> = {
  needsInput: 'Needs answer',
  needsApproval: 'Needs approval',
  optionalInput: 'Optional question',
  approvalAndInput: 'Needs approval · Question open',
  responding: 'Submitting response',
  compacting: 'Compacting context',
};
const activityIndicators: Record<NonNullable<Summary['sidebarActivity']>, string> = {
  needsInput: 'answer',
  needsApproval: 'approval',
  optionalInput: 'answer',
  approvalAndInput: 'answer-and-approval',
  responding: 'submitting',
  compacting: 'running',
};
const turnIndicators: Partial<Record<State, string>> = {
  running: 'running',
  waitingApproval: 'approval',
  waitingInput: 'answer',
  unknown: 'unknown',
};
const labels: Record<State, string> = {
  idle: 'Ready',
  running: 'Running',
  waitingApproval: 'Needs approval',
  waitingInput: 'Needs answer',
  completed: 'Completed',
  failed: 'Failed',
  interrupted: 'Stopped',
  unknown: 'Status unknown',
};

/** Presentation of existing task/receipt/queue state; never an execution state machine. */
export function conversationStatus(row: Summary, t: Translate = interfaceLanguages.en.t) {
  const uncertain = row.executionUnknown || row.queueIssue === 'unknown';
  const label = uncertain
    ? row.expiredQuestion
      ? 'Question expired · Check result'
      : 'Check result'
    : row.managementPending
      ? 'Check archive'
      : row.sidebarActivity
        ? activityLabels[row.sidebarActivity]
        : row.executionPending &&
            !['running', 'waitingApproval', 'waitingInput'].includes(row.state)
          ? 'Confirming result'
          : labels[row.state];
  const tone =
    uncertain ||
    row.managementPending ||
    (row.sidebarActivity !== undefined && row.sidebarActivity !== 'compacting') ||
    ['waitingApproval', 'waitingInput', 'unknown'].includes(row.state)
      ? 'attention'
      : row.state === 'failed'
        ? 'error'
        : row.state === 'running' || row.executionPending
          ? 'running'
          : 'neutral';
  const queueStatus =
    row.queueIssue === 'unknown'
      ? 'Check result'
      : row.queueIssue === 'failed'
        ? 'Failed'
        : row.queuePaused
          ? 'Paused'
          : undefined;
  const queue = row.queueCount
    ? t('{count} in queue', { count: row.queueCount }) + (queueStatus ? ' · ' + t(queueStatus) : '')
    : undefined;
  const indicator = uncertain
    ? 'unknown'
    : row.managementPending
      ? undefined
      : row.sidebarActivity
        ? activityIndicators[row.sidebarActivity]
        : turnIndicators[row.state];
  return { label: t(label), tone, queue, indicator };
}
/** Live indicator for the selected conversation, using the existing task and interaction states. */
export function taskActivity(thread: Thread, connected: boolean) {
  if (thread.writerConflict) return;
  const pending = thread.actions.filter((action) =>
    ['pending', 'responding'].includes(action.status),
  );
  const answer =
    thread.state === 'waitingInput' || pending.some((action) => action.kind === 'questions');
  const approval =
    thread.state === 'waitingApproval' || pending.some((action) => action.kind !== 'questions');
  const running =
    thread.state === 'running' || thread.sidebarActivity === 'compacting' || !!thread.pending;
  const unknown = thread.state === 'unknown' || thread.executionUnknown;
  if (!answer && !approval && !running && !unknown) return;
  if (!connected) return { state: 'reconnecting', label: 'Reconnecting…' };
  if (pending.some((action) => action.replyUnconfirmed))
    return { state: 'unknown', label: 'Status unknown' };
  if (pending.length && pending.every((action) => action.status === 'responding'))
    return { state: 'submitting', label: 'Submitting response' };
  if (answer && approval)
    return { state: 'answer-and-approval', label: 'Needs approval · Question open' };
  if (answer) return { state: 'answer', label: 'Needs answer' };
  if (approval) return { state: 'approval', label: 'Needs approval' };
  if (unknown) return { state: 'unknown', label: 'Status unknown' };
  return { state: 'running', label: 'Running' };
}
