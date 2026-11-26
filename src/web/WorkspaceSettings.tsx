import { useEffect, useState } from 'react';
import { sessionHours, type WorkspaceSettingsSnapshot } from '../shared/workspace-settings';
import { ApiError, message, request } from './api';
import { useInterfaceLanguage } from './interface-language';

const path = '/settings/workspace';
type Draft = { changed: boolean; busy: boolean };

export function WorkspaceSettings({ onDraft }: { onDraft: (draft: Draft) => void }) {
  const { t } = useInterfaceLanguage();
  const [snapshot, setSnapshot] = useState<WorkspaceSettingsSnapshot>();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(false);
  const changed = !!snapshot && value !== String(snapshot.settings.sessionHours);

  function load() {
    setError('');
    setSaved(false);
    setReload(false);
    setSnapshot(undefined);
    setAttempt((previous) => previous + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    void request<WorkspaceSettingsSnapshot>(path, {}, controller.signal).then(
      (next) => {
        setSnapshot(next);
        setValue(String(next.settings.sessionHours));
      },
      (failure) => {
        if (!controller.signal.aborted) setError(message(failure));
      },
    );
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => onDraft({ changed, busy }), [busy, changed, onDraft]);
  async function save() {
    if (!snapshot || !changed || busy || reload) return;
    setBusy(true);
    setSaved(false);
    setError('');
    try {
      const next = await request<WorkspaceSettingsSnapshot>(path, {
        method: 'PATCH',
        body: JSON.stringify({
          field: 'sessionHours',
          expected: snapshot.settings.sessionHours,
          value: Number(value),
        }),
      });
      setSnapshot(next);
      setValue(String(next.settings.sessionHours));
      setSaved(true);
    } catch (failure) {
      setError(message(failure));
      setReload(failure instanceof ApiError && (failure.status === 409 || failure.uncertain));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="preferences-section" aria-labelledby="settings-heading-sessionHours">
      <h3 id="settings-heading-sessionHours">{t('Sign-in session')}</h3>
      <form
        className="network-settings"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {snapshot && (
          <label className="preference-row">
            <span className="preference-description">
              {t('Login validity')}
              <span className="preference-help" id="settings-help-sessionHours">
                {t('Applies to new sign-ins. Existing sessions keep their expiry.')}
              </span>
            </span>
            <select
              value={value}
              aria-label={t('Login validity')}
              aria-describedby="settings-help-sessionHours"
              disabled={busy}
              onChange={(event) => {
                setValue(event.target.value);
                setSaved(false);
              }}
            >
              {sessionHours.map((hours) => (
                <option value={hours} key={hours}>
                  {hours < 24
                    ? t('{count} hours', { count: hours })
                    : t('{count} days', { count: hours / 24 })}
                </option>
              ))}
            </select>
          </label>
        )}
        {!snapshot && !error && <p role="status">{t('Loading workspace settings…')}</p>}
        {error && <p role="alert">{t(error)}</p>}
        {saved && <p role="status">{t('Workspace settings saved.')}</p>}
        <div className="network-actions">
          {(reload || (!snapshot && error)) && (
            <button type="button" className="settings-action" onClick={load}>
              {t('Reload settings')}
            </button>
          )}
          {snapshot && (
            <button
              type="submit"
              className="settings-action"
              aria-label={t('Save login validity')}
              disabled={!changed || busy || reload}
            >
              {busy ? t('Saving…') : t('Save')}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
