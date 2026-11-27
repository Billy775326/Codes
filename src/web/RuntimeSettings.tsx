import { useInterfaceLanguage } from './interface-language';
import { useEffect, useState } from 'react';
import { runtimeRequestTimeout, type RuntimeSettingsSnapshot } from '../shared/runtime-settings';
import { ApiError, message, request } from './api';
import type { SettingsFormState } from './settings-form';

const path = '/settings/runtime';
export const runtimeForm = 'settings-runtime-form';

export function RuntimeSettings({ onDraft }: { onDraft: (value: SettingsFormState) => void }) {
  const { t, locale } = useInterfaceLanguage();
  const [snapshot, setSnapshot] = useState<RuntimeSettingsSnapshot>();
  const [timeout, setTimeout] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState({ keepDraft: false });
  const [loading, setLoading] = useState(true);
  const [needsReload, setNeedsReload] = useState(false);

  function populate(next: RuntimeSettingsSnapshot) {
    setSnapshot(next);
    setTimeout(String(next.settings.requestTimeoutMs));
  }

  useEffect(() => {
    const controller = new AbortController();
    void request<RuntimeSettingsSnapshot>(path, {}, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        if (reload.keepDraft) setSnapshot(value);
        else populate(value);
        setNeedsReload(false);
        setLoading(false);
      },
      (failure) => {
        if (controller.signal.aborted) return;
        setError(message(failure));
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [reload]);

  function loadAgain(keepDraft: boolean) {
    setError('');
    setSaved(false);
    setLoading(true);
    setReload({ keepDraft });
  }

  const settings = snapshot?.settings;
  const changed = !!settings && timeout !== String(settings.requestTimeoutMs);
  const busy = saving || (loading && changed);
  const canSave = changed && !loading && !saving && !needsReload;
  const restartRequired = snapshot?.restartRequired;
  useEffect(() => {
    onDraft({ changed, busy, canSave, saved, restartRequired });
  }, [changed, busy, canSave, saved, restartRequired, onDraft]);

  if (!snapshot)
    return (
      <div className="codex-runtime-settings">
        {error ? (
          <>
            <p role="alert">{t(error)}</p>
            <button type="button" onClick={() => loadAgain(false)}>
              {t('Retry loading')}
            </button>
          </>
        ) : (
          <p role="status">{t('Loading runtime settings…')}</p>
        )}
      </div>
    );

  async function saveSettings() {
    if (!snapshot || !canSave) return;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      populate(
        await request<RuntimeSettingsSnapshot>(path, {
          method: 'PUT',
          body: JSON.stringify({
            revision: snapshot.revision,
            settings: {
              codeQuestions: snapshot.settings.codeQuestions,
              requestTimeoutMs: Number(timeout),
            },
          }),
        }),
      );
      setSaved(true);
    } catch (failure) {
      setError(message(failure));
      setNeedsReload(failure instanceof ApiError && (failure.status === 409 || failure.uncertain));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      id={runtimeForm}
      className="network-settings codex-runtime-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void saveSettings();
      }}
    >
      <section className="preferences-section" aria-labelledby="native-requests-heading">
        <h3 id="native-requests-heading">{t('Native requests')}</h3>
        <label className="preference-row">
          <span className="preference-description">
            {t('Native request timeout (milliseconds)')}
            <span className="preference-help" id="native-timeout-help">
              {t('1,000–300,000 ms')}
            </span>
          </span>
          <input
            type="number"
            aria-label={t('Native request timeout (milliseconds)')}
            aria-describedby="native-timeout-help"
            min={runtimeRequestTimeout.min}
            max={runtimeRequestTimeout.max}
            step="1"
            required
            value={timeout}
            onChange={(event) => setTimeout(event.target.value)}
            disabled={saving || loading}
          />
        </label>
      </section>
      {snapshot.restartRequired ? (
        <p className="preference-help">
          {t('Saved {saved} ms. Currently {active} ms.', {
            saved: snapshot.settings.requestTimeoutMs.toLocaleString(locale),
            active: snapshot.active.requestTimeoutMs.toLocaleString(locale),
          })}
        </p>
      ) : null}
      {error && <p role="alert">{t(error)}</p>}
      {needsReload && (
        <button
          className="settings-action"
          type="button"
          disabled={loading}
          onClick={() => loadAgain(true)}
        >
          {t('Load latest and keep draft')}
        </button>
      )}
    </form>
  );
}
