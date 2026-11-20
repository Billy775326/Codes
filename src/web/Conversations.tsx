import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ConversationPage, Project, Summary } from '../shared/types';
import { message, post, request } from './api';
import { Icon } from './primitives';
import { InteractionDialog } from './InteractionDialog';
import { conversationStatus } from './conversation-status';
import { formatMessageTime } from './MessageTime';
import type { ProjectSidebarPreference } from './project-navigation';
import './conversations.css';

interface Props {
  projects: Project[];
  activeProjectId: string;
  selectedId: string;
  updates: Record<string, Summary[]>;
  disabled: boolean;
  connection: string;
  sidebarPreferences: Record<string, ProjectSidebarPreference>;
  onProject: (id: string) => void;
  onNew: (projectId: string) => void;
  onSelect: (id: string, projectId: string) => void;
  onUpdated: (summary: Summary) => void;
  onProjectUpdated: (project: Project, expectedName: string) => void;
  onSidebarPreference: (id: string, patch: ProjectSidebarPreference) => void;
  onRefreshProjects: () => void;
  onModalChange: (open: boolean) => void;
}

const noUpdates: Summary[] = [];
const maxProjectReads = 4;
const inactiveProjectAgeMs = 3 * 24 * 60 * 60 * 1000;
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
const sidebarClock = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const sidebarDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export const Conversations = memo(function Conversations({
  projects,
  activeProjectId,
  selectedId,
  updates,
  sidebarPreferences,
  onRefreshProjects,
  ...props
}: Props) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [revision, setRevision] = useState(0);
  const [activity, setActivity] = useState<Record<string, number>>({});
  const recordActivity = useCallback((projectId: string, updatedAt: number) => {
    setActivity((previous) =>
      updatedAt > (previous[projectId] ?? -1) ? { ...previous, [projectId]: updatedAt } : previous,
    );
  }, []);
  useEffect(() => {
    if (query.trim() === search) return;
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query, search]);
  if (!projects.length) return null;
  const orderedProjects = projects
    .map((project) => ({
      project,
      updatedAt: Math.max(activity[project.id] ?? -1, project.latestConversationAt ?? -1),
    }))
    .sort(
      (a, b) =>
        Number(!!sidebarPreferences[b.project.id]?.pinned) -
          Number(!!sidebarPreferences[a.project.id]?.pinned) ||
        b.updatedAt - a.updatedAt ||
        a.project.name.localeCompare(b.project.name) ||
        a.project.id.localeCompare(b.project.id),
    );
  const inactiveBefore = Date.now() - inactiveProjectAgeMs;
  return (
    <section
      className="conversations"
      aria-label="Conversation management"
      data-live={props.connection === 'Connected'}
    >
      <div className="conversation-controls">
        <button
          className={'icon-button archive-toggle' + (archived ? ' selected' : '')}
          aria-label="Archived conversations"
          aria-pressed={archived}
          data-tooltip={archived ? 'Back to chats' : 'Show archived chats'}
          onClick={() => setArchived((value) => !value)}
        >
          <Icon name="archive" size={16} />
          {archived && <span>Archived</span>}
        </button>
        <button
          className="icon-button"
          aria-label="Refresh conversations"
          data-tooltip=""
          onClick={() => {
            onRefreshProjects();
            setRevision((value) => value + 1);
          }}
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>
      <div className="conversation-search-row">
        <div className="conversation-search">
          <Icon name="search" size={14} />
          <input
            aria-label="Search projects and chats"
            placeholder="Search projects and chats"
            value={query}
            maxLength={120}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear search" data-tooltip="" onClick={() => setQuery('')}>
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      </div>
      <nav className="project-cards" aria-label="Conversations">
        {orderedProjects.map(({ project, updatedAt }) => {
          const projectMatch =
            !!search && project.name.toLowerCase().includes(search.toLowerCase());
          return (
            <ProjectCard
              key={JSON.stringify([project.id, search, projectMatch, archived])}
              project={project}
              active={project.id === activeProjectId}
              selectedId={project.id === activeProjectId ? selectedId : ''}
              updates={updates[project.id] ?? noUpdates}
              search={projectMatch ? '' : search}
              filtering={!!search}
              refreshVersion={revision}
              archived={archived}
              inactive={updatedAt >= 0 && updatedAt <= inactiveBefore}
              preference={sidebarPreferences[project.id]}
              onActivity={recordActivity}
              {...props}
            />
          );
        })}
        {search && (
          <p className="sidebar-search-empty conversation-empty">
            No matching projects or conversations
          </p>
        )}
      </nav>
    </section>
  );
});

