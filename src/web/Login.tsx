import { useInterfaceLanguage } from './interface-language';
import { useState } from 'react';
import { Brand, Icon, IconButton } from './primitives';
import './login.css';

interface LoginProps {
  token: string;
  error: string;
  notice: string;
  checking: boolean;
  busy: boolean;
  onTokenChange: (token: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
}

export function Login({
  token,
  error,
  notice,
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
        <header className="login-heading">
          <Brand />
          <h1 id="sign-in-title">{t('Open workspace')}</h1>
        </header>
        {notice && (
          <p className="login-notice" role="status">
            {t(notice)}
          </p>
        )}
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
              aria-describedby={error ? 'login-error' : undefined}
            />
            <IconButton
              className="login-visibility"
              icon={visible ? 'hidden' : 'eye'}
              size={18}
              label={visible ? t('Hide access token') : t('Show access token')}
              aria-pressed={visible}
              disabled={pending}
              onClick={() => setVisible((value) => !value)}
            />
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
        <footer className="login-details">
          <dl className="login-address">
            <dt>{t('Service address')}</dt>
            <dd>
              <code>{window.location.origin}</code>
            </dd>
          </dl>
          <details className="login-help">
            <summary>
              {t('Where do I find my token?')}
              <Icon name="chevron" size={13} />
            </summary>
            <p>
              {t('Default on the server')} · <code>.local/access-token</code>
            </p>
            <p>{t('If the server uses CODES_ACCESS_TOKEN, use the value configured there.')}</p>
          </details>
        </footer>
      </section>
    </main>
  );
}
