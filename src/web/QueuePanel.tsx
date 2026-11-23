import { useInterfaceLanguage } from './interface-language';
import { ImageAttachmentView } from './ImageAttachments';
import { permissionLabel } from '../shared/permissions';
import { useEffect, useState } from 'react';
import type { QueueState, QueueItem, Settings } from '../shared/types';
import { sameSettings } from '../shared/types';
import { message, post, request } from './api';
import { Icon, IconButton } from './primitives';
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
  dispatchDisabled = false,
}: {
  threadId: string;
  projectId: string;
  turnId?: string;
  settings?: Settings;
  onEditingChange: (editing: boolean) => void;
  onStop?: () => void;
  dispatchDisabled?: boolean;
  state: QueueState;
  onChange: (queue: QueueState) => void;
  onCheck: () => Promise<void>;
}) {
  const { t } = useInterfaceLanguage();
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
  const canSave =
    !busy &&
    editable &&
    (!!text.trim() || entryBeingEdited.attachments.some((item) => item.kind === 'image'));
  const editor = editing ? (
    <form
      className="composer queued-text-editor"
      aria-label={t('Queued message editor')}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
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
      {!editable && (
        <p>
          {t(
            'This message is no longer waiting. Your local edit was not submitted; copy it before closing.',
          )}
        </p>
      )}
      <textarea
        aria-label={t('Edit queued message')}
        value={text}
        maxLength={50_000}
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
        readOnly={!editable}
        autoFocus
      />
      <div className="queue-editor-actions">
        {onStop && (
          <button
            className="queue-editor-stop"
            type="button"
            aria-label={t('Stop task')}
            aria-description={t('Stop current task and pause queue')}
            data-tooltip={t('Pauses the queue')}
            disabled={busy}
            onClick={onStop}
          >
            <Icon name="stop" size={16} />
            {t('Stop task')}
          </button>
        )}
        <button
          className="icon-button"
          type="button"
          aria-label={editable ? t('Cancel edit') : t('Close edit')}
          data-tooltip=""
          disabled={busy}
          onClick={() => setEditing('')}
        >
          <Icon name="close" size={16} />
        </button>
        <button
          className="send-button"
          type="submit"
          aria-label={t('Save queued message')}
          data-tooltip=""
          disabled={!canSave}
        >
          <Icon name="check" size={18} />
        </button>
      </div>
    </form>
  ) : null;
  if (!state.items.length && !editing) return null;
  return (
    <section
      className={`message-queue compact-queue ${editing ? 'is-editing' : ''}`}
      aria-label={t('Queued messages')}
    >
      <div className="queue-heading">
        <strong>
          {state.items.length ? t('Queued') : t('Unsubmitted edit')}{' '}
          {state.items.length > 0 && <span>{state.items.length}/10</span>}
        </strong>
        {state.items.length > 0 && (
          <button
            className="icon-button"
            type="button"
            aria-label={state.paused ? t('Resume queue') : t('Pause queue')}
            data-tooltip=""
            disabled={busy || !!editing}
            onClick={() =>
              void run(() =>
                post<QueueState>('/threads/' + threadId + '/queue/control', {
                  paused: !state.paused,
                }),
              )
            }
          >
            <Icon name={state.paused ? 'play' : 'pause'} size={16} />
          </button>
        )}
      </div>
      {state.paused && <p>{t(state.reason ?? 'Queue paused. Resume when ready.')}</p>}
      <ol>
        {state.items.map((entry, index) => (
          <li key={entry.id}>
            <span className="queue-index">{index + 1}</span>
            <div className="queue-entry">
              <div className="queue-entry-label">
                <span>
                  {entry.state === 'queued'
                    ? t('Waiting')
                    : entry.state === 'dispatching'
                      ? t('Sending')
                      : entry.state === 'unknown'
                        ? t('Unconfirmed')
                        : t('Needs review')}
                </span>
                <small>
                  {t(permissionLabel(entry.settings.permission))}
                  {entry.attachments.length
                    ? ' · ' + t('{count} attachment(s)', { count: entry.attachments.length })
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
              {entry.error && <p className="queue-error">{t(entry.error)}</p>}
              {editing !== entry.id && (
                <div className="queue-actions">
                  {entry.state === 'queued' && turnId && (
                    <button
                      disabled={
                        busy ||
                        dispatchDisabled ||
                        !settings ||
                        !sameSettings(entry.settings, settings)
                      }
                      aria-label={t('Add queued message to current task')}
                      aria-description={t('Accepted additions cannot be edited.')}
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
                      <Icon name="steer" size={14} />
                      {t('Add now')}
                    </button>
                  )}
                  {entry.state === 'queued' && (
                    <IconButton
                      icon="edit"
                      size={15}
                      label={t('Edit message')}
                      hint={t('Edit · Pauses queue')}
                      disabled={busy || !!editing}
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
                    />
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
                      <Icon name="trash" size={14} />
                      {t('Remove')}
                    </button>
                  )}
                  {entry.state === 'unknown' && (
                    <button disabled={busy} onClick={() => void run(onCheck)}>
                      {t('Check result')}
                    </button>
                  )}
                </div>
              )}
              {entry.state === 'queued' &&
                turnId &&
                settings &&
                !sameSettings(entry.settings, settings) && (
                  <p className="queue-edit-scope">
                    {t('Add now requires matching task settings.')}
                  </p>
                )}
            </div>
          </li>
        ))}
      </ol>
      {editor}
      {error && (
        <p role="alert" className="queue-error">
          {t(error)}
        </p>
      )}
    </section>
  );
}
