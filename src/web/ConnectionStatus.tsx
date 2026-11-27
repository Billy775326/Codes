import { useId, useRef, useState } from 'react';
import type { CodexAccountStatus, System } from '../shared/types';
import { useInterfaceLanguage } from './interface-language';

export interface ConnectionStatusProps {
  web: string;
  webError?: string;
  system?: System;
  account?: CodexAccountStatus;
  checking: boolean;
  checkFailed: boolean;
  reconnect: () => void;
  retryCodex: () => void;
  onSignIn?: () => void;
}

export function ConnectionStatus({
  web,
  webError,
  system,
  account,
  checking,
  checkFailed,
  reconnect,
  retryCodex,
  onSignIn,
  placement,
}: ConnectionStatusProps & { placement: 'header' | 'sidebar' }) {
  const { t } = useInterfaceLanguage();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLElement>(null);
  const [copyResult, setCopyResult] = useState('');
  const inHeader = placement === 'header';
  const webReady = web === 'Connected';
  const runtimeReady = system?.state === 'ready';
  const webLabel = webReady
    ? 'Web connected'
    : web === 'Background'
      ? 'Background'
      : web === 'Sign in required'
        ? 'Codes session expired'
        : web === 'Connecting'
          ? 'Connecting to web…'
          : web === 'Reconnecting'
            ? 'Reconnecting to web…'
            : 'Web disconnected';
  const runtimeLabel = !webReady
    ? 'Not checked'
    : runtimeReady
      ? 'Codex connected'
      : checking ||
          (!checkFailed && (!system || ['not_started', 'starting'].includes(system.state)))
        ? 'Connecting to Codex…'
        : 'Codex disconnected';
  const accountLabel =
    !runtimeReady || !webReady
      ? 'Not checked'
      : account === 'signed-in'
        ? 'Signed in'
        : account === 'signed-out'
          ? 'Codex is not signed in.'
          : account === 'not-required'
            ? 'This provider does not require OpenAI sign-in.'
            : account === 'reload-required'
              ? 'Codex login changed'
              : checking
                ? 'Checking Codex login…'
                : 'Codex login unconfirmed';
  const healthy = webReady && runtimeReady && ['signed-in', 'not-required'].includes(account ?? '');
  const label = t(
    !webReady ? webLabel : !runtimeReady ? runtimeLabel : healthy ? 'Ready' : accountLabel,
  );
  const canReconnect = ['Reconnecting', 'Disconnected', 'Unavailable'].includes(web);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText('codex login');
      setCopyResult('Command copied');
    } catch {
      setCopyResult('Copy the command from the line above.');
    }
  };
  return (
    <div className={inHeader ? 'header-connection-controls' : 'workspace-connection'}>
      <button
        type="button"
        ref={trigger}
        className={(inHeader ? 'header-connection' : 'connection') + (healthy ? ' connected' : '')}
        aria-label={t('Connection: {status}', { status: label })}
        aria-haspopup="dialog"
        popoverTarget={id}
      >
        <i aria-hidden="true" />
        <span aria-live="polite">{label}</span>
      </button>
      <section
        ref={popover}
        className="connection-popover"
        data-placement={placement}
        popover="auto"
        id={id}
        role="dialog"
        aria-label={t('Connection status')}
      >
        <dl>
          <dt>{t('Browser connection')}</dt>
          <dd>{t(webLabel)}</dd>
          <dt>{t('Codex runtime')}</dt>
          <dd>
            {t(runtimeLabel)}
            {webReady &&
              runtimeReady &&
              system?.runtime === 'codex' &&
              system.version !== 'Not reported' && (
                <span className="connection-version"> · {system.version}</span>
              )}
          </dd>
          <dt>{t('Codex account')}</dt>
          <dd>{t(accountLabel)}</dd>
        </dl>
        {canReconnect && (
          <>
            {webError && <p className="connection-detail">{t(webError)}</p>}
            <button type="button" onClick={reconnect}>
              {t('Reconnect web')}
            </button>
          </>
        )}
        {webReady && !runtimeReady && (
          <>
            {system?.error && <p className="connection-detail">{t(system.error)}</p>}
            <button type="button" disabled={checking} onClick={retryCodex}>
              {t('Retry Codex')}
            </button>
          </>
        )}
        {webReady && runtimeReady && (
          <>
            {account === 'signed-out' && (
              <p className="connection-detail">
                {t('Run this on the host as the Linux user running Codes.')}{' '}
                <code>codex login</code>
              </p>
            )}
            {account === 'reload-required' && (
              <p className="connection-detail">
                {t('When active tasks have finished, run {command} to load the updated login.', {
                  command: 'codes restart',
                })}
              </p>
            )}
            <div className="connection-actions">
              {account === 'signed-out' && onSignIn && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    popover.current?.hidePopover();
                    trigger.current?.focus();
                    onSignIn();
                  }}
                >
                  {t('Sign in to Codex')}
                </button>
              )}
              {account === 'signed-out' && (
                <button type="button" onClick={() => void copy()}>
                  {t('Copy sign-in command')}
                </button>
              )}
              <button type="button" disabled={checking} onClick={retryCodex}>
                {t('Check again')}
              </button>
            </div>
            {account === 'signed-out' && copyResult && <p role="status">{t(copyResult)}</p>}
          </>
        )}
      </section>
    </div>
  );
}
