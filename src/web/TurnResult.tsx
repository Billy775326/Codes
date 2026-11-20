import type { TurnInfo } from '../shared/types';
import { MessageTime } from './MessageTime';

const outcomeLabel = { completed: 'Completed', failed: 'Failed', interrupted: 'Stopped' };
export type TurnOutcome = keyof typeof outcomeLabel;
export function isTurnOutcome(value?: string): value is TurnOutcome {
  return value === 'completed' || value === 'failed' || value === 'interrupted';
}

const compactTokens = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function TurnResult({
  status,
  turn,
  current,
  showTime = true,
}: {
  status: TurnOutcome;
  turn?: TurnInfo;
  current?: boolean;
  showTime?: boolean;
}) {
  const usage = turn?.usage;
  const duration =
    turn?.durationMs ??
    (turn?.completedAtMs !== undefined && turn.startedAtMs !== undefined
      ? turn.completedAtMs - turn.startedAtMs
      : undefined);
  const rate =
    duration && duration > 0 && usage?.outputTokens !== undefined
      ? (usage.outputTokens * 1000) / duration
      : undefined;
  return (
    <div className={current ? 'turn-status ' + status : 'reply-completion'}>
      <span>{outcomeLabel[status]}</span>
      {rate !== undefined && (
        <span title="Output tokens per second across the entire turn">
          · 平均{rate.toFixed(1)}TPS
        </span>
      )}
      {usage && <span>· 本轮{compactTokens.format(usage.totalTokens)} tokens</span>}
      {showTime && turn?.completedAtMs !== undefined && (
        <span>
          · <MessageTime value={turn.completedAtMs} kind="finished" locale="zh-CN" />
        </span>
      )}
    </div>
  );
}
