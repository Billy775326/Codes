import { chatFontSizes, codeFontSizes } from './font-sizes';
import { defaultBrowserPreferences, type Preferences } from './browser-preferences';
import { ModelSettingsFields } from './ComposerControls';
import { permissionPresets } from '../shared/permissions';
import type { Model } from '../shared/types';
import { permissionLabel } from '../shared/permissions';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ReviewTarget, Settings, System, Thread } from '../shared/types';
import { message } from './api';
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
          <button type="button" aria-label="Close dialog" disabled={busy} onClick={close}>
            ×
          </button>
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
        <div role="group" aria-label={label + ' confirmation'}>
          <p>{detail}</p>
          <div className="preferences-reset-actions">
            <button type="button" onClick={dismiss} autoFocus>
              Cancel
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                reset();
                dismiss();
              }}
            >
              Confirm reset
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
  close,
  saveError,
  defaults,
}: {
  value: Preferences;
  change: (value: Preferences) => void;
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
  return (
    <InteractionDialog title="Interaction settings" close={close} className="preferences-dialog">
      <div className="preferences-content">
        <section className="preferences-section" aria-labelledby="preferences-appearance">
          <h3 id="preferences-appearance">Appearance</h3>
          <label className="preference-row">
            <span className="preference-description">Theme</span>
            <select
              aria-label="Theme"
              value={value.theme}
              onChange={(event) =>
                change({ ...value, theme: event.target.value as Preferences['theme'] })
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </label>
          <div className="preferences-fonts">
            <label>
              Chat text size
              <select
                aria-label="Chat text size"
                value={value.chatFontSize ?? ''}
                onChange={(event) =>
                  change({
                    ...value,
                    chatFontSize: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              >
                <option value="">Default</option>
                {chatFontSizes.map((size) => (
                  <option key={size} value={size}>
                    {size} px
                  </option>
                ))}
              </select>
            </label>
            <label>
              Code text size
              <select
                aria-label="Code text size"
                value={value.codeFontSize ?? ''}
                onChange={(event) =>
                  change({
                    ...value,
                    codeFontSize: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              >
                <option value="">Default</option>
                {codeFontSizes.map((size) => (
                  <option key={size} value={size}>
                    {size} px
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="preferences-preview" role="region" aria-label="Text preview">
            <div className="prose">
              <p>
                Aa Bb Cc · 0123456789
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
          aria-label="New conversation defaults"
        >
          <h3 id="preferences-defaults">New conversation defaults</h3>
          <p className="preference-help">
            Applies to new conversations. Existing conversations keep their settings.
          </p>
          {defaults.settings && (
            <>
              <label className="preference-row">
                <span className="preference-description">Permissions</span>
                <select
                  aria-label="Default permissions"
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
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="preference-help">
                {
                  permissionPresets.find((preset) => preset.id === defaults.settings!.permission)
                    ?.description
                }
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
                label="Reset new conversation defaults"
                detail="Restore Read only, the native model and reasoning defaults, Execution mode, and Standard speed for future conversations."
                disabled={defaults.loading || defaults.conflict}
                reset={() => defaults.change({ permission: 'read-only' })}
              />
            </>
          )}
          {defaults.loading && <p role="status">Loading defaults…</p>}
          {defaults.saving && <p role="status">Saving defaults…</p>}
          {defaults.error && (
            <p role="alert">
              {defaults.error}{' '}
              <button onClick={defaults.retry}>
                {defaults.conflict ? 'Reload default settings' : 'Retry default settings'}
              </button>
            </p>
          )}
        </section>
        <section className="preferences-section" aria-labelledby="preferences-interaction">
          <h3 id="preferences-interaction">Interaction</h3>
          <label className="preference-row">
            <span className="preference-description">Follow-up delivery</span>
            <select
              aria-label="Follow-up delivery"
              value={value.followUp}
              onChange={(event) =>
                change({ ...value, followUp: event.target.value as Preferences['followUp'] })
              }
            >
              <option value="queue">Queue for next turn</option>
              <option value="steer">Add to running task</option>
            </select>
          </label>
          <label className="preference-row">
            <span className="preference-description">Send shortcut</span>
            <select
              aria-label="Send shortcut"
              value={value.enter}
              onChange={(event) =>
                change({ ...value, enter: event.target.value as Preferences['enter'] })
              }
            >
              <option value="enter">Enter</option>
              <option value="cmdIfMultiline">Multiline: Ctrl/Cmd+Enter</option>
              <option value="cmdAlways">Ctrl/Cmd+Enter</option>
            </select>
          </label>
          <label className="preference-row">
            <span className="preference-description">Review location</span>
            <select
              aria-label="Review location"
              value={value.review}
              onChange={(event) =>
                change({ ...value, review: event.target.value as Preferences['review'] })
              }
            >
              <option value="inline">Current conversation</option>
              <option value="detached">Separate conversation</option>
            </select>
          </label>
          <label className="preference-row">
            <span>Scroll with replies</span>
            <input
              className="preference-checkbox"
              type="checkbox"
              role="switch"
              checked={value.autoScroll}
              onChange={(event) => change({ ...value, autoScroll: event.target.checked })}
            />
          </label>
          <details className="preferences-help">
            <summary>Editing and shortcuts</summary>
            <p>
              Shift+Enter adds a line. Phone keyboards always add a line. Ctrl/Cmd+Shift+Enter
              reverses queue and steer for one follow-up. Steering uses the running task's settings;
              accepted additions cannot be edited or recalled.
            </p>
            <p>
              Drafts and waiting queued text are editable. Sent history is not edited in place.
              Reply quotes a response; Branch from here creates a separate conversation and shares
              the current project files.
            </p>
          </details>
        </section>
      </div>
      <div className="preferences-footer">
        {saveError && (
          <div className="preferences-save-error">
            <span role="alert">{saveError}</span>
            <button type="button" onClick={() => change(value)}>
              Retry save
            </button>
          </div>
        )}
        <ResetSettings
          label="Reset browser settings"
          detail="Restore theme, text sizes, and interaction preferences in this browser."
          reset={() => change(defaultBrowserPreferences)}
        />
        <button
          className="preferences-done"
          type="button"
          title="Preferences are saved in this browser"
          onClick={close}
        >
          Done
        </button>
      </div>
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
  const [type, setType] = useState<ReviewTarget['type']>('uncommittedChanges');
  const [detail, setDetail] = useState('');
  const [delivery, setDelivery] = useState(inlineAvailable ? initial : 'detached');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <InteractionDialog title="Review code" close={close} busy={busy}>
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
        <p>
          Run Codex's native code review in Read only mode. Review uses the selected model and
          reasoning effort.
        </p>
        <label>
          Review target
          <select
            aria-label="Review target"
            value={type}
            disabled={busy}
            onChange={(e) => {
              setType(e.target.value as ReviewTarget['type']);
              setDetail('');
            }}
          >
            <option value="uncommittedChanges">Uncommitted changes</option>
            <option value="baseBranch">Compare with a base branch</option>
            <option value="commit">A specific commit</option>
            <option value="custom">Custom review instructions</option>
          </select>
        </label>
        {type !== 'uncommittedChanges' && (
          <label>
            {type === 'baseBranch'
              ? 'Base branch'
              : type === 'commit'
                ? 'Commit SHA'
                : 'Review instructions'}
            <input
              aria-label="Review details"
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
          Review location
          <select
            aria-label="Review location"
            value={delivery}
            disabled={busy}
            onChange={(e) => setDelivery(e.target.value as Preferences['review'])}
          >
            <option value="inline" disabled={!inlineAvailable}>
              Current conversation
            </option>
            <option value="detached">Separate conversation</option>
          </select>
        </label>
        {delivery === 'detached' && (
          <p>
            A separate conversation uses the same current project files; it does not create a Git
            worktree.
          </p>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={busy || (type !== 'uncommittedChanges' && !detail.trim())}
        >
          {busy ? 'Starting review…' : 'Start review'}
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
  const usage = thread?.usage;
  return (
    <InteractionDialog title="Session status" close={close}>
      <dl className="session-status">
        <dt>Browser connection</dt>
        <dd>{connection}</dd>
        <dt>Runtime</dt>
        <dd>
          {system?.runtime ?? 'Unknown'} · {system?.state ?? 'Unknown'}
        </dd>
        <dt>CLI version</dt>
        <dd>{system?.version ?? 'Unknown'}</dd>
        <dt>Model</dt>
        <dd>{settings.model || thread?.resolvedModel || 'CLI default'}</dd>
        <dt>Reasoning</dt>
        <dd>{settings.effort || 'Model default'}</dd>
        <dt>Mode</dt>
        <dd>{settings.mode === 'plan' ? 'Plan' : 'Code'}</dd>
        <dt>Clarification questions</dt>
        <dd>
          {system?.codeQuestions === true
            ? 'Code and Plan, when Codex needs input'
            : system?.codeQuestions === false
              ? 'Plan mode only'
              : 'Not reported'}
        </dd>
        <dt>Permissions</dt>
        <dd>{permissionLabel(settings.permission)}</dd>
        <dt>Conversation</dt>
        <dd>{thread?.id ?? 'Not created'}</dd>
        <dt>Turn</dt>
        <dd>{thread?.turnId ?? 'No turn'}</dd>
        <dt>Latest context usage</dt>
        <dd>
          {usage
            ? usage.contextTokens.toLocaleString('en-US') +
              (usage.contextWindow
                ? ' / ' + usage.contextWindow.toLocaleString('en-US') + ' tokens'
                : ' tokens; window unknown')
            : 'Not reported'}
        </dd>
        <dt>Cumulative usage</dt>
        <dd>{usage ? usage.totalTokens.toLocaleString('en-US') + ' tokens' : 'Not reported'}</dd>
        <dt>Maintenance</dt>
        <dd>
          {system?.maintenance
            ? system.maintenance.ready
              ? 'Ready'
              : 'Waiting for active work'
            : 'Accepting tasks'}
        </dd>
      </dl>
      <button
        disabled={maintenanceBusy}
        onClick={() => void changeMaintenance(system?.maintenance ? 'cancel' : 'start')}
      >
        {system?.maintenance ? 'Cancel maintenance' : 'Prepare maintenance'}
      </button>
      <p>
        Usage is reported by the CLI while connected. It is not your account quota or billing
        balance.
      </p>
    </InteractionDialog>
  );
}
