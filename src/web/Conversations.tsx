import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ConversationPage, Project, Summary } from '../shared/types';
import { message, post, request } from './api';
import { Icon } from './primitives';
import { InteractionDialog } from './InteractionDialog';
import { conversationStatus } from './conversation-status';
import { formatMessageTime } from './MessageTime';
import './conversations.css';

interface Props {
  projects: Project[];
  activeProjectId: string;
  selectedId: string;
  updates: Record<string, Summary[]>;
  disabled: boolean;
  connection: string;
  onProject: (id: string) => void;
  onNew: (projectId: string) => void;
  onSelect: (id: string, projectId: string) => void;
  onUpdated: (summary: Summary) => void;
  onModalChange: (open: boolean) => void;
}

const noUpdates: Summary[] = [];
const maxProjectReads = 4;
let projectReads = 0;
const waitingReads: (() => void)[] = [];

// All project cards share one request budget. Aborted, queued reads never reach the server.
function readConversationPage(path: string, signal: AbortSignal) {
  return new Promise<ConversationPage>((resolve, reject) => {
    const cancel = () => {
      const index = waitingReads.indexOf(start);
      if (index >= 0) waitingReads.splice(index, 1);
      reject(signal.reason);
    };
    const start = () => {
      signal.removeEventListener('abort', cancel);
      projectReads++;
      void request<ConversationPage>(path, {}, signal)
        .then(resolve, reject)
        .finally(() => {
          projectReads--;
          waitingReads.shift()?.();
        });
    };
    if (signal.aborted) reject(signal.reason);
    else if (projectReads < maxProjectReads) start();
    else {
      waitingReads.push(start);
      signal.addEventListener('abort', cancel, { once: true });
    }
  });
}
const isWorking = (row: Summary) =>
  !!row.executionPending ||
  !!row.queueCount ||
  ['running', 'waitingApproval', 'waitingInput'].includes(row.state);
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
    row.queueCount,
    row.queuePaused,
    row.queueIssue,
    row.executionUnknown,
    row.sidebarActivity,
    row.expiredQuestion,
    row.forkedFromId,
  ]);
function dayLabel(time: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return time >= today.getTime() ? 'Today' : time >= yesterday.getTime() ? 'Yesterday' : 'Earlier';
}

export const Conversations = memo(function Conversations({
  projects,
  activeProjectId,
  selectedId,
  updates,
  ...props
}: Props) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (query.trim() === search) return;
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query, search]);
  if (!projects.length) return null;
  return (
    <section className="conversations" aria-label="Conversation management">
      <div className="conversation-controls">
        <select
          aria-label="Conversation view"
          value={archived ? 'archived' : 'chats'}
          onChange={(event) => setArchived(event.target.value === 'archived')}
        >
          <option value="chats">Chats</option>
          <option value="archived">Archived</option>
        </select>
        <button
          className="icon-button"
          aria-label="Refresh conversations"
          title="Refresh conversations"
          onClick={() => setRevision((value) => value + 1)}
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>
      <div className="conversation-search-row">
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
      </div>
      <nav className="project-cards" aria-label="Conversations">
        {projects.map((project) => (
          <ProjectCard
            key={JSON.stringify([project.id, search, archived, revision])}
            project={project}
            active={project.id === activeProjectId}
            selectedId={project.id === activeProjectId ? selectedId : ''}
            updates={updates[project.id] ?? noUpdates}
            search={search}
            archived={archived}
            {...props}
          />
        ))}
      </nav>
    </section>
  );
});

