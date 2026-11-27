import { useEffect, useState, type CSSProperties } from 'react';
import type { CodexUsageSnapshot, UsageWindow } from '../shared/codex-usage';
import type { Thread } from '../shared/types';
import { request } from './api';
import { useInterfaceLanguage } from './interface-language';
import { Icon, IconButton } from './primitives';
import './usage.css';

type ContextUsage = NonNullable<Thread['usage']>;

function contextPercent(usage: ContextUsage) {
  return usage.contextWindow
    ? Math.min(100, Math.round((usage.contextTokens / usage.contextWindow) * 100))
    : undefined;
}

export function ContextUsageButton({ usage, open }: { usage: ContextUsage; open: () => void }) {
  const { t, locale } = useInterfaceLanguage();
  const percent = contextPercent(usage);
  const label =
    percent === undefined
      ? t('Context window')
      : t('Context window · {percent}% used', { percent: percent.toLocaleString(locale) });
  const amount = t(usage.contextWindow ? '{count} tokens' : '{count} tokens; window unknown', {
    count:
      usage.contextTokens.toLocaleString(locale) +
      (usage.contextWindow ? ' / ' + usage.contextWindow.toLocaleString(locale) : ''),
  });
  return (
    <button
      type="button"
      className="icon-button context-usage-button"
      aria-label={label}
      aria-description={amount}
      data-tooltip={`${label} · ${amount}`}
      aria-haspopup="dialog"
      onClick={open}
    >
      {percent === undefined ? (
        <Icon name="activity" size={16} />
      ) : (
        <>
          <span
            aria-hidden="true"
            className="context-usage-ring"
            style={{ '--context-used': `${percent}%` } as CSSProperties}
          />
          <span aria-hidden="true" className="context-usage-percent">
            {percent.toLocaleString(locale)}%
          </span>
        </>
      )}
    </button>
  );
}

