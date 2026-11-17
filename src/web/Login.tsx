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
  const [visible, setVisible] = useState(false);
  const pending = checking || busy;
  return (
    <main className="login-shell">
      <div className="login-frame">
        <header className="login-header">
          <Brand />
          <span className="login-private">
            <Icon name="lock" size={13} />
            Private workspace
          </span>
        </header>
        <div className="login-content">
          <section className="login-intro" aria-labelledby="login-title">
            <p className="login-eyebrow">CODEX, IN YOUR BROWSER</p>
            <h1 id="login-title">
              Your code.
              <br />
              <span>In clear focus.</span>
            </h1>
            <p className="login-description">
              Continue conversations, review changes, and approve the next step. All from your own
              server.
            </p>
            <ul className="login-features">
              <li>
                <span className="login-feature-icon">
                  <Icon name="terminal" />
                </span>
                <div>
                  <strong>Conversations</strong>
                  <p>Keep context close to your work.</p>
                </div>
              </li>
              <li>
                <span className="login-feature-icon">
                  <Icon name="review" />
                </span>
                <div>
                  <strong>Change review</strong>
                  <p>See what changed before moving on.</p>
                </div>
              </li>
              <li>
                <span className="login-feature-icon">
                  <Icon name="check" />
                </span>
                <div>
                  <strong>Approvals</strong>
                  <p>Stay in control of the next step.</p>
                </div>
              </li>
            </ul>
          </section>
          <section className="login-panel" aria-labelledby="sign-in-title">
            <div className="login-panel-heading">
              <span className="login-lock">
                <Icon name="lock" size={20} />
              </span>
              <span>WORKSPACE ACCESS</span>
            </div>
            <h2 id="sign-in-title">Open your workspace</h2>
            <p className="login-panel-description">Sign in with your workspace access token.</p>
            <form
              aria-busy={pending}
              onSubmit={(e) => {
                e.preventDefault();
                if (!pending && token) onSubmit();
              }}
            >
              <label htmlFor="access-token">Workspace access token</label>
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
                  placeholder="Paste your token"
                  aria-describedby={`token-hint${error ? ' login-error' : ''}`}
                />
                <button
                  type="button"
                  className="login-visibility"
                  aria-label={visible ? 'Hide access token' : 'Show access token'}
                  aria-pressed={visible}
                  disabled={pending}
                  onClick={() => setVisible((value) => !value)}
                >
                  <Icon name={visible ? 'hidden' : 'eye'} size={18} />
                </button>
              </div>
              <p className="login-token-hint" id="token-hint">
                This is separate from your Codex sign-in.
              </p>
              {error && (
                <div className="login-error" id="login-error" role="alert">
                  <p>{error}</p>
                  {checking && (
                    <button type="button" onClick={onRetry}>
                      Retry connection
                      <Icon name="chevron" size={13} />
                    </button>
                  )}
                </div>
              )}
              <button className="primary login-submit" type="submit" disabled={pending || !token}>
                <span>
                  {checking ? 'Checking session…' : busy ? 'Signing in…' : 'Open workspace'}
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
                Where do I find my token?
                <Icon name="chevron" size={13} />
              </summary>
              <p>
                The default file is <code>.local/access-token</code> on your server. If you
                configured a different workspace token, use that value.
              </p>
            </details>
            <div className="login-host-note">
              <Icon name="lock" size={13} />
              <span>Your Codex sign-in stays on the server.</span>
            </div>
          </section>
        </div>
        <footer className="login-footer">
          <span>Built around your code, on your terms.</span>
          <span>Single-user · Self-hosted on Linux</span>
        </footer>
      </div>
    </main>
  );
}
