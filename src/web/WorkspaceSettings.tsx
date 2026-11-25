import { useEffect, useState } from 'react';
import { sessionHours, type WorkspaceSettingsSnapshot } from '../shared/workspace-settings';
import { ApiError, message, request } from './api';
import { useInterfaceLanguage } from './interface-language';

const path = '/settings/workspace';
type Draft = { changed: boolean; busy: boolean };

export function WorkspaceSettings({
  field,
  onDraft,
  onSaved,
  fallbackDirectory,
  activeDirectory,
}: {
  field: 'defaultProjectDirectory' | 'sessionHours';
  onDraft: (draft: Draft) => void;
  onSaved?: () => void;
  fallbackDirectory?: string;
  activeDirectory?: string;
}) {
  const { t } = useInterfaceLanguage();
  const [snapshot, setSnapshot] = useState<WorkspaceSettingsSnapshot>();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(false);
  const directory = field === 'defaultProjectDirectory';
  const heading = directory ? 'New project default' : 'Sign-in session';
  const label = directory ? 'Default project directory' : 'Login validity';
  const changed = !!snapshot && value.trim() !== String(snapshot.settings[field]);

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
        setValue(String(next.settings[field]));
      },
      (failure) => {
        if (!controller.signal.aborted) setError(message(failure));
      },
    );
    return () => controller.abort();
  }, [attempt, field]);

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
          field,
          expected: snapshot.settings[field],
          value: directory ? value : Number(value),
        }),
      });
      setSnapshot(next);
      setValue(String(next.settings[field]));
      setSaved(true);
      onSaved?.();
    } catch (failure) {
      setError(message(failure));
      setReload(failure instanceof ApiError && (failure.status === 409 || failure.uncertain));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="preferences-section" aria-labelledby={'settings-heading-' + field}>
      <h3 id={'settings-heading-' + field}>{t(heading)}</h3>
      <form
        className="network-settings"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {snapshot && (
          <label className={directory ? undefined : 'settings-compact-field'}>
            {t(label)}
            {directory ? (
              <input
                value={value}
                placeholder={
                  fallbackDirectory ??
                  (snapshot.settings.defaultProjectDirectory ? undefined : activeDirectory)
                }
                aria-describedby={'settings-help-' + field}
                disabled={busy}
                maxLength={2048}
                spellCheck={false}
                onChange={(event) => {
                  setValue(event.target.value);
                  setSaved(false);
                }}
              />
            ) : (
              <select
                value={value}
                aria-describedby={'settings-help-' + field}
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
            )}
          </label>
        )}
        <p className="preference-help" id={'settings-help-' + field}>
          {t(
            directory
              ? 'Prefills Add project. Leave empty to use the server default.'
              : 'Applies to new sign-ins. Existing sessions keep their expiry.',
          )}
        </p>
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
              aria-label={t(directory ? 'Save default project directory' : 'Save login validity')}
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
