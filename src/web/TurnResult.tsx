import { useInterfaceLanguage } from './interface-language';
import type { TurnInfo } from '../shared/types';
import { MessageTime } from './MessageTime';

const outcomeLabel = { completed: 'Completed', failed: 'Failed', interrupted: 'Stopped' };
export type TurnOutcome = keyof typeof outcomeLabel;
export function isTurnOutcome(value?: string): value is TurnOutcome {
  return value === 'completed' || value === 'failed' || value === 'interrupted';
}

const compactTokens = Object.fromEntries(
  ['en-US', 'zh-CN'].map((locale) => [
    locale,
    new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
  ]),
);

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
  const { t, locale } = useInterfaceLanguage();
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
      <span>{t(outcomeLabel[status])}</span>
      {rate !== undefined && (
        <span title={t('Output tokens per second')}>
          · {t('Avg {rate} TPS', { rate: rate.toFixed(1) })}
        </span>
      )}
      {usage && (
        <span>
          · {t('{count} tokens', { count: compactTokens[locale]!.format(usage.totalTokens) })}
        </span>
      )}
      {showTime && turn?.completedAtMs !== undefined && (
        <span>
          · <MessageTime value={turn.completedAtMs} kind="finished" />
        </span>
      )}
    </div>
  );
}
