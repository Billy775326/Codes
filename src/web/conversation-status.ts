import type { State, Summary } from '../shared/types';

const labels: Record<State, string> = {
  idle: 'Ready',
  running: 'Running',
  waitingApproval: 'Needs approval',
  waitingInput: 'Needs answer',
  completed: 'Done',
  failed: 'Failed',
  interrupted: 'Interrupted',
  unknown: 'Status unknown',
};

/** Presentation of existing task/receipt/queue state; never an execution state machine. */
export function conversationStatus(row: Summary) {
  const uncertain = row.executionUnknown || row.queueIssue === 'unknown';
  const label = uncertain
    ? 'Check result'
    : row.managementPending
      ? 'Check archive'
      : row.executionPending && !['running', 'waitingApproval', 'waitingInput'].includes(row.state)
        ? 'Confirming result'
        : labels[row.state];
  const tone =
    uncertain ||
    row.managementPending ||
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
