import { ImageAttachmentView } from './ImageAttachments';
import { permissionLabel } from '../shared/permissions';
import { useEffect, useState } from 'react';
import type { QueueState, QueueItem, Settings } from '../shared/types';
import { sameSettings } from '../shared/types';
import { message, post, request } from './api';
import { Icon } from './primitives';
import { PanelMenu } from './PanelMenu';
import './workflow.css';
export function QueuePanel({
  threadId,
  projectId,
  state,
  onChange,
  onCheck,
  turnId,
  settings,
  onEditingChange,
  onStop,
}: {
  threadId: string;
  projectId: string;
  turnId?: string;
  settings?: Settings;
  onEditingChange: (editing: boolean) => void;
  onStop?: () => void;
  state: QueueState;
  onChange: (queue: QueueState) => void;
  onCheck: () => Promise<void>;
}) {
  const [editing, setEditing] = useState('');
  const [text, setText] = useState('');
  useEffect(() => {
    onEditingChange(!!editing);
    return () => onEditingChange(false);
  }, [editing, onEditingChange]);
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
      className="composer queued-text-editor"
      aria-label="Queued message editor"
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
          ? 'Queue paused for editing. Queue position, model, permissions and attachments stay unchanged.'
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
      <div className="composer-toolbar queue-editor-actions">
        {onStop && (
          <button type="button" aria-label="Stop task" disabled={busy} onClick={onStop}>
            <Icon name="stop" size={16} />
            Stop
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => setEditing('')}>
          {editable ? 'Cancel edit' : 'Close edit'}
        </button>
        <button
          className="send-button"
          disabled={
            busy ||
            !editable ||
            (!text.trim() && !entryBeingEdited?.attachments.some((item) => item.kind === 'image'))
          }
        >
          Save queued message
        </button>
      </div>
    </form>
  ) : null;
  if (!state.items.length && !editing) return null;
  return (
    <section
      className={`message-queue compact-queue ${editing ? 'is-editing' : ''}`}
      aria-label="Queued messages"
    >
      <div className="queue-heading">
        <strong>
          {state.items.length ? 'Queued' : 'Unsubmitted edit'}{' '}
          {state.items.length > 0 && <span>{state.items.length}/10</span>}
        </strong>
        {state.items.length > 0 && (
          <button
            disabled={busy || !!editing}
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
      <p>{state.paused && (state.reason ?? 'Queue paused. Resume when ready.')}</p>
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
                  {permissionLabel(entry.settings.permission)}
                  {entry.attachments.length
                    ? ' · ' + entry.attachments.length + ' attachment(s)'
                    : ''}
                </small>
              </div>
              <p className="queue-preview">
                {entry.text.slice(0, 500)}
                {entry.text.length > 500 ? '…' : ''}
              </p>
              {entry.attachments.some((item) => item.kind === 'image') && (
                <div className="queued-images">
                  {entry.attachments.map((item, index) =>
                    item.kind === 'image' ? (
                      <ImageAttachmentView
                        key={item.id + ':' + index}
                        image={item}
                        projectId={projectId}
                      />
                    ) : null,
                  )}
                </div>
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
                      <Icon name="reply" size={14} />
                      Guide now
                    </button>
                  )}
                  {entry.state === 'queued' && (
                    <PanelMenu
                      label="Queued message actions"
                      trigger={<Icon name="more" size={16} />}
                      className="queue-entry-menu"
                    >
                      <button
                        disabled={busy || !!editing}
                        data-close-menu
                        onClick={() =>
                          void run(async () => {
                            // Pausing first prevents this client from dispatching the message during editing.
                            // Another client may still resume it; the server's queued-state check remains authoritative.
                            if (!state.paused) {
                              const paused = await post<QueueState>(
                                '/threads/' + threadId + '/queue/control',
                                { paused: true },
                              );
                              onChange(paused);
                            }
                            const full = await request<QueueItem>(
                              '/threads/' + threadId + '/queue/' + entry.id,
                            );
                            if (full.state !== 'queued')
                              throw new Error('This message has already started.');
                            setEditing(entry.id);
                            setText(full.text);
                          })
                        }
                      >
                        <Icon name="edit" size={14} />
                        Edit message
                      </button>
                    </PanelMenu>
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
                      <Icon name="close" size={14} />
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
      {editor}
      {error && (
        <p role="alert" className="queue-error">
          {error}
        </p>
      )}
    </section>
  );
}
