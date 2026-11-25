import { useInterfaceLanguage } from './interface-language';
import { useEffect, useState } from 'react';
import { runtimeRequestTimeout, type RuntimeSettingsSnapshot } from '../shared/runtime-settings';
import { ApiError, message, request } from './api';

const path = '/settings/runtime';

export function RuntimeSettings({
  onDraft,
}: {
  onDraft: (value: { changed: boolean; busy: boolean }) => void;
}) {
  const { t, locale } = useInterfaceLanguage();
  const [snapshot, setSnapshot] = useState<RuntimeSettingsSnapshot>();
  const [timeout, setTimeout] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const [needsReload, setNeedsReload] = useState(false);

  function populate(next: RuntimeSettingsSnapshot) {
    setSnapshot(next);
    setTimeout(String(next.settings.requestTimeoutMs));
  }

  useEffect(() => {
    const controller = new AbortController();
    void request<RuntimeSettingsSnapshot>(path, {}, controller.signal).then(populate, (failure) => {
      if (!controller.signal.aborted) setError(message(failure));
    });
    return () => controller.abort();
  }, [reload]);

  function loadAgain() {
    setError('');
    setSnapshot(undefined);
    setSaved(false);
    setNeedsReload(false);
    setReload((value) => value + 1);
  }

  const settings = snapshot?.settings;
  const changed = !!settings && timeout !== String(settings.requestTimeoutMs);
  useEffect(() => {
    onDraft({ changed, busy: saving });
  }, [changed, saving, onDraft]);

  if (!snapshot)
    return (
      <div className="preferences-content">
        {error ? (
          <>
            <p role="alert">{t(error)}</p>
            <button type="button" onClick={loadAgain}>
              {t('Retry loading')}
            </button>
          </>
        ) : (
          <p role="status">{t('Loading runtime settings…')}</p>
        )}
      </div>
    );

  async function saveSettings() {
    if (!snapshot || !changed || saving || needsReload) return;
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
      className="preferences-content network-settings"
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
              {t('1,000–300,000 ms. Applies to CLI requests, such as loading metadata.')}
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
            disabled={saving}
          />
        </label>
      </section>
      <section className="preferences-section" aria-labelledby="runtime-paths-heading">
        <h3 id="runtime-paths-heading">{t('Runtime paths')}</h3>
        <dl className="runtime-paths">
          <dt>{t('Codex executable')}</dt>
          <dd>
            <code>{snapshot.executable}</code>
          </dd>
          <dt>{t('Data directory')}</dt>
          <dd>
            <code>{snapshot.dataDirectory}</code>
          </dd>
        </dl>
      </section>
      {snapshot.restartRequired ? (
        <p role="status">
          {t('Saved. Restart Codes to apply. Active timeout {timeout} ms.', {
            timeout: snapshot.active.requestTimeoutMs.toLocaleString(locale),
          })}
        </p>
      ) : saved && !changed ? (
        <p role="status">{t('Runtime settings saved.')}</p>
      ) : null}
      {error && <p role="alert">{t(error)}</p>}
      <div className="network-actions">
        {needsReload && (
          <button type="button" onClick={loadAgain}>
            {t('Reload settings')}
          </button>
        )}
        <button
          type="submit"
          className="preferences-done"
          aria-label={saving ? t('Saving…') : t('Save runtime settings')}
          disabled={!changed || saving || needsReload}
        >
          {saving ? t('Saving…') : t('Save')}
        </button>
      </div>
    </form>
  );
}
