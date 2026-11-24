import { activeTurn, interactionActivity } from '../shared/conversation-activity';
import type { State, Summary, Thread } from '../shared/types';
import { interfaceLanguages, type Translate } from './interface-language';

const activityLabels: Record<NonNullable<Summary['sidebarActivity']>, string> = {
  needsInput: 'Needs answer',
  needsApproval: 'Needs approval',
  optionalInput: 'Optional question',
  approvalAndInput: 'Needs approval · Question open',
  responding: 'Submitting response',
  responseUnconfirmed: 'Status unknown',
  compacting: 'Compacting context',
};
const activityIndicators: Record<NonNullable<Summary['sidebarActivity']>, string> = {
  needsInput: 'answer',
  needsApproval: 'approval',
  optionalInput: 'answer',
  approvalAndInput: 'answer-and-approval',
  responding: 'submitting',
  responseUnconfirmed: 'unknown',
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

function status(row: Summary) {
  const uncertain =
    row.executionUnknown || (row.queueIssue === 'unknown' && !activeTurn(row.state));
  if (uncertain)
    return {
      label: row.expiredQuestion ? 'Question expired · Check result' : 'Check result',
      tone: 'attention',
      indicator: 'unknown',
    };
  if (row.managementPending)
    return { label: 'Check archive', tone: 'attention', indicator: undefined };
  const activity = row.sidebarActivity;
  if (activity)
    return {
      label: activityLabels[activity],
      tone: activity === 'compacting' ? 'running' : 'attention',
      indicator: activityIndicators[activity],
    };
  if (row.executionPending && !activeTurn(row.state) && row.state !== 'unknown')
    return { label: 'Confirming result', tone: 'running', indicator: undefined };
  const tone =
    row.state === 'failed'
      ? 'error'
      : row.state === 'running'
        ? 'running'
        : turnIndicators[row.state]
          ? 'attention'
          : 'neutral';
  return { label: labels[row.state], tone, indicator: turnIndicators[row.state] };
}

/** Present task, operation and queue state without changing their ownership. */
export function conversationStatus(row: Summary, t: Translate = interfaceLanguages.en.t) {
  const { label, tone, indicator } = status(row);
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
  return { label: t(label), tone, queue, indicator };
}
/** Live indicator for the selected conversation, using the existing task and interaction states. */
export function taskActivity(thread: Thread, connected: boolean) {
  if (thread.writerConflict) return;
  const view = status({
    ...thread,
    sidebarActivity: interactionActivity(thread.state, thread.actions, !!thread.compaction),
  });
  const state = view.indicator ?? (thread.pending ? 'running' : undefined);
  if (!state) return;
  return connected
    ? { state, label: view.label }
    : { state: 'reconnecting', label: 'Reconnecting…' };
}
