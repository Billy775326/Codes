import { useState } from 'react';
import type { QueueState, QueueItem, Settings } from '../shared/types';
import { sameSettings } from '../shared/types';
import { message, post, request } from './api';
import { Icon } from './primitives';
import './workflow.css';
export function QueuePanel({
  threadId,
  state,
  onChange,
  onCheck,
  turnId,
  settings,
}: {
  threadId: string;
  turnId?: string;
  settings?: Settings;
  state: QueueState;
  onChange: (queue: QueueState) => void;
  onCheck: () => Promise<void>;
}) {
  const [editing, setEditing] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (work: () => Promise<QueueState | void>, finishEdit = false) => {
    setBusy(true);
    setError('');
    try {
      const result = await work();
      if (result) {
        onChange(result);
        if (finishEdit) setEditing('');
      }
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };
  const entryBeingEdited = state.items.find((entry) => entry.id === editing);
  const editable = entryBeingEdited?.state === 'queued';
  const editor = editing ? (
    <form
      className="queued-text-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!editable) return;
        void run(
          () =>
            request<QueueState>('/threads/' + threadId + '/queue/' + editing, {
              method: 'PATCH',
              body: JSON.stringify({ text: text.trim() }),
            }),
          true,
        );
      }}
    >
      <p>
        {editable
          ? 'Edit text only. Queue position, model, permissions and attachments stay unchanged.'
          : 'This message is no longer waiting. Your local edit was not submitted; copy it before closing.'}
      </p>
      <textarea
        aria-label="Edit queued message"
        value={text}
        maxLength={50_000}
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
        readOnly={!editable}
        autoFocus
      />
      <div className="queue-actions">
        <button type="button" disabled={busy} onClick={() => setEditing('')}>
          {editable ? 'Cancel edit' : 'Close edit'}
        </button>
        <button disabled={busy || !editable || !text.trim()}>Save queued message</button>
      </div>
    </form>
  ) : null;
  if (!state.items.length && !editing) return null;
  return (
    <section className="message-queue" aria-label="Queued messages">
      <div className="queue-heading">
        <strong>
          {state.items.length ? 'Message queue' : 'Unsubmitted edit'}{' '}
          {state.items.length > 0 && <span>{state.items.length}/10</span>}
        </strong>
        {state.items.length > 0 && (
          <button
            disabled={busy}
            onClick={() =>
              void run(() =>
                post<QueueState>('/threads/' + threadId + '/queue/control', {
                  paused: !state.paused,
                }),
              )
            }
          >
            {state.paused ? 'Resume queue' : 'Pause queue'}
          </button>
        )}
      </div>
      <p>
        {state.paused
          ? (state.reason ?? 'Queue paused.')
          : 'Waiting messages run in order after the current task completes.'}
      </p>
      <ol>
        {state.items.map((entry, index) => (
          <li key={entry.id}>
            <span className="queue-index">{index + 1}</span>
            <div className="queue-entry">
              <div className="queue-entry-label">
                <span>
                  {entry.state === 'queued'
                    ? 'Waiting · Editable'
                    : entry.state === 'sent'
                      ? 'Running · Locked'
                      : entry.state === 'dispatching'
                        ? 'Sending · Locked'
                        : entry.state === 'unknown'
                          ? 'Unconfirmed · Locked'
                          : 'Needs review · Text locked'}
                </span>
                <small>
                  {entry.settings.permission === 'workspace-write'
                    ? 'Workspace write'
                    : 'Read only'}
                  {entry.attachments.length
                    ? ' · ' + entry.attachments.length + ' attachment(s)'
                    : ''}
                </small>
              </div>
              {editing === entry.id ? (
                editor
              ) : (
                <p className="queue-preview">
                  {entry.text.slice(0, 500)}
                  {entry.text.length > 500 ? '…' : ''}
                </p>
              )}
              {entry.error && <p className="queue-error">{entry.error}</p>}
              {editing !== entry.id && (
                <div className="queue-actions">
                  {entry.state === 'queued' && turnId && (
                    <button
                      disabled={busy || !settings || !sameSettings(entry.settings, settings)}
                      aria-label="Add queued message to current task"
                      title="Apply this waiting message to the running task; it stops being editable after acceptance"
                      onClick={() =>
                        void run(() =>
                          post<QueueState>(
                            '/threads/' + threadId + '/queue/' + entry.id + '/steer',
                            {
                              expectedTurnId: turnId,
                            },
                          ),
                        )
                      }
                    >
                      Add now
                    </button>
                  )}
                  {entry.state === 'queued' && (
                    <button
                      disabled={busy || !!editing}
                      title={
                        editing
                          ? 'Finish or close the current edit first'
                          : 'Edit this waiting message text before sending starts'
                      }
                      onClick={() =>
                        void run(async () => {
                          const full = entry.textTruncated
                            ? await request<QueueItem>(
                                '/threads/' + threadId + '/queue/' + entry.id,
                              )
                            : entry;
                          if (full.state !== 'queued')
                            throw new Error('This message has already started.');
                          setEditing(entry.id);
                          setText(full.text);
                          return undefined;
                        })
                      }
                    >
                      Edit text
                    </button>
                  )}
                  {['queued', 'failed'].includes(entry.state) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          request<QueueState>('/threads/' + threadId + '/queue/' + entry.id, {
                            method: 'DELETE',
                          }),
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                  {entry.state === 'unknown' && (
                    <button disabled={busy} onClick={() => void run(onCheck)}>
                      Check result
                    </button>
                  )}
                </div>
              )}
              {entry.state === 'queued' &&
                turnId &&
                settings &&
                !sameSettings(entry.settings, settings) && (
                  <p className="queue-edit-scope">
                    Add now is unavailable because this message uses different task settings. Leave
                    it queued for its own turn.
                  </p>
                )}
            </div>
          </li>
        ))}
      </ol>
      {editing && !entryBeingEdited && <div className="queue-orphan-edit">{editor}</div>}
      {error && (
        <p role="alert" className="queue-error">
          {error}
        </p>
      )}
    </section>
  );
}
