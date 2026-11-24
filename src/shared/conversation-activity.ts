import type { Action, State, Summary } from './types.js';

export type OpenInteraction = Pick<Action, 'kind' | 'status' | 'blocking' | 'replyUnconfirmed'>;

export function activeTurn(state: State) {
  return state === 'running' || state === 'waitingApproval' || state === 'waitingInput';
}

export function interactionActivity(
  state: State,
  actions: readonly OpenInteraction[],
  compacting = false,
): Summary['sidebarActivity'] {
  const pending = actions.filter(
    (action) => action.status === 'pending' || action.status === 'responding',
  );
  if (pending.some((action) => action.replyUnconfirmed)) return 'responseUnconfirmed';
  if (pending.length && pending.every((action) => action.status === 'responding'))
    return 'responding';
  const awaiting = pending.filter((action) => action.status === 'pending');
  const questions = awaiting.filter((action) => action.kind === 'questions');
  const nativeApproval =
    state === 'waitingApproval' && pending.every((action) => action.kind === 'questions');
  const nativeAnswer =
    state === 'waitingInput' && pending.every((action) => action.kind !== 'questions');
  const approval = nativeApproval || awaiting.length > questions.length;
  const answer = nativeAnswer || questions.length > 0;
  if (answer && approval) return 'approvalAndInput';
  if (answer)
    return nativeAnswer || questions.some((question) => question.blocking !== false)
      ? 'needsInput'
      : 'optionalInput';
  if (approval) return 'needsApproval';
  if (compacting && state === 'running') return 'compacting';
}