const ProjectCard = memo(function ProjectCard({
  project,
  active,
  search,
  filtering,
  refreshVersion,
  archived,
  inactive,
  preference,
  selectedId,
  updates,
  disabled,
  connection,
  onProject,
  onNew,
  onSelect,
  onUpdated,
  onSidebarPreference,
  onProjectUpdated,
  onActivity,
  onModalChange,
}: Omit<
  Props,
  'projects' | 'activeProjectId' | 'updates' | 'sidebarPreferences' | 'onRefreshProjects'
> & {
  project: Project;
  active: boolean;
  search: string;
  filtering: boolean;
  refreshVersion: number;
  archived: boolean;
  inactive: boolean;
  preference?: ProjectSidebarPreference;
  updates: Summary[];
  onActivity: (projectId: string, updatedAt: number) => void;
}) {
  const projectId = project.id;
  const listId = 'project-conversations-' + projectId;
  const projectName = useRef<HTMLButtonElement>(null);
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [page, setPage] = useState<ConversationPage>({ data: [], nextCursor: null, scanned: 0 });
  const [loading, setLoading] = useState(filtering);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [menu, setMenu] = useState('');
  const [projectMenu, setProjectMenu] = useState(false);
  const [projectEdit, setProjectEdit] = useState<{ original: string; name: string }>();
  const [savingProject, setSavingProject] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [copied, setCopied] = useState<{ id: string; fallback?: string }>();
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
  const defaultExpanded =
    !inactive || active || updates.some(isWorking) || page.data.some(isWorking);
  const isExpanded = preference?.expanded ?? defaultExpanded;
  const shouldLoad = filtering || archived || isExpanded;
  const keepOpen = !!(filtering || archived || error || pending || confirmation || projectEdit);
  const collapsed = !keepOpen && !isExpanded;
  const seenRefresh = useRef(refreshVersion);

  useEffect(() => {
    const force = seenRefresh.current !== refreshVersion;
    seenRefresh.current = refreshVersion;
    if (!shouldLoad && !force) {
      setLoading(false);
      return;
    }
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
        if (current !== generation.current || controller.signal.aborted) return;
        onActivity(projectId, result.latestConversationAt ?? 0);
        // A delayed list response must not undo metadata received over SSE in the meantime.
        const changed = latestUpdates.current.filter(
          (row) => row.projectId === projectId && before.get(row.id) !== signature(row),
        );
        let data = result.data;
        for (const row of changed) {
          const index = data.findIndex((item) => item.id === row.id);
          if (index >= 0) data = data.map((item) => (item.id === row.id ? row : item));
          else if (!cursor) data = [row, ...data];
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
  }, [projectId, search, archived, cursor, revision, refreshVersion, shouldLoad, onActivity]);
  useEffect(() => {
    const delta = updates.filter(
      (row) => row.projectId === projectId && priorUpdates.current.get(row.id) !== signature(row),
    );
    priorUpdates.current = new Map(
      updates.filter((row) => row.projectId === projectId).map((row) => [row.id, signature(row)]),
    );
    if (!delta.length) return;
    onActivity(projectId, Math.max(...delta.map((row) => row.updatedAt)));
    setPage((old) => {
      let data = old.data.slice();
      for (const row of delta) {
        const index = data.findIndex((item) => item.id === row.id);
        if (index >= 0) {
          if (matches(row, archived, search)) data[index] = row;
          else data.splice(index, 1);
        } else if (!cursor && matches(row, archived, search)) data.unshift(row);
      }
      return {
        ...old,
        data: data
          .sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))
          .slice(0, 30),
      };
    });
  }, [updates, projectId, archived, search, cursor, onActivity]);

  const refresh = () => {
    if (!shouldLoad) onSidebarPreference(projectId, { expanded: true });
    setCursor(undefined);
    setPrevious([]);
    setRevision((v) => v + 1);
    setMenu('');
    setEditing('');
  };
  const renameProject = async () => {
    if (!projectEdit || savingProject) return;
    const name = projectEdit.name.trim();
    if (!name || name === projectEdit.original) return;
    setSavingProject(true);
    setProjectError('');
    try {
      const updated = await request<Project>('/projects/' + encodeURIComponent(projectId), {
        method: 'PUT',
        body: JSON.stringify({ name, expectedName: projectEdit.original }),
      });
      onProjectUpdated(updated, projectEdit.original);
      setProjectEdit(undefined);
      setProjectMenu(false);
      projectName.current?.focus();
    } catch (error) {
      setProjectError(message(error));
    } finally {
      setSavingProject(false);
    }
  };
  const copyConversation = async (row: Summary) => {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('conversation', row.id);
    try {
      await navigator.clipboard.writeText(url.href);
      setCopied({ id: row.id });
    } catch {
      setCopied({ id: row.id, fallback: url.href });
    }
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
  const rows = collapsed
    ? noUpdates
    : page.data.filter((row) => row.projectId === projectId && matches(row, archived, search));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <section
      className="project-card"
      data-project-id={projectId}
      aria-labelledby={'project-heading-' + projectId}
      aria-busy={loading}
      hidden={
        !!search &&
        !loading &&
        !error &&
        !rows.length &&
        !page.nextCursor &&
        !previous.length &&
        !projectEdit
      }
    >
      <header className="project-card-header">
        <h2 id={'project-heading-' + projectId}>
          <button
            ref={projectName}
            className="project-card-name"
            aria-current={active ? 'true' : undefined}
            aria-description={preference?.pinned ? 'Pinned project' : undefined}
            aria-controls={collapsed ? listId : undefined}
            aria-expanded={collapsed ? false : undefined}
            title={project.path}
            disabled={!collapsed && disabled}
            onClick={() => {
              if (collapsed) onSidebarPreference(projectId, { expanded: true });
              else onProject(projectId);
            }}
          >
            {!collapsed && <Icon name={preference?.pinned ? 'pin' : 'folder'} size={16} />}
            <span>{project.name}</span>
          </button>
        </h2>
        {!collapsed && (
          <button
            className="icon-button project-card-new"
            aria-label={active ? 'New conversation' : 'New conversation in ' + project.name}
            data-tooltip={'New conversation in ' + project.name}
            disabled={disabled}
            onClick={() => onNew(projectId)}
          >
            <Icon name="newchat" size={16} />
          </button>
        )}
        {!collapsed && (
          <button
            className="icon-button"
            aria-label={'Project actions for ' + project.name}
            aria-expanded={projectMenu}
            data-tooltip=""
            disabled={savingProject}
            onClick={() => {
              setProjectMenu(!projectMenu);
              setProjectEdit(undefined);
              setProjectError('');
              setMenu('');
              setEditing('');
            }}
          >
            <Icon name="more" size={16} />
          </button>
        )}
        {!collapsed && !keepOpen && !editing && (
          <button
            className="icon-button project-card-collapse"
            aria-label={'Collapse ' + project.name}
            data-tooltip=""
            aria-controls={listId}
            aria-expanded="true"
            onClick={() => {
              setMenu('');
              setProjectMenu(false);
              onSidebarPreference(projectId, { expanded: false });
              projectName.current?.focus();
            }}
          >
            <Icon name="chevron" size={14} />
          </button>
        )}
      </header>
      {projectMenu && (
        <div
          className="conversation-actions"
          role="group"
          aria-label={'Project actions: ' + project.name}
        >
          <button
            disabled={savingProject}
            onClick={() => {
              setProjectEdit({ original: project.name, name: project.name });
              setProjectError('');
            }}
          >
            <Icon name="edit" size={12} />
            Rename
          </button>
          <button onClick={() => onSidebarPreference(projectId, { pinned: !preference?.pinned })}>
            <Icon name="pin" size={12} />
            {preference?.pinned ? 'Unpin' : 'Pin'}
          </button>
        </div>
      )}
      {projectEdit && (
        <form
          className="conversation-rename"
          onSubmit={(event) => {
            event.preventDefault();
            void renameProject();
          }}
        >
          <label htmlFor={'project-rename-' + projectId}>Project name</label>
          <input
            id={'project-rename-' + projectId}
            value={projectEdit.name}
            maxLength={80}
            disabled={savingProject}
            autoFocus
            onChange={(event) => setProjectEdit({ ...projectEdit, name: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !savingProject) setProjectEdit(undefined);
            }}
          />
          {projectError && (
            <p className="error-text" role="alert">
              {projectError}
            </p>
          )}
          <div>
            <button
              type="button"
              disabled={savingProject}
              onClick={() => setProjectEdit(undefined)}
            >
              Cancel
            </button>
            <button
              className="primary"
              disabled={
                savingProject ||
                !projectEdit.name.trim() ||
                projectEdit.name.trim() === projectEdit.original
              }
            >
              {savingProject ? 'Saving…' : 'Save project name'}
            </button>
          </div>
        </form>
      )}
      {error && !confirmation && (
        <div className="conversation-error" role="alert">
          {error}
          <button onClick={refresh}>Refresh list</button>
        </div>
      )}
      <div className="project-conversations" id={listId} hidden={collapsed}>
        {rows.map((row) => {
          const status = conversationStatus(row);
          const routine = status.tone === 'neutral' && row.state === 'idle';
          const time = row.updatedAt > 0 ? formatMessageTime(row.updatedAt) : undefined;
          const shortTime =
            time &&
            (row.updatedAt >= today.getTime() ? sidebarClock : sidebarDate).format(row.updatedAt);
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
                  data-tooltip=""
                  aria-expanded={menu === row.id}
                  disabled={!!pending}
                  onClick={() => {
                    setMenu(menu === row.id ? '' : row.id);
                    setEditing('');
                    setError('');
                    setCopied(undefined);
                    if (!projectEdit) setProjectMenu(false);
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
                  <button onClick={() => void copyConversation(row)}>
                    <Icon name="link" size={12} />
                    {copied?.id === row.id && !copied.fallback ? 'Link copied' : 'Copy link'}
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
              {menu === row.id &&
                copied?.id === row.id &&
                (copied.fallback ? (
                  <label className="conversation-link">
                    Conversation link
                    <input
                      value={copied.fallback}
                      readOnly
                      onFocus={(event) => event.target.select()}
                    />
                  </label>
                ) : (
                  <span className="visually-hidden" role="status">
                    Conversation link copied
                  </span>
                ))}
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
        {!rows.length && !loading && !error && (search || archived) && (
          <p className="conversation-empty">
            {search
              ? page.nextCursor
                ? 'No matches on this page'
                : 'No matches'
              : 'No archived chats'}
          </p>
        )}
      </div>
      {!collapsed && (page.nextCursor || previous.length > 0) && (
        <div className="conversation-pagination">
          <button
            aria-label="Previous conversation page"
            data-tooltip=""
            disabled={!previous.length || loading}
            onClick={back}
          >
            <Icon name="chevron" size={12} />
          </button>
          <span>Page {previous.length + 1}</span>
          <button
            aria-label="Next conversation page"
            data-tooltip=""
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