function LimitWindow({ window, fallback }: { window: UsageWindow; fallback: string }) {
  const { t, locale } = useInterfaceLanguage();
  const names: Record<number, string> = {
    300: '5-hour limit',
    10080: 'Weekly limit',
    43200: '30-day limit',
  };
  const title = window.durationMins
    ? names[window.durationMins]
      ? t(names[window.durationMins]!)
      : t('{count}-minute window', { count: window.durationMins.toLocaleString(locale) })
    : t(fallback);
  const remaining = (100 - window.usedPercent).toLocaleString(locale, { maximumFractionDigits: 1 });
  return (
    <div className="usage-window">
      <div className="usage-row">
        <strong>{title}</strong>
        <span>{t('{percent}% remaining', { percent: remaining })}</span>
      </div>
      <meter
        aria-label={title}
        aria-valuetext={t('{percent}% remaining', { percent: remaining })}
        max={100}
        value={window.usedPercent}
      />
      {window.resetsAt !== undefined && (
        <p>
          {t('Resets {time}', {
            time: new Intl.DateTimeFormat(locale, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(window.resetsAt * 1000),
          })}
        </p>
      )}
    </div>
  );
}

export function UsageSettings() {
  const { t, locale } = useInterfaceLanguage();
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<CodexUsageSnapshot>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    void request<CodexUsageSnapshot>(
      '/connection/codex/usage' + (refresh ? '?refresh=1' : ''),
      {},
      controller.signal,
      8000,
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        setSnapshot(value);
        setStatus('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSnapshot(undefined);
        setStatus('error');
      });
    return () => controller.abort();
  }, [refresh]);
  const limits = snapshot?.limits.status === 'reported' ? snapshot.limits.value : undefined;
  const activity = snapshot?.activity.status === 'reported' ? snapshot.activity.value : undefined;
  const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const timestamp = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const creditStates = {
    available: 'Available',
    redeeming: 'Redeeming',
    redeemed: 'Redeemed',
    unknown: 'Unknown',
  } as const;
  return (
    <div className="usage-settings">
      <section
        className="preferences-section usage-section"
        aria-labelledby="codex-plan-usage"
        aria-busy={status === 'loading'}
      >
        <div className="usage-row usage-section-heading">
          <h3 id="codex-plan-usage">{t('Plan usage')}</h3>
          <IconButton
            icon="refresh"
            label={t('Refresh usage')}
            disabled={status === 'loading'}
            onClick={() => setRefresh((value) => value + 1)}
          />
        </div>
        {status === 'loading' && <p role="status">{t('Loading usage…')}</p>}
        {status === 'error' && <p role="status">{t('Could not load Codex usage.')}</p>}
        {limits ? (
          <>
            {limits.plan && limits.plan !== 'unknown' && (
              <p>{t('Plan · {name}', { name: limits.plan })}</p>
            )}
            {limits.windows.map((bucket) => (
              <div key={bucket.id} className="usage-bucket">
                {(bucket.name || limits.windows.length > 1) && <h4>{bucket.name ?? bucket.id}</h4>}
                {bucket.primary && <LimitWindow window={bucket.primary} fallback="Primary limit" />}
                {bucket.secondary && (
                  <LimitWindow window={bucket.secondary} fallback="Secondary limit" />
                )}
              </div>
            ))}
            {(limits.creditBalance !== undefined || limits.unlimitedCredits) && (
              <div className="usage-row">
                <span>{t('Credit balance')}</span>
                <strong>{limits.unlimitedCredits ? t('Unlimited') : limits.creditBalance}</strong>
              </div>
            )}
            {!limits.windows.length && <p>{t('No usage windows reported.')}</p>}
          </>
        ) : (
          snapshot && (
            <p>
              {t(
                snapshot.limits.status === 'unsupported'
                  ? 'Usage limits require a compatible Codex CLI.'
                  : 'Usage limits unavailable for this Codex account.',
              )}
            </p>
          )
        )}
      </section>
      {snapshot && (
        <section className="preferences-section usage-section" aria-labelledby="codex-usage-resets">
          <h3 id="codex-usage-resets">{t('Usage limit resets')}</h3>
          <div className="usage-row">
            <span>{t('Available resets')}</span>
            <strong>{limits?.availableResets?.toLocaleString(locale) ?? t('Not reported')}</strong>
          </div>
          {!!limits?.resetCredits?.length && (
            <ul className="usage-days">
              {limits.resetCredits.map((credit, index) => (
                <li key={`${credit.grantedAt}:${index}`} className="usage-reset-credit">
                  <div className="usage-row">
                    <span>{credit.title ?? t('Reset credit')}</span>
                    <span>{t(creditStates[credit.status])}</span>
                  </div>
                  <p>{t('Granted {time}', { time: timestamp.format(credit.grantedAt * 1000) })}</p>
                  {credit.expiresAt !== undefined && (
                    <p>
                      {credit.expiresAt === null
                        ? t('Never expires')
                        : t('Expires {time}', {
                            time: timestamp.format(credit.expiresAt * 1000),
                          })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {(activity || snapshot?.activity.status === 'unsupported') && (
        <section
          className="preferences-section usage-section"
          aria-labelledby="codex-token-activity"
        >
          <h3 id="codex-token-activity">{t('Recent token activity')}</h3>
          {activity?.days?.length ? (
            <ul className="usage-days">
              {activity.days.map((day) => (
                <li key={day.date} className="usage-row">
                  <time dateTime={day.date}>{date.format(new Date(day.date + 'T00:00:00Z'))}</time>
                  <span>{t('{count} tokens', { count: day.tokens.toLocaleString(locale) })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t('Daily usage not reported.')}</p>
          )}
          {activity?.lifetimeTokens !== undefined && (
            <p>
              {t('Lifetime activity · {count} tokens', {
                count: activity.lifetimeTokens.toLocaleString(locale),
              })}
            </p>
          )}
        </section>
      )}
      <a
        className="usage-dashboard-link"
        href="https://chatgpt.com/codex/settings/usage"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('Open Codex usage dashboard')}
      </a>
    </div>
  );
}
