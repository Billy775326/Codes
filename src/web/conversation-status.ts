import type { State, Summary } from '../shared/types';

const activityLabels: Record<NonNullable<Summary['sidebarActivity']>, string> = {
  needsInput: 'Needs answer',
  needsApproval: 'Needs approval',
  optionalInput: 'Optional question',
  approvalAndInput: 'Needs approval · Question open',
  responding: 'Submitting response',
  compacting: 'Compacting context',
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
export function conversationStatus(row: Summary) {
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
  const queue = row.queueCount
    ? `${row.queueCount} in queue${row.queueIssue === 'unknown' ? ' · Check result' : row.queueIssue === 'failed' ? ' · Failed' : row.queuePaused ? ' · Paused' : ''}`
    : undefined;
  return { label, tone, queue };
}
