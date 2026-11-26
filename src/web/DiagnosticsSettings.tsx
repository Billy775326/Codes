import { useEffect, useState } from 'react';
import { diagnosticMinutes, type DiagnosticsStatus } from '../shared/workspace-settings';
import type { RuntimeSettingsSnapshot } from '../shared/runtime-settings';
import { message, post, request } from './api';
import { useInterfaceLanguage } from './interface-language';

const path = '/settings/diagnostics';

function RuntimePaths({ version }: { version?: string }) {
  const { t } = useInterfaceLanguage();
  const [expanded, setExpanded] = useState(false);
  const [paths, setPaths] =
    useState<Pick<RuntimeSettingsSnapshot, 'executable' | 'dataDirectory'>>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!expanded || paths) return;
    const controller = new AbortController();
    setError('');
    void request<RuntimeSettingsSnapshot>('/settings/runtime', {}, controller.signal).then(
      ({ executable, dataDirectory }) => {
        if (!controller.signal.aborted) setPaths({ executable, dataDirectory });
      },
      (failure) => {
        if (!controller.signal.aborted) setError(message(failure));
      },
    );
    return () => controller.abort();
  }, [expanded, paths, attempt]);

  return (
    <details
      className="runtime-details"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>{t('Runtime paths')}</summary>
      {paths ? (
        <dl className="runtime-paths">
          <dt>{t('CLI version')}</dt>
          <dd>{version || t('Unknown')}</dd>
          <dt>{t('Codex launcher')}</dt>
          <dd>
            <code>{paths.executable}</code>
          </dd>
          <dt>{t('Codes data directory')}</dt>
          <dd>
            <code>{paths.dataDirectory}</code>
          </dd>
        </dl>
      ) : error ? (
        <div className="settings-action-row">
          <p role="alert">{t(error)}</p>
          <button
            className="settings-action"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t('Retry loading')}
          </button>
        </div>
      ) : expanded ? (
        <p role="status">{t('Loading runtime paths…')}</p>
      ) : null}
    </details>
  );
}

export function DiagnosticsSettings({ version }: { version?: string }) {
  const { t, locale } = useInterfaceLanguage();
  const [status, setStatus] = useState<DiagnosticsStatus>();
  const [duration, setDuration] = useState<(typeof diagnosticMinutes)[number]>(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void request<DiagnosticsStatus>(path, {}, controller.signal).then(setStatus, (failure) => {
      if (!controller.signal.aborted) setError(message(failure));
    });
    return () => controller.abort();
  }, [attempt]);
  const expiresAt = status?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(
      () => {
        setStatus((current) =>
          current?.expiresAt === expiresAt ? { ...current, expiresAt: null } : current,
        );
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);
  async function setLogging(minutes: number) {
    setBusy(true);
    setError('');
    try {
      setStatus(await post<DiagnosticsStatus>(path, { minutes }));
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="preferences-section" aria-labelledby="settings-diagnostics-heading">
      <h3 id="settings-diagnostics-heading">{t('Connection diagnostics')}</h3>
      <p className="preference-help">
        {t('Record additional connection timings in the server log for a limited time.')}
      </p>
      {status?.serverOverride ? (
        <p>{t('Detailed logging is enabled by the server environment.')}</p>
      ) : (
        status && (
          <div className="settings-action-row">
            {expiresAt ? (
              <span role="status">
                {t('Logging until {time}', {
                  time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(expiresAt),
                })}
              </span>
            ) : (
              <label className="settings-compact-field">
                {t('Duration')}
                <select
                  value={duration}
                  disabled={busy}
                  onChange={(event) => {
                    const next = diagnosticMinutes.find(
                      (option) => String(option) === event.target.value,
                    );
                    if (next) setDuration(next);
                  }}
                >
                  {diagnosticMinutes.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {t('{count} minutes', { count: minutes })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="settings-action"
              type="button"
              disabled={busy}
              onClick={() => void setLogging(expiresAt ? 0 : duration)}
            >
              {t(expiresAt ? 'Stop diagnostics' : 'Start diagnostics')}
            </button>
          </div>
        )
      )}
      {error && <p role="alert">{t(error)}</p>}
      {error && !status && (
        <button
          className="settings-action"
          type="button"
          onClick={() => {
            setError('');
            setAttempt((previous) => previous + 1);
          }}
        >
          {t('Retry loading')}
        </button>
      )}
      <RuntimePaths version={version} />
    </section>
  );
}
