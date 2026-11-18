import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ReviewTarget, Settings, System, Thread } from '../shared/types';
import { message } from './api';
export function InteractionDialog({
  title,
  close,
  children,
  busy = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button,select,input,textarea')?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        className="modal interaction-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) close();
          if (event.key !== 'Tab') return;
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)',
            ),
          ];
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
export interface Preferences {
  followUp: 'queue' | 'steer';
  enter: 'enter' | 'cmdIfMultiline' | 'cmdAlways';
  review: 'inline' | 'detached';
  theme?: 'dark' | 'light' | 'system';
}
export function PreferencesDialog({
  value,
  change,
  close,
}: {
  value: Preferences;
  change: (value: Preferences) => void;
  close: () => void;
}) {
  return (
    <InteractionDialog title="Interaction settings" close={close}>
      <p>Preferences are saved in this browser.</p>
      <label>
        Workspace theme
        <select
          aria-label="Workspace theme"
          value={value.theme ?? 'dark'}
          onChange={(event) =>
            change({ ...value, theme: event.target.value as Preferences['theme'] })
          }
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">System</option>
        </select>
      </label>
      <label>
        Follow-up behavior
        <select
          aria-label="Follow-up behavior"
          value={value.followUp}
          onChange={(e) =>
            change({ ...value, followUp: e.target.value as Preferences['followUp'] })
          }
        >
          <option value="queue">Queue after the current task</option>
          <option value="steer">Add to the current task</option>
        </select>
      </label>
      <p>
        Ctrl/Cmd+Shift+Enter reverses queue and steer for one follow-up. Steering keeps the running
        task's settings. Accepted additions cannot be edited or recalled.
      </p>
      <p>
        Drafts and waiting queued text are editable. Once sending starts, the message is locked.
        Reply quotes an existing response; Branch from here creates a separate conversation through
        that turn and shares current project files. Sent history is not edited in place.
      </p>
      <label>
        Enter behavior
        <select
          aria-label="Enter behavior"
          value={value.enter}
          onChange={(e) => change({ ...value, enter: e.target.value as Preferences['enter'] })}
        >
          <option value="enter">Enter sends</option>
          <option value="cmdIfMultiline">Ctrl/Cmd+Enter for multiline drafts</option>
          <option value="cmdAlways">Always Ctrl/Cmd+Enter</option>
        </select>
      </label>
      <p>Shift+Enter adds a line. On phones, Enter always adds a line; use the send button.</p>
      <label>
        Review delivery
        <select
          aria-label="Review delivery preference"
          value={value.review}
          onChange={(e) => change({ ...value, review: e.target.value as Preferences['review'] })}
        >
          <option value="inline">Current conversation</option>
          <option value="detached">Separate conversation</option>
        </select>
      </label>
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
          Review delivery
          <select
            aria-label="Review delivery"
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
  thread,
  settings,
  connection,
  close,
}: {
  system?: System;
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
        <dd>{settings.permission}</dd>
        <dt>Conversation</dt>
        <dd>{thread?.id ?? 'Not created'}</dd>
        <dt>Turn</dt>
        <dd>{thread?.turnId ?? 'No turn'}</dd>
        <dt>Latest context usage</dt>
        <dd>
          {usage
            ? usage.contextTokens.toLocaleString() +
              (usage.contextWindow
                ? ' / ' + usage.contextWindow.toLocaleString() + ' tokens'
                : ' tokens; window unknown')
            : 'Not reported'}
        </dd>
        <dt>Cumulative usage</dt>
        <dd>{usage ? usage.totalTokens.toLocaleString() + ' tokens' : 'Not reported'}</dd>
      </dl>
      <p>
        Usage is reported by the CLI while connected. It is not your account quota or billing
        balance.
      </p>
    </InteractionDialog>
  );
}
