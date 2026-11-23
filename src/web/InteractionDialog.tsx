import { useInterfaceLanguage } from './interface-language';
import { chatFontSizes, codeFontSizes } from './font-sizes';
import { defaultBrowserPreferences, type Preferences } from './browser-preferences';
import { ModelSettingsFields } from './ComposerControls';
import { permissionPresets } from '../shared/permissions';
import type { Model } from '../shared/types';
import { permissionLabel } from '../shared/permissions';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ReviewTarget, Settings, System, Thread } from '../shared/types';
import { message } from './api';
import { NetworkSettings } from './NetworkSettings';
import { RuntimeSettings } from './RuntimeSettings';
import { IconButton } from './primitives';
import { NotificationSettings } from './NotificationSettings';
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
function ResetSettings({
  label,
  detail,
  reset,
  disabled,
}: {
  label: string;
  detail: string;
  reset: () => void;
  disabled?: boolean;
}) {
  const { t } = useInterfaceLanguage();
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dismiss = () => {
    setConfirming(false);
    trigger.current?.focus();
  };
  return (
    <div className="preferences-reset">
      <button
        ref={trigger}
        type="button"
        aria-expanded={confirming}
        disabled={disabled}
        onClick={() => setConfirming(!confirming)}
      >
        {label}
      </button>
      {confirming && (
        <div role="group" aria-label={t('{label} confirmation', { label })}>
          <p>{detail}</p>
          <div className="preferences-reset-actions">
            <button type="button" onClick={dismiss} autoFocus>
              {t('Cancel')}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                reset();
                dismiss();
              }}
            >
              {t('Confirm reset')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export function PreferencesDialog({
  value,
  change,
  changeNotifications,
  close,
  saveError,
  defaults,
}: {
  value: Preferences;
  change: (value: Preferences) => void;
  changeNotifications: (enabled: boolean) => void;
  close: () => void;
  saveError?: string;
  defaults: {
    settings?: Settings;
    saving: boolean;
    loading: boolean;
    error: string;
    conflict: boolean;
    change: (value: Settings) => void;
    retry: () => void;
    models: Model[];
    autoReviewReady: boolean;
    modesReady: boolean;
    planReady: boolean;
  };
}) {
  const { t } = useInterfaceLanguage();
  const [section, setSection] = useState<'preferences' | 'network' | 'runtime'>('preferences');
  const [visited, setVisited] = useState({ preferences: true, network: false, runtime: false });
  const [networkDraft, setNetworkDraft] = useState({ changed: false, busy: false });
  const [runtimeDraft, setRuntimeDraft] = useState({ changed: false, busy: false });
  const [discarding, setDiscarding] = useState(false);
  const sectionButton = useRef<HTMLButtonElement>(null);
  const discardBusy = networkDraft.busy || runtimeDraft.busy;
  const selectSection = (value: typeof section) => {
    setVisited((previous) => (previous[value] ? previous : { ...previous, [value]: true }));
    setSection(value);
  };
  const returnFocus = useRef(false);
  const stay = () => {
    returnFocus.current = true;
    setDiscarding(false);
  };
  useEffect(() => {
    if (!discarding && returnFocus.current) {
      returnFocus.current = false;
      sectionButton.current?.focus();
    }
  }, [discarding]);
  const requestClose = () => {
    if (discarding) {
      stay();
    } else if (networkDraft.changed || runtimeDraft.changed) {
      setDiscarding(true);
    } else {
      close();
    }
  };
  const preferences = (
    <>
      <div className="preferences-content">
        <section className="preferences-section" aria-labelledby="preferences-appearance">
          <h3 id="preferences-appearance">{t('Appearance')}</h3>
          <label className="preference-row">
            <span className="preference-description">{t('Language')}</span>
            <select
              value={value.language}
              onChange={(event) =>
                change({ ...value, language: event.target.value === 'zh-CN' ? 'zh-CN' : 'en' })
              }
            >
              <option value="en" lang="en">
                English
              </option>
              <option value="zh-CN" lang="zh-CN">
                简体中文
              </option>
            </select>
          </label>
          <label className="preference-row">
            <span className="preference-description">{t('Theme')}</span>
            <select
              aria-label={t('Theme')}
              value={value.theme}
              onChange={(event) =>
                change({ ...value, theme: event.target.value as Preferences['theme'] })
              }
            >
              <option value="dark">{t('Dark')}</option>
              <option value="light">{t('Light')}</option>
              <option value="system">{t('System')}</option>
            </select>
          </label>
          <div className="preferences-fonts">
            <label>
              {t('Chat text size')}
              <select
                aria-label={t('Chat text size')}
                value={value.chatFontSize ?? ''}
                onChange={(event) =>
                  change({
                    ...value,
                    chatFontSize: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              >
                <option value="">{t('Default')}</option>
                {chatFontSizes.map((size) => (
                  <option key={size} value={size}>
                    {size} px
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Code text size')}
              <select
                aria-label={t('Code text size')}
                value={value.codeFontSize ?? ''}
                onChange={(event) =>
                  change({
                    ...value,
                    codeFontSize: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              >
                <option value="">{t('Default')}</option>
                {codeFontSizes.map((size) => (
                  <option key={size} value={size}>
                    {size} px
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="preferences-preview" role="region" aria-label={t('Text preview')}>
            <div className="prose">
              <p>
                {t('Aa Bb Cc · 0123456789')}
                <br />
                中文字体预览。
              </p>
              <pre>
                <code>const message = "Hello, Codex";</code>
              </pre>
            </div>
          </div>
        </section>
        <section
          className="preferences-section"
          aria-labelledby="preferences-defaults"
          role="region"
          aria-label={t('New conversation defaults')}
        >
          <h3 id="preferences-defaults">{t('New conversation defaults')}</h3>
          {defaults.settings && (
            <>
              <label className="preference-row">
                <span className="preference-description">{t('Permissions')}</span>
                <select
                  aria-label={t('Default permissions')}
                  value={defaults.settings.permission}
                  disabled={defaults.loading}
                  onChange={(event) =>
                    defaults.change({
                      ...defaults.settings!,
                      permission: event.target.value as Settings['permission'],
                    })
                  }
                >
                  {permissionPresets.map((preset) => (
                    <option
                      key={preset.id}
                      value={preset.id}
                      disabled={preset.id === 'auto-review' && !defaults.autoReviewReady}
                    >
                      {t(preset.label)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="preference-help">
                {t(
                  permissionPresets.find((preset) => preset.id === defaults.settings!.permission)
                    ?.description ?? '',
                )}
              </p>
              <div className="default-model-settings">
                <ModelSettingsFields
                  defaults
                  settings={defaults.settings}
                  change={defaults.change}
                  models={defaults.models}
                  modesReady={defaults.modesReady}
                  planReady={defaults.planReady}
                  disabled={defaults.loading}
                />
              </div>
              <ResetSettings
                label={t('Reset new conversation defaults')}
                detail={t('Restore default permissions, model, reasoning, mode, and speed.')}
                disabled={defaults.loading || defaults.conflict}
                reset={() => defaults.change({ permission: 'read-only' })}
              />
            </>
          )}
          {defaults.loading && <p role="status">{t('Loading defaults…')}</p>}
          {defaults.saving && <p role="status">{t('Saving defaults…')}</p>}
          {defaults.error && (
            <p role="alert">
              {t(defaults.error)}{' '}
              <button onClick={defaults.retry}>
                {defaults.conflict ? t('Reload default settings') : t('Retry default settings')}
              </button>
            </p>
          )}
        </section>
        <section className="preferences-section" aria-labelledby="preferences-interaction">
          <h3 id="preferences-interaction">{t('Interaction')}</h3>
          <label className="preference-row">
            <span className="preference-description">{t('Follow-up delivery')}</span>
            <select
              aria-label={t('Follow-up delivery')}
              value={value.followUp}
              onChange={(event) =>
                change({ ...value, followUp: event.target.value as Preferences['followUp'] })
              }
            >
              <option value="queue">{t('Queue for next turn')}</option>
              <option value="steer">{t('Add to running task')}</option>
            </select>
          </label>
          <label className="preference-row">
            <span className="preference-description">{t('Send shortcut')}</span>
            <select
              aria-label={t('Send shortcut')}
              value={value.enter}
              onChange={(event) =>
                change({ ...value, enter: event.target.value as Preferences['enter'] })
              }
            >
              <option value="enter">{t('Enter')}</option>
              <option value="cmdIfMultiline">{t('Multiline: Ctrl/Cmd+Enter')}</option>
              <option value="cmdAlways">Ctrl/Cmd+Enter</option>
            </select>
          </label>
          <label className="preference-row">
            <span className="preference-description">{t('Review location')}</span>
            <select
              aria-label={t('Review location')}
              value={value.review}
              onChange={(event) =>
                change({ ...value, review: event.target.value as Preferences['review'] })
              }
            >
              <option value="inline">{t('Current conversation')}</option>
              <option value="detached">{t('Separate conversation')}</option>
            </select>
          </label>
          <label className="preference-row">
            <span>{t('Scroll with replies')}</span>
            <input
              className="preference-checkbox"
              type="checkbox"
              role="switch"
              checked={value.autoScroll}
              onChange={(event) => change({ ...value, autoScroll: event.target.checked })}
            />
          </label>
          <details className="preferences-help">
            <summary>{t('Editing and shortcuts')}</summary>
            <p>
              {t(
                'Shift+Enter adds a line. On phones, Enter adds a line. Ctrl/Cmd+Shift+Enter switches delivery for one follow-up.',
              )}
            </p>
            <p>
              {t(
                'Queued messages can be edited until dispatch. Immediate additions use the running task’s settings.',
              )}
            </p>
          </details>
        </section>
        <NotificationSettings enabled={value.notifications} change={changeNotifications} />
      </div>
      <div className="preferences-footer">
        {saveError && (
          <div className="preferences-save-error">
            <span role="alert">{t(saveError)}</span>
            <button type="button" onClick={() => change(value)}>
              {t('Retry save')}
            </button>
          </div>
        )}
        <ResetSettings
          label={t('Reset browser settings')}
          detail={t(
            'Restore language, theme, text sizes, interaction and notification preferences in this browser.',
          )}
          reset={() => change(defaultBrowserPreferences)}
        />
        <button
          className="preferences-done"
          type="button"
          onClick={requestClose}
          disabled={discardBusy}
        >
          {t('Done')}
        </button>
      </div>
    </>
  );
  return (
    <InteractionDialog
      title={t('Interaction settings')}
      close={requestClose}
      busy={discardBusy}
      className="preferences-dialog"
    >
      <div className="preferences-page" hidden={discarding}>
        <div className="preferences-nav" role="group" aria-label={t('Settings sections')}>
          <button
            type="button"
            ref={section === 'preferences' ? sectionButton : undefined}
            aria-pressed={section === 'preferences'}
            onClick={() => selectSection('preferences')}
          >
            {t('Preferences')}
          </button>
          <button
            type="button"
            ref={section === 'network' ? sectionButton : undefined}
            aria-pressed={section === 'network'}
            onClick={() => selectSection('network')}
          >
            {t('Network & access')}
          </button>
          <button
            type="button"
            ref={section === 'runtime' ? sectionButton : undefined}
            aria-pressed={section === 'runtime'}
            onClick={() => selectSection('runtime')}
          >
            {t('Runtime')}
          </button>
        </div>
        <div className="preferences-page" hidden={section !== 'preferences'}>
          {preferences}
        </div>
        {visited.network && (
          <div className="preferences-page" hidden={section !== 'network'}>
            <NetworkSettings onDraft={setNetworkDraft} />
          </div>
        )}
        {visited.runtime && (
          <div className="preferences-page" hidden={section !== 'runtime'}>
            <RuntimeSettings onDraft={setRuntimeDraft} />
          </div>
        )}
      </div>
      {discarding && (
        <div
          className="preferences-content preferences-discard"
          role="group"
          aria-labelledby="discard-settings-heading"
        >
          <h3 id="discard-settings-heading">{t('Discard unsaved settings?')}</h3>
          <p>{t('Unsaved Network & access and Runtime edits will be lost.')}</p>
          <div className="network-actions">
            <button type="button" autoFocus onClick={stay}>
              {t('Keep editing')}
            </button>
            <button type="button" onClick={close}>
              {t('Discard changes')}
            </button>
          </div>
        </div>
      )}
    </InteractionDialog>
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
  settings,
  connection,
  close,
}: {
  system?: System;
  maintenanceBusy: boolean;
  changeMaintenance: (action: 'start' | 'cancel') => Promise<void>;
  thread?: Thread;
  settings: Settings;
  connection: string;
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
        <dt>{t('Model')}</dt>
        <dd>{settings.model || thread?.resolvedModel || t('CLI default')}</dd>
        <dt>{t('Reasoning')}</dt>
        <dd>{t(settings.effort || 'Model default')}</dd>
        <dt>{t('Mode')}</dt>
        <dd>{settings.mode === 'plan' ? t('Plan') : t('Code')}</dd>
        <dt>{t('Clarification questions')}</dt>
        <dd>
          {system?.codeQuestions === true
            ? t('Code and Plan, when Codex needs input')
            : system?.codeQuestions === false
              ? t('Plan mode only')
              : t('Not reported')}
        </dd>
        <dt>{t('Permissions')}</dt>
        <dd>{t(permissionLabel(settings.permission))}</dd>
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
      <button
        disabled={maintenanceBusy}
        onClick={() => void changeMaintenance(system?.maintenance ? 'cancel' : 'start')}
      >
        {system?.maintenance ? t('Cancel maintenance') : t('Prepare maintenance')}
      </button>
    </InteractionDialog>
  );
}
