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
  const run = async (work: () => Promise<QueueState | void>) => {
    setBusy(true);
    setError('');
    try {
      const result = await work();
      if (result) {
        onChange(result);
        setEditing('');
      }
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };
  if (!state.items.length) return null;
  return (
    <section className="message-queue" aria-label="Queued messages">
      <div className="queue-heading">
        <strong>
          Message queue <span>{state.items.length}/10</span>
        </strong>
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
                    ? 'Waiting'
                    : entry.state === 'sent'
                      ? 'Working'
                      : entry.state === 'dispatching'
                        ? 'Sending'
                        : entry.state === 'unknown'
                          ? 'Check result'
                          : 'Needs review'}
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
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(() =>
                      request<QueueState>('/threads/' + threadId + '/queue/' + entry.id, {
                        method: 'PATCH',
                        body: JSON.stringify({ text: text.trim() }),
                      }),
                    );
                  }}
                >
                  <textarea
                    aria-label="Edit queued message"
                    value={text}
                    maxLength={50_000}
                    onChange={(e) => setText(e.target.value)}
                    disabled={busy}
                    autoFocus
                  />
                  <div className="queue-actions">
                    <button type="button" disabled={busy} onClick={() => setEditing('')}>
                      Cancel edit
                    </button>
                    <button disabled={busy || !text.trim()}>Save queued message</button>
                  </div>
                </form>
              ) : (
                <p className="queue-preview">
                  {entry.text.slice(0, 500)}
                  {entry.text.length > 500 ? '…' : ''}
                </p>
              )}
              {entry.error && <p className="queue-error">{entry.error}</p>}
              <div className="queue-actions">
                {entry.state === 'queued' && turnId && (
                  <button
                    disabled={busy || !settings || !sameSettings(entry.settings, settings)}
                    title="Add to the running turn using its current settings"
                    onClick={() =>
                      void run(() =>
                        post<QueueState>('/threads/' + threadId + '/queue/' + entry.id + '/steer', {
                          expectedTurnId: turnId,
                        }),
                      )
                    }
                  >
                    Send now
                  </button>
                )}
                {entry.state === 'queued' && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const full = entry.textTruncated
                          ? await request<QueueItem>('/threads/' + threadId + '/queue/' + entry.id)
                          : entry;
                        if (full.state !== 'queued')
                          throw new Error('This message has already started.');
                        setEditing(entry.id);
                        setText(full.text);
                        return undefined;
                      })
                    }
                  >
                    Edit
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
            </div>
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="queue-error">
          {error}
        </p>
      )}
    </section>
  );
}
