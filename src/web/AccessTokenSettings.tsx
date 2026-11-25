import { useEffect, useId, useRef, useState } from 'react';
import {
  accessTokenLimits,
  validNewAccessToken,
  type AccessTokenSource,
} from '../shared/access-token';
import { ApiError, message, request } from './api';
import { useInterfaceLanguage } from './interface-language';

const endpoint = '/settings/access-token';
type Draft = { changed: boolean; busy: boolean };

export function AccessTokenSettings({
  onDraft,
  otherSettingsPending,
  onSignIn,
}: {
  onDraft: (draft: Draft) => void;
  otherSettingsPending: boolean;
  onSignIn: (message: string) => void;
}) {
  const { t } = useInterfaceLanguage();
  const formId = useId();
  const [source, setSource] = useState<AccessTokenSource>();
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState('');
  const [replacement, setReplacement] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const changed = !!(current || replacement || confirmation);

  useEffect(() => {
    const controller = new AbortController();
    void request<{ source: AccessTokenSource }>(endpoint, {}, controller.signal).then(
      (status) => setSource(status.source),
      (failure) => {
        if (!controller.signal.aborted) setError(message(failure));
      },
    );
    return () => controller.abort();
  }, [reload]);
  useEffect(() => onDraft({ changed, busy }), [busy, changed, onDraft]);

  function clear() {
    setCurrent('');
    setReplacement('');
    setConfirmation('');
    setError('');
    setEditing(false);
    trigger.current?.focus();
  }

  async function save() {
    if (
      !current ||
      !validNewAccessToken(replacement) ||
      replacement !== confirmation ||
      busy ||
      otherSettingsPending
    )
      return;
    setBusy(true);
    setError('');
    try {
      await request(endpoint, {
        method: 'PUT',
        body: JSON.stringify({ current, replacement }),
      });
      clear();
      onSignIn('Access token changed. Sign in with your new token.');
    } catch (failure) {
      if (failure instanceof ApiError && failure.uncertain) {
        clear();
        onSignIn('The token change could not be confirmed. Try signing in with your new token.');
      } else {
        setError(message(failure));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="preferences-section" aria-labelledby={formId + '-title'}>
      <div className="settings-section-header">
        <h3 id={formId + '-title'}>{t('Access token')}</h3>
        {source === 'file' && (
          <button
            ref={trigger}
            className="settings-action"
            type="button"
            aria-expanded={editing}
            aria-controls={editing ? formId : undefined}
            disabled={busy}
            onClick={() => (editing ? clear() : setEditing(true))}
          >
            {t('Change access token')}
          </button>
        )}
      </div>
      {source === 'environment' ? (
        <p className="preference-help">
          {t(
            'This server uses CODES_ACCESS_TOKEN. Change it in the server environment and restart Codes.',
          )}
        </p>
      ) : (
        source === 'file' &&
        editing && (
          <form
            id={formId}
            className="network-settings access-token-settings"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label>
              {t('Current token')}
              <input
                type="password"
                name="current-token"
                autoComplete="current-password"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={accessTokenLimits.max}
                disabled={busy}
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                required
              />
            </label>
            <div className="access-token-fields">
              <label>
                {t('New token')}
                <input
                  type="password"
                  name="new-token"
                  autoComplete="new-password"
                  autoCapitalize="off"
                  spellCheck={false}
                  minLength={accessTokenLimits.min}
                  maxLength={accessTokenLimits.max}
                  disabled={busy}
                  value={replacement}
                  aria-describedby={formId + '-help'}
                  onChange={(event) => setReplacement(event.target.value)}
                  required
                />
              </label>
              <label>
                {t('Confirm new token')}
                <input
                  type="password"
                  name="confirm-new-token"
                  autoComplete="new-password"
                  autoCapitalize="off"
                  spellCheck={false}
                  maxLength={accessTokenLimits.max}
                  disabled={busy}
                  value={confirmation}
                  aria-invalid={!!confirmation && confirmation !== replacement}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                />
              </label>
            </div>
            <p className="preference-help" id={formId + '-help'}>
              {t('Use 16–256 characters without surrounding whitespace or control characters.')}
            </p>
            <p className="preference-help">
              {t('Changing the token signs out all browsers. Running tasks continue.')}
            </p>
            {confirmation && confirmation !== replacement && (
              <p role="status">{t('The new tokens do not match.')}</p>
            )}
            {otherSettingsPending && (
              <p role="status">{t('Save or discard other settings before changing the token.')}</p>
            )}
            <div className="network-actions">
              <button type="button" className="settings-action" disabled={busy} onClick={clear}>
                {t('Cancel')}
              </button>
              <button
                type="submit"
                className="settings-action"
                disabled={
                  !current ||
                  !validNewAccessToken(replacement) ||
                  replacement !== confirmation ||
                  busy ||
                  otherSettingsPending
                }
              >
                {busy ? t('Saving…') : t('Save new token')}
              </button>
            </div>
          </form>
        )
      )}
      {error && <p role="alert">{t(error)}</p>}
      {!source && error && (
        <button
          className="settings-action"
          type="button"
          onClick={() => {
            setError('');
            setReload((value) => value + 1);
          }}
        >
          {t('Retry loading')}
        </button>
      )}
    </section>
  );
}
