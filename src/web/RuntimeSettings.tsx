import { useEffect, useState } from 'react';
import { runtimeRequestTimeout, type RuntimeSettingsSnapshot } from '../shared/runtime-settings';
import { ApiError, message, request } from './api';

const path = '/settings/runtime';

export function RuntimeSettings() {
  const [snapshot, setSnapshot] = useState<RuntimeSettingsSnapshot>();
  const [questions, setQuestions] = useState(true);
  const [timeout, setTimeout] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [needsReload, setNeedsReload] = useState(false);

  function populate(next: RuntimeSettingsSnapshot) {
    setSnapshot(next);
    setQuestions(next.settings.codeQuestions);
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
    setNeedsReload(false);
    setReload((value) => value + 1);
  }

  if (!snapshot)
    return (
      <div className="preferences-content">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button type="button" onClick={loadAgain}>
              Retry loading
            </button>
          </>
        ) : (
          <p role="status">Loading runtime settings…</p>
        )}
      </div>
    );

  const changed =
    questions !== snapshot.settings.codeQuestions ||
    timeout !== String(snapshot.settings.requestTimeoutMs);
  async function saveSettings() {
    if (!snapshot || !changed || saving || needsReload) return;
    setSaving(true);
    setError('');
    try {
      populate(
        await request<RuntimeSettingsSnapshot>(path, {
          method: 'PUT',
          body: JSON.stringify({
            revision: snapshot.revision,
            settings: { codeQuestions: questions, requestTimeoutMs: Number(timeout) },
          }),
        }),
      );
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
      <label className="preference-row">
        <span>Codex questions in Code mode</span>
        <input
          className="preference-checkbox"
          type="checkbox"
          role="switch"
          checked={questions}
          onChange={(event) => setQuestions(event.target.checked)}
          disabled={saving}
        />
      </label>
      <label>
        Native request timeout (milliseconds)
        <input
          type="number"
          min={runtimeRequestTimeout.min}
          max={runtimeRequestTimeout.max}
          step="1"
          required
          value={timeout}
          onChange={(event) => setTimeout(event.target.value)}
          disabled={saving}
        />
      </label>
      <p className="preference-help">
        1,000–300,000 milliseconds. Applies to native RPC requests, such as loading metadata, with
        the default deadline.
      </p>
      <dl className="runtime-paths">
        <dt>Codex executable</dt>
        <dd>
          <code>{snapshot.executable}</code>
        </dd>
        <dt>Data directory</dt>
        <dd>
          <code>{snapshot.dataDirectory}</code>
        </dd>
      </dl>
      {snapshot.restartRequired && (
        <p role="status">
          Saved. Restart Codes to apply. Active timeout{' '}
          {snapshot.active.requestTimeoutMs.toLocaleString()} ms. Code-mode questions{' '}
          {snapshot.active.codeQuestions ? 'enabled' : 'disabled'}.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="network-actions">
        {needsReload && (
          <button type="button" onClick={loadAgain}>
            Reload settings
          </button>
        )}
        <button
          type="submit"
          className="preferences-done"
          disabled={!changed || saving || needsReload}
        >
          {saving ? 'Saving…' : 'Save runtime settings'}
        </button>
      </div>
    </form>
  );
}
