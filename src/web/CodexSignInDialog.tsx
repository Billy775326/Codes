import { useEffect, useState } from 'react';
import type { CodexLoginState } from '../shared/codex-login';
import { message, request } from './api';
import { useInterfaceLanguage } from './interface-language';
import { InteractionDialog } from './InteractionDialog';

const path = '/connection/codex/login';

export function CodexSignInDialog({
  close,
  signedIn,
  connected,
}: {
  close: () => void;
  signedIn: () => void;
  connected: boolean;
}) {
  const { t } = useInterfaceLanguage();
  const [login, setLogin] = useState<CodexLoginState>({ status: 'starting' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copy, setCopy] = useState('');
  const start = async () => {
    setBusy(true);
    setCopy('');
    setError('');
    try {
      setLogin(await request<CodexLoginState>(path, { method: 'POST' }));
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const state = await request<CodexLoginState>(path, {}, controller.signal, 5000);
        if (!controller.signal.aborted) setLogin(state);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(message(error));
          setLogin({ status: 'idle' });
        }
      }
    };
    void load();
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!connected || (login.status !== 'pending' && login.status !== 'starting') || busy) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const check = async () => {
      try {
        const state = await request<CodexLoginState>(path, {}, controller.signal, 5000);
        if (controller.signal.aborted) return;
        failures = 0;
        setError('');
        setLogin(state);
        if (state.status !== 'pending' && state.status !== 'starting') return;
      } catch (error) {
        if (controller.signal.aborted) return;
        setError(message(error));
        if (++failures >= 3) return;
      }
      timer = setTimeout(() => void check(), 2000 * 2 ** failures);
    };
    timer = setTimeout(() => void check(), 2000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [login.status, busy, connected]);
  useEffect(() => {
    if (login.status === 'succeeded') signedIn();
  }, [login.status, signedIn]);
  const cancel = async (loginId: string) => {
    setBusy(true);
    setError('');
    try {
      setLogin(
        await request<CodexLoginState>(path, {
          method: 'DELETE',
          body: JSON.stringify({ loginId }),
        }),
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };
  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopy('Code copied');
    } catch {
      setCopy('Select and copy the code above.');
    }
  };
  return (
    <InteractionDialog title={t('Sign in to Codex')} close={close}>
      {error && <p role="alert">{t(error)}</p>}
      {login.status === 'pending' ? (
        <div className="codex-device-signin">
          <p>{t('Enter this one-time code on the OpenAI sign-in page.')}</p>
          <div className="codex-device-code">
            <code>{login.userCode}</code>
            <button type="button" onClick={() => void copyCode(login.userCode)}>
              {t('Copy code')}
            </button>
          </div>
          {copy && <small role="status">{t(copy)}</small>}
          <a href={login.verificationUrl} target="_blank" rel="noopener noreferrer">
            {t('Open OpenAI sign-in')}
          </a>
          <p role="status">{t('Waiting for Codex sign-in…')}</p>
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={() => void cancel(login.loginId)}>
              {t('Cancel sign-in')}
            </button>
          </div>
        </div>
      ) : login.status === 'succeeded' ? (
        <>
          <p role="status">{t('Codex is signed in.')}</p>
          <div className="dialog-actions">
            <button type="button" onClick={close}>
              {t('Done')}
            </button>
          </div>
        </>
      ) : (
        <>
          {login.status === 'failed' ? (
            <p role="status">
              {t('Codex sign-in did not finish. Request a new code to try again.')}
            </p>
          ) : (
            <p>{t('Use a one-time code to sign in with your ChatGPT account.')}</p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="primary"
              disabled={busy || login.status === 'starting'}
              onClick={() => void start()}
            >
              {busy || login.status === 'starting' ? t('Starting sign-in…') : t('Get device code')}
            </button>
          </div>
        </>
      )}
    </InteractionDialog>
  );
}
