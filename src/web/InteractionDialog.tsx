import { useInterfaceLanguage } from './interface-language';
import type { Preferences } from './browser-preferences';
import type { NativeConfigurationSnapshot } from '../shared/native-configuration';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ReviewTarget, System, Thread } from '../shared/types';
import { message } from './api';
import { IconButton } from './primitives';
export function InteractionDialog({
  title,
  close,
  children,
  busy = false,
  className = '',
  initialFocus,
  closeOnBackdrop = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  busy?: boolean;
  className?: string;
  initialFocus?: string;
  closeOnBackdrop?: boolean;
}) {
  const { t } = useInterfaceLanguage();
  const dialog = useRef<HTMLDivElement>(null);
  // Capture the opener before mounting auto-focused fields or making the workspace inert.
  const previous = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    dialog.current
      ?.querySelector<HTMLElement>(initialFocus ?? 'button,select,input,textarea')
      ?.focus();
    return () => {
      const opener = previous.current;
      if (opener?.isConnected && opener.checkVisibility() && !opener.closest('[inert]'))
        opener.focus();
    };
  }, [initialFocus]);
  return (
    <div
      className="modal-backdrop interaction-backdrop"
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget && !busy) close();
      }}
    >
      <div
        className={`modal interaction-dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation();
            close();
          }
          if (event.key !== 'Tab') return;
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href]',
            ),
          ].filter((element) => element.checkVisibility());
          if (event.shiftKey && document.activeElement === controls[0]) {
            event.preventDefault();
            controls.at(-1)?.focus();
          } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
            event.preventDefault();
            controls[0]?.focus();
          }
        }}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <IconButton icon="close" label={t('Close dialog')} disabled={busy} onClick={close} />
        </div>
        {children}
      </div>
    </div>
  );
}
export function ReviewDialog({
  close,
  submit,
  delivery: initial,
  inlineAvailable,
}: {
  close: () => void;
  submit: (target: ReviewTarget, delivery: Preferences['review']) => Promise<void>;
  delivery: Preferences['review'];
  inlineAvailable: boolean;
}) {
  const { t } = useInterfaceLanguage();
  const [type, setType] = useState<ReviewTarget['type']>('uncommittedChanges');
  const [detail, setDetail] = useState('');
  const [delivery, setDelivery] = useState(inlineAvailable ? initial : 'detached');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <InteractionDialog title={t('Review code')} close={close} busy={busy}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          const target: ReviewTarget =
            type === 'baseBranch'
              ? { type, branch: detail.trim() }
              : type === 'commit'
                ? { type, sha: detail.trim() }
                : type === 'custom'
                  ? { type, instructions: detail.trim() }
                  : { type };
          void submit(target, delivery as Preferences['review'])
            .then(close)
            .catch((error) => setError(message(error)))
            .finally(() => setBusy(false));
        }}
      >
        <p>{t('Reviews run in Read only mode.')}</p>
        <label>
          {t('Review target')}
          <select
            aria-label={t('Review target')}
            value={type}
            disabled={busy}
            onChange={(e) => {
              setType(e.target.value as ReviewTarget['type']);
              setDetail('');
            }}
          >
            <option value="uncommittedChanges">{t('Uncommitted changes')}</option>
            <option value="baseBranch">{t('Compare with a base branch')}</option>
            <option value="commit">{t('A specific commit')}</option>
            <option value="custom">{t('Custom review instructions')}</option>
          </select>
        </label>
        {type !== 'uncommittedChanges' && (
          <label>
            {type === 'baseBranch'
              ? t('Base branch')
              : type === 'commit'
                ? t('Commit SHA')
                : t('Review instructions')}
            <input
              aria-label={t('Review details')}
              value={detail}
              maxLength={type === 'custom' ? 4000 : 200}
              required
              disabled={busy}
              pattern={type === 'commit' ? '[a-fA-F0-9]{7,64}' : undefined}
              onChange={(e) => setDetail(e.target.value)}
            />
          </label>
        )}
        <label>
          {t('Review location')}
          <select
            aria-label={t('Review location')}
            value={delivery}
            disabled={busy}
            onChange={(e) => setDelivery(e.target.value as Preferences['review'])}
          >
            <option value="inline" disabled={!inlineAvailable}>
              {t('Current conversation')}
            </option>
            <option value="detached">{t('Separate conversation')}</option>
          </select>
        </label>
        {delivery === 'detached' && <p>{t('A separate conversation shares the project files.')}</p>}
        {error && (
          <p role="alert" className="error-text">
            {t(error)}
          </p>
        )}
        <button
          className="primary"
          disabled={busy || (type !== 'uncommittedChanges' && !detail.trim())}
        >
          {busy ? t('Starting review…') : t('Start review')}
        </button>
      </form>
    </InteractionDialog>
  );
}
export function StatusDialog({
  system,
  maintenanceBusy,
  changeMaintenance,
  thread,
  configuration,
  connection,
  openUsage,
  close,
}: {
  system?: System;
  maintenanceBusy: boolean;
  changeMaintenance: (action: 'start' | 'cancel') => Promise<void>;
  thread?: Thread;
  configuration?: NativeConfigurationSnapshot;
  connection: string;
  openUsage: () => void;
  close: () => void;
}) {
  const { t, locale } = useInterfaceLanguage();
  const usage = thread?.usage;
  return (
    <InteractionDialog title={t('Session status')} close={close}>
      <dl className="session-status">
        <dt>{t('Browser connection')}</dt>
        <dd>{t(connection)}</dd>
        <dt>{t('Runtime')}</dt>
        <dd>
          {system?.runtime ?? t('Unknown')} · {system?.state ?? t('Unknown')}
        </dd>
        <dt>{t('CLI version')}</dt>
        <dd>{system?.version ?? t('Unknown')}</dd>
        <dt>{t('Effective project configuration')}</dt>
        <dd>
          {[
            configuration?.model,
            configuration?.effort,
            configuration?.serviceTier,
            configuration?.permissionProfile ?? configuration?.sandbox,
          ]
            .filter(Boolean)
            .join(' · ') || t('Not reported')}
        </dd>
        <dt>{t('Model')}</dt>
        <dd>{thread?.nativeSettings?.model ?? t('Not reported')}</dd>
        <dt>{t('Reasoning')}</dt>
        <dd>{thread?.nativeSettings?.effort ?? t('Not reported')}</dd>
        <dt>{t('Service tier')}</dt>
        <dd>{thread?.nativeSettings?.serviceTier ?? t('Not reported')}</dd>
        <dt>{t('Mode')}</dt>
        <dd>
          {thread?.nativeSettings?.mode
            ? t(thread.nativeSettings.mode === 'plan' ? 'Plan' : 'Code')
            : t('Not reported')}
        </dd>
        <dt>{t('Clarification questions')}</dt>
        <dd>
          {configuration?.codeQuestions === undefined
            ? t('Not reported')
            : t(configuration.codeQuestions ? 'Enabled' : 'Disabled')}
        </dd>
        <dt>{t('Permissions')}</dt>
        <dd>
          {[
            thread?.nativeSettings?.permissionProfile ?? thread?.nativeSettings?.sandbox,
            thread?.nativeSettings?.approvalPolicy,
            thread?.nativeSettings?.approvalsReviewer,
          ]
            .filter(Boolean)
            .join(' · ') || t('Not reported')}
        </dd>
        <dt>{t('Conversation')}</dt>
        <dd>{thread?.id ?? t('Not created')}</dd>
        <dt>{t('Turn')}</dt>
        <dd>{thread?.turnId ?? t('No turn')}</dd>
        <dt>{t('Latest context usage')}</dt>
        <dd>
          {usage
            ? usage.contextWindow
              ? t('{count} tokens', {
                  count:
                    usage.contextTokens.toLocaleString(locale) +
                    ' / ' +
                    usage.contextWindow.toLocaleString(locale),
                })
              : t('{count} tokens; window unknown', {
                  count: usage.contextTokens.toLocaleString(locale),
                })
            : t('Not reported')}
        </dd>
        <dt>{t('CLI token usage')}</dt>
        <dd>
          {usage
            ? t('{count} tokens', { count: usage.totalTokens.toLocaleString(locale) })
            : t('Not reported')}
        </dd>
        <dt>{t('Maintenance')}</dt>
        <dd>
          {system?.maintenance
            ? system.maintenance.ready
              ? t('Ready')
              : t('Waiting for active work')
            : t('Accepting tasks')}
        </dd>
      </dl>
      <div className="status-dialog-actions">
        <button type="button" onClick={openUsage}>
          {t('Usage and billing')}
        </button>
        <button
          disabled={maintenanceBusy}
          onClick={() => void changeMaintenance(system?.maintenance ? 'cancel' : 'start')}
        >
          {system?.maintenance ? t('Cancel maintenance') : t('Prepare maintenance')}
        </button>
      </div>
    </InteractionDialog>
  );
}