const ProjectCard = memo(function ProjectCard({
  project,
  active,
  search,
  archived,
  selectedId,
  updates,
  disabled,
  connection,
  onProject,
  onNew,
  onSelect,
  onUpdated,
  onModalChange,
}: Omit<Props, 'projects' | 'activeProjectId' | 'updates'> & {
  project: Project;
  active: boolean;
  search: string;
  archived: boolean;
  updates: Summary[];
}) {
  const projectId = project.id;
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
  const [confirmation, saveConfirmation] = useState<Summary>();
  const setConfirmation = useCallback(
    (value?: Summary) => {
      saveConfirmation(value);
      onModalChange(!!value);
    },
    [onModalChange],
  );
  useEffect(() => () => onModalChange(false), [onModalChange]);
  const lastConnection = useRef(connection);
  useEffect(() => {
    // Replay may have expired while the browser was away. Re-read only the current
    // native list page, preserving search/cursor and avoiding conversation histories.
    if (connection === 'Connected' && lastConnection.current !== 'Connected')
      setRevision((value) => value + 1);
    lastConnection.current = connection;
  }, [connection]);
  const priorUpdates = useRef(new Map<string, string>());
  const generation = useRef(0);
  const latestUpdates = useRef(updates);
  latestUpdates.current = updates;

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    const current = ++generation.current;
    const before = new Map(latestUpdates.current.map((row) => [row.id, signature(row)]));
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ search, archived: String(archived) });
    if (cursor) params.set('cursor', cursor);
    void readConversationPage(
      '/projects/' + projectId + '/conversations?' + params.toString(),
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
    <section
      className="project-card"
      data-project-id={projectId}
      aria-labelledby={'project-heading-' + projectId}
      aria-busy={loading}
    >
      <header className="project-card-header">
        <h2 id={'project-heading-' + projectId}>
          <button
            className="project-card-name"
            aria-current={active ? 'true' : undefined}
            title={project.path}
            disabled={disabled}
            onClick={() => onProject(projectId)}
          >
            <Icon name="folder" size={16} />
            <span>{project.name}</span>
          </button>
        </h2>
        <button
          className="icon-button project-card-new"
          aria-label={active ? 'New conversation' : 'New conversation in ' + project.name}
          title={'New conversation in ' + project.name}
          disabled={disabled}
          onClick={() => onNew(projectId)}
        >
          <Icon name="plus" size={16} />
        </button>
      </header>
      {error && !confirmation && (
        <div className="conversation-error" role="alert">
          {error}
          <button onClick={refresh}>Refresh list</button>
        </div>
      )}
      <div className="project-conversations">
        {groups.map((group) => (
          <section key={group.label} className="conversation-group">
            <h3>{group.label}</h3>
            {group.rows.map((row) => {
              const status = conversationStatus(row);
              const routine = status.tone === 'neutral' && row.state === 'idle';
              const time = row.updatedAt > 0 ? formatMessageTime(row.updatedAt) : undefined;
              const shortTime =
                time &&
                new Intl.DateTimeFormat(
                  undefined,
                  group.label === 'Today'
                    ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
                    : { month: 'short', day: 'numeric' },
                ).format(row.updatedAt);
              return (
                <div
                  key={row.id}
                  className={'conversation-row ' + (row.id === selectedId ? 'selected' : '')}
                  data-conversation-id={row.id}
                  data-state={row.state}
                >
                  <div className="conversation-row-heading">
                    <button
                      className={'thread-link ' + (row.id === selectedId ? 'active' : '')}
                      aria-current={row.id === selectedId ? 'page' : undefined}
                      disabled={disabled}
                      onClick={() => onSelect(row.id, projectId)}
                      title={row.title}
                      aria-label={row.title}
                      aria-describedby={
                        'conversation-status-' +
                        row.id +
                        (time ? ' conversation-updated-' + row.id : '')
                      }
                    >
                      <span className="conversation-title">
                        <span>{row.title}</span>
                        {row.forkedFromId && (
                          <span
                            className="branch-mark"
                            title="Conversation branch"
                            aria-label="Conversation branch"
                          >
                            ⑂
                          </span>
                        )}
                        {time && (
                          <time
                            id={'conversation-updated-' + row.id}
                            dateTime={time.iso}
                            title={'Updated: ' + time.full}
                            aria-label={'Updated: ' + time.full}
                          >
                            {shortTime}
                          </time>
                        )}
                      </span>
                      <span
                        className={
                          'conversation-meta' + (routine && !status.queue ? ' is-routine' : '')
                        }
                        id={'conversation-status-' + row.id}
                      >
                        <span
                          className={
                            'conversation-status tone-' +
                            status.tone +
                            (routine ? ' visually-hidden' : '')
                          }
                        >
                          {status.label}
                        </span>
                        {status.queue && (
                          <span
                            className={
                              'conversation-queue ' +
                              (row.queueIssue === 'failed'
                                ? 'tone-error'
                                : row.queueIssue || row.queuePaused
                                  ? 'tone-attention'
                                  : '')
                            }
                          >
                            {status.queue}
                          </span>
                        )}
                      </span>
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
                              ? 'Finish or stop the task, confirm its result, and remove queued messages first.'
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
              );
            })}
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
      </div>
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
          <InteractionDialog
            title="Archive this conversation?"
            close={() => setConfirmation(undefined)}
            busy={!!pending}
            className="conversation-confirm"
            closeOnBackdrop
            initialFocus="[data-confirm-cancel]"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(confirmation, 'archive');
              }}
            >
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
                  data-confirm-cancel
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
          </InteractionDialog>,
          document.querySelector<HTMLElement>('.app')!,
        )}
    </section>
  );
});
