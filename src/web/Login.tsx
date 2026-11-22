import { useInterfaceLanguage } from './interface-language';
import { useState } from 'react';
import { Brand, Icon } from './primitives';
import './login.css';

interface LoginProps {
  token: string;
  error: string;
  checking: boolean;
  busy: boolean;
  onTokenChange: (token: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
}

export function Login({
  token,
  error,
  checking,
  busy,
  onTokenChange,
  onSubmit,
  onRetry,
}: LoginProps) {
  const { t } = useInterfaceLanguage();
  const [visible, setVisible] = useState(false);
  const pending = checking || busy;
  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="sign-in-title">
        <Brand />
        <h1 id="sign-in-title">{t('Open workspace')}</h1>
        <form
          aria-busy={pending}
          onSubmit={(e) => {
            e.preventDefault();
            if (!pending && token) onSubmit();
          }}
        >
          <label htmlFor="access-token">{t('Workspace access token')}</label>
          <div className="login-token-field">
            <input
              id="access-token"
              name="access-token"
              type={visible ? 'text' : 'password'}
              autoComplete="current-password"
              autoCapitalize="off"
              spellCheck={false}
              value={token}
              maxLength={256}
              onChange={(e) => onTokenChange(e.target.value)}
              disabled={pending}
              required
              autoFocus
              placeholder={t('Paste your token')}
              aria-describedby={error ? 'login-error' : undefined}
            />
            <button
              type="button"
              className="login-visibility"
              aria-label={visible ? t('Hide access token') : t('Show access token')}
              aria-pressed={visible}
              disabled={pending}
              onClick={() => setVisible((value) => !value)}
            >
              <Icon name={visible ? 'hidden' : 'eye'} size={18} />
            </button>
          </div>
          {error && (
            <div className="login-error" id="login-error" role="alert">
              <p>{t(error)}</p>
              {checking && (
                <button type="button" onClick={onRetry}>
                  {t('Retry connection')}
                  <Icon name="chevron" size={13} />
                </button>
              )}
            </div>
          )}
          <button className="primary login-submit" type="submit" disabled={pending || !token}>
            <span>
              {checking ? t('Checking session…') : busy ? t('Signing in…') : t('Open workspace')}
            </span>
            {pending ? (
              <span className="login-spinner" aria-hidden="true" />
            ) : (
              <Icon name="chevron" size={18} />
            )}
          </button>
        </form>
        <details className="login-help">
          <summary>
            {t('Where do I find my token?')}
            <Icon name="chevron" size={13} />
          </summary>
          <p>
            {t('The default file is') + ' '}
            <code>.local/access-token</code>
            {' ' +
              t('on your server. If you configured a different workspace token, use that value.')}
          </p>
        </details>
      </section>
    </main>
  );
}
