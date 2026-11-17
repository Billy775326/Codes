import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ConversationPage, Summary } from '../shared/types';
import { message, post, request } from './api';
import { Icon } from './primitives';
import './conversations.css';

interface Props {
  projectId: string;
  selectedId: string;
  updates: Summary[];
  disabled: boolean;
  onSelect: (id: string) => void;
  onUpdated: (summary: Summary) => void;
}
const isWorking = (row: Summary) =>
  !!row.executionPending || ['running', 'waitingApproval', 'waitingInput'].includes(row.state);
const matches = (row: Summary, archived: boolean, search: string) =>
  !!row.archived === archived && row.title.toLowerCase().includes(search.toLowerCase());
const signature = (row: Summary) =>
  JSON.stringify([
    row.title,
    row.state,
    row.updatedAt,
    !!row.archived,
    !!row.managementPending,
    !!row.executionPending,
  ]);
function dayLabel(time: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return time >= today.getTime() ? 'Today' : time >= yesterday.getTime() ? 'Yesterday' : 'Earlier';
}

export const Conversations = memo(function Conversations({
  projectId,
  selectedId,
  updates,
  disabled,
  onSelect,
  onUpdated,
}: Props) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [page, setPage] = useState<ConversationPage>({ data: [], nextCursor: null, scanned: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [menu, setMenu] = useState('');
  const [editing, setEditing] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState('');
  const [confirmation, setConfirmation] = useState<Summary>();
  const priorUpdates = useRef(new Map<string, string>());
  const dialog = useRef<HTMLFormElement>(null);
  const generation = useRef(0);
  const latestUpdates = useRef(updates);
  latestUpdates.current = updates;

  useEffect(() => {
    setQuery('');
    setSearch('');
    setArchived(false);
    setCursor(undefined);
    setPrevious([]);
    setPage({ data: [], nextCursor: null, scanned: 0 });
    setMenu('');
    setEditing('');
    setConfirmation(undefined);
    priorUpdates.current.clear();
  }, [projectId]);
  useEffect(() => {
    if (query.trim() === search) return;
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setCursor(undefined);
      setPrevious([]);
      setMenu('');
      setEditing('');
    }, 200);
    return () => clearTimeout(timer);
  }, [query, search]);
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    const current = ++generation.current;
    const before = new Map(latestUpdates.current.map((row) => [row.id, signature(row)]));
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ search, archived: String(archived) });
    if (cursor) params.set('cursor', cursor);
    void request<ConversationPage>(
      '/projects/' + projectId + '/conversations?' + params.toString(),
      {},
      controller.signal,
    )
      .then((result) => {
        if (current !== generation.current) return;
        // A delayed list response must not undo metadata received over SSE in the meantime.
        const changed = latestUpdates.current.filter(
          (row) => row.projectId === projectId && before.get(row.id) !== signature(row),
        );
        let data = result.data;
        for (const row of changed) {
          const index = data.findIndex((item) => item.id === row.id);
          if (index >= 0) data = data.map((item) => (item.id === row.id ? row : item));
          else if (!cursor && !search && !archived) data = [row, ...data];
        }
        setPage({
          ...result,
          data: data
            .filter((row) => matches(row, archived, search))
            .sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))
            .slice(0, 30),
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      })
      .finally(() => {
        if (current === generation.current && !controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, search, archived, cursor, revision]);
  useEffect(() => {
    const delta = updates.filter(
      (row) => row.projectId === projectId && priorUpdates.current.get(row.id) !== signature(row),
    );
    priorUpdates.current = new Map(
      updates.filter((row) => row.projectId === projectId).map((row) => [row.id, signature(row)]),
    );
    if (!delta.length) return;
    setPage((old) => {
      let data = old.data.slice();
      for (const row of delta) {
        const index = data.findIndex((item) => item.id === row.id);
        if (index >= 0) {
          if (matches(row, archived, search)) data[index] = row;
          else data.splice(index, 1);
        } else if (!cursor && !archived && !search && matches(row, archived, search))
          data.unshift(row);
      }
      return {
        ...old,
        data: data
          .sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))
          .slice(0, 30),
      };
    });
  }, [updates, projectId, archived, search, cursor]);
  useEffect(() => {
    if (!confirmation) return;
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, [confirmation]);

  const refresh = () => {
    setCursor(undefined);
    setPrevious([]);
    setRevision((v) => v + 1);
    setMenu('');
    setEditing('');
  };
  const mutate = async (row: Summary, action: 'rename' | 'archive' | 'check') => {
    if (pending) return;
    setPending(row.id);
    setError('');
    try {
      const result = await post<Summary>(
        '/threads/' + row.id + '/' + (action === 'check' ? 'management-status' : action),
        action === 'check'
          ? {}
          : action === 'rename'
            ? { operationId: crypto.randomUUID(), name: name.trim() }
            : { operationId: crypto.randomUUID(), archived: !row.archived },
      );
      onUpdated(result);
      setEditing('');
      setMenu('');
      setConfirmation(undefined);
      setPage((old) => ({
        ...old,
        data: old.data
          .map((item) => (item.id === result.id ? result : item))
          .filter((item) => matches(item, archived, search)),
      }));
      refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      setPending('');
    }
  };
  const toggleView = (value: boolean) => {
    setArchived(value);
    setCursor(undefined);
    setPrevious([]);
    setMenu('');
    setEditing('');
    setError('');
  };
  const next = () => {
    if (!page.nextCursor || loading) return;
    setPrevious((old) => [...old.slice(-127), cursor]);
    setCursor(page.nextCursor);
    setMenu('');
    setEditing('');
  };
  const back = () => {
    if (!previous.length || loading) return;
    setCursor(previous.at(-1));
    setPrevious((old) => old.slice(0, -1));
    setMenu('');
    setEditing('');
  };
  const groups = page.data
    .filter((row) => row.projectId === projectId && matches(row, archived, search))
    .reduce<{ label: string; rows: Summary[] }[]>((all, row) => {
      const label = dayLabel(row.updatedAt);
      const group = all.find((item) => item.label === label);
      if (group) group.rows.push(row);
      else all.push({ label, rows: [row] });
      return all;
    }, []);

  return (
    <section className="conversations" aria-label="Conversation management">
      <div className="workspace-label conversation-label">
        CONVERSATIONS
        <button
          className="icon-button"
          aria-label="Refresh conversations"
          title="Refresh conversations"
          disabled={loading}
          onClick={refresh}
        >
          <Icon name="refresh" size={14} />
        </button>
      </div>
      <div className="conversation-search">
        <Icon name="search" size={14} />
        <input
          aria-label="Search conversations"
          placeholder="Search conversations"
          value={query}
          maxLength={120}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button aria-label="Clear conversation search" onClick={() => setQuery('')}>
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
      <div className="conversation-views" role="group" aria-label="Conversation view">
        <button
          aria-pressed={!archived}
          className={!archived ? 'selected' : ''}
          onClick={() => toggleView(false)}
        >
          Active
        </button>
        <button
          aria-pressed={archived}
          className={archived ? 'selected' : ''}
          onClick={() => toggleView(true)}
        >
          <Icon name="archive" size={12} />
          Archived
        </button>
      </div>
      {error && !confirmation && (
        <div className="conversation-error" role="alert">
          {error}
          <button onClick={refresh}>Refresh list</button>
        </div>
      )}
      <nav aria-label="Conversations" aria-busy={loading}>
        {groups.map((group) => (
          <section key={group.label} className="conversation-group">
            <h2>{group.label}</h2>
            {group.rows.map((row) => (
              <div
                key={row.id}
                className={'conversation-row ' + (row.id === selectedId ? 'selected' : '')}
              >
                <div className="conversation-row-heading">
                  <button
                    className={'thread-link ' + (row.id === selectedId ? 'active' : '')}
                    aria-current={row.id === selectedId ? 'page' : undefined}
                    disabled={disabled}
                    onClick={() => onSelect(row.id)}
                    title={row.title}
                  >
                    <span className={'status-dot ' + row.state} />
                    <span>{row.title}</span>
                    {['waitingApproval', 'waitingInput'].includes(row.state) && (
                      <span className="attention" aria-hidden="true">
                        !
                      </span>
                    )}
                  </button>
                  <button
                    className="icon-button conversation-menu-trigger"
                    aria-label={'Actions for ' + row.title}
                    aria-expanded={menu === row.id}
                    disabled={!!pending}
                    onClick={() => {
                      setMenu(menu === row.id ? '' : row.id);
                      setEditing('');
                      setError('');
                    }}
                  >
                    <Icon name="more" size={16} />
                  </button>
                </div>
                {menu === row.id && (
                  <div
                    className="conversation-actions"
                    role="group"
                    aria-label={'Conversation actions: ' + row.title}
                  >
                    <button
                      disabled={!!pending || row.managementPending}
                      onClick={() => {
                        setEditing(row.id);
                        setName(row.title);
                      }}
                    >
                      <Icon name="edit" size={12} />
                      Rename
                    </button>
                    {row.managementPending ? (
                      <button disabled={!!pending} onClick={() => void mutate(row, 'check')}>
                        <Icon name="refresh" size={12} />
                        Check status
                      </button>
                    ) : (
                      <button
                        disabled={!!pending || isWorking(row)}
                        title={
                          isWorking(row)
                            ? 'Finish or stop the task and confirm its result first.'
                            : undefined
                        }
                        onClick={() =>
                          row.archived
                            ? void mutate(row, 'archive')
                            : (setConfirmation(row), setError(''))
                        }
                      >
                        <Icon name={row.archived ? 'refresh' : 'archive'} size={12} />
                        {row.archived ? 'Restore' : 'Archive'}
                      </button>
                    )}
                  </div>
                )}
                {editing === row.id && (
                  <form
                    className="conversation-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (name.trim() && name.trim() !== row.title) void mutate(row, 'rename');
                    }}
                  >
                    <label htmlFor={'rename-' + row.id}>Conversation title</label>
                    <input
                      id={'rename-' + row.id}
                      aria-label="Conversation title"
                      value={name}
                      maxLength={80}
                      disabled={!!pending}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditing('');
                      }}
                    />
                    <div>
                      <button type="button" onClick={() => setEditing('')} disabled={!!pending}>
                        Cancel
                      </button>
                      <button
                        className="primary"
                        disabled={!!pending || !name.trim() || name.trim() === row.title}
                      >
                        {pending ? 'Saving…' : 'Save name'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </section>
        ))}
        {!page.data.length && !loading && (
          <div className="conversation-empty">
            <Icon name={archived ? 'archive' : 'search'} size={22} />
            <p>
              {search
                ? 'No matching titles in this portion.'
                : archived
                  ? 'No archived conversations.'
                  : 'No conversations yet.'}
            </p>
            {page.nextCursor && <span>Continue to search earlier conversations.</span>}
          </div>
        )}
        {loading && (
          <p className="conversation-loading" role="status">
            Loading conversations…
          </p>
        )}
      </nav>
      {(page.nextCursor || previous.length > 0) && (
        <div className="conversation-pagination">
          <button
            aria-label="Previous conversation page"
            disabled={!previous.length || loading}
            onClick={back}
          >
            <Icon name="chevron" size={12} />
          </button>
          <span>Page {previous.length + 1}</span>
          <button
            aria-label="Next conversation page"
            disabled={!page.nextCursor || loading}
            onClick={next}
          >
            <Icon name="chevron" size={12} />
          </button>
        </div>
      )}
      {confirmation &&
        createPortal(
          <div
            className="modal-backdrop"
            onClick={() => {
              if (!pending) setConfirmation(undefined);
            }}
          >
            <form
              ref={dialog}
              className="modal conversation-confirm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="archive-title"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(confirmation, 'archive');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && !pending) setConfirmation(undefined);
                if (e.key === 'Tab') {
                  const buttons = [
                    ...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
                  ];
                  if (e.shiftKey && document.activeElement === buttons[0]) {
                    e.preventDefault();
                    buttons.at(-1)?.focus();
                  } else if (!e.shiftKey && document.activeElement === buttons.at(-1)) {
                    e.preventDefault();
                    buttons[0]?.focus();
                  }
                }
              }}
            >
              <h2 id="archive-title">Archive this conversation?</h2>
              <p>
                <strong>{confirmation.title}</strong> will move to the archived view. Project files
                and history are kept. Codex may also archive chats spawned by this conversation.
              </p>
              {error && (
                <p className="error-text" role="alert">
                  {error}
                </p>
              )}
              <div className="conversation-confirm-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={!!pending}
                  onClick={() => setConfirmation(undefined)}
                >
                  Cancel
                </button>
                <button className="primary" disabled={!!pending}>
                  {pending ? 'Archiving…' : 'Archive conversation'}
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </section>
  );
});
