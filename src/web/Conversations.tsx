import { useInterfaceLanguage } from './interface-language';
import { memo, useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import type { ConversationPage, Project, ProjectUpdate, Summary } from '../shared/types';
import { message, post, request } from './api';
import { Icon, IconButton } from './primitives';
import { InteractionDialog } from './InteractionDialog';
import { conversationStatus } from './conversation-status';
import { formatMessageTime } from './MessageTime';
import type { ProjectSidebarPreference } from './project-navigation';
import './conversations.css';

function SidebarAction({
  icon,
  label,
  description,
  ...props
}: Pick<ComponentProps<'button'>, 'onClick' | 'disabled'> & {
  icon: string;
  label: string;
  description?: string;
}) {
  return (
    <button
      {...props}
      type="button"
      className="sidebar-action"
      aria-label={label}
      aria-description={description}
      data-tooltip={description ? label + ' · ' + description : ''}
    >
      <Icon name={icon} size={15} />
      <span>{label}</span>
    </button>
  );
}

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
  onAddProject: () => void;
  onSelect: (id: string, projectId: string) => void;
  onUpdated: (summary: Summary) => void;
  onProjectUpdated: (project: ProjectUpdate, expected: Omit<ProjectUpdate, 'id'>) => void;
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
const sidebarTimes = Object.fromEntries(
  ['en-US', 'zh-CN'].map((locale) => [
    locale,
    {
      clock: new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
      date: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }),
    },
  ]),
);

export const Conversations = memo(function Conversations({
  projects,
  activeProjectId,
  selectedId,
  updates,
  sidebarPreferences,
  onAddProject,
  onRefreshProjects,
  ...props
}: Props) {
  const { t } = useInterfaceLanguage();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [revision, setRevision] = useState(0);
  const [activity, setActivity] = useState<Record<string, number>>({});
  const archiveToggle = useRef<HTMLButtonElement>(null);
  const focusArchiveToggle = useCallback(() => archiveToggle.current?.focus(), []);
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
    .filter((project) => archived || !project.archived)
    .map((project) => ({
      project,
      updatedAt: Math.max(activity[project.id] ?? -1, project.latestConversationAt ?? -1),
    }))
    .sort(
      (a, b) =>
        Number(!!b.project.archived) - Number(!!a.project.archived) ||
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
      aria-label={t('Conversation management')}
      data-live={props.connection === 'Connected'}
    >
      <div className="conversation-controls">
        <button
          ref={archiveToggle}
          className={'icon-button archive-toggle' + (archived ? ' selected' : '')}
          aria-label={t('Archived projects and chats')}
          aria-pressed={archived}
          data-tooltip={archived ? t('Back to chats') : t('Show archived projects and chats')}
          onClick={() => setArchived((value) => !value)}
        >
          <Icon name="archive" size={16} />
          {archived && <span>{t('Archived')}</span>}
        </button>
        <div className="conversation-tools">
          <button
            className="icon-button"
            aria-label={t('Add project')}
            data-tooltip=""
            onClick={onAddProject}
          >
            <Icon name="folder-add" size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={t('Refresh projects and chats')}
            data-tooltip=""
            onClick={() => {
              onRefreshProjects();
              setRevision((value) => value + 1);
            }}
          >
            <Icon name="refresh" size={15} />
          </button>
        </div>
      </div>
      <div className="conversation-search-row">
        <div className="conversation-search">
          <Icon name="search" size={14} />
          <input
            aria-label={t('Search projects and chats')}
            placeholder={t('Search projects and chats')}
            value={query}
            maxLength={120}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label={t('Clear search')} data-tooltip="" onClick={() => setQuery('')}>
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      </div>
      <nav className="project-cards" aria-label={t('Conversations')}>
        {orderedProjects.map(({ project, updatedAt }) => {
          const projectMatch =
            !!search && project.name.toLowerCase().includes(search.toLowerCase());
          return (
            <ProjectCard
              key={JSON.stringify([project.id, search, projectMatch, archived, !!project.archived])}
              project={project}
              active={project.id === activeProjectId}
              selectedId={project.id === activeProjectId ? selectedId : ''}
              updates={updates[project.id] ?? noUpdates}
              search={projectMatch ? '' : search}
              filtering={!!search}
              refreshVersion={revision}
              archiveView={archived}
              inactive={updatedAt >= 0 && updatedAt <= inactiveBefore}
              preference={sidebarPreferences[project.id]}
              onActivity={recordActivity}
              onArchiveChange={focusArchiveToggle}
              {...props}
            />
          );
        })}
        {search && (
          <p className="sidebar-search-empty conversation-empty">
            {t('No matching projects or conversations')}
          </p>
        )}
        {!search && !orderedProjects.length && (
          <p className="conversation-empty">{t('No active projects')}</p>
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
  archiveView,
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
  onArchiveChange,
  onModalChange,
}: Omit<
  Props,
  | 'projects'
  | 'activeProjectId'
  | 'updates'
  | 'sidebarPreferences'
  | 'onRefreshProjects'
  | 'onAddProject'
> & {
  project: Project;
  active: boolean;
  search: string;
  filtering: boolean;
  refreshVersion: number;
  archiveView: boolean;
  inactive: boolean;
  preference?: ProjectSidebarPreference;
  updates: Summary[];
  onActivity: (projectId: string, updatedAt: number) => void;
  onArchiveChange: () => void;
}) {
  const { t, locale } = useInterfaceLanguage();
  const projectId = project.id;
  const listId = 'project-conversations-' + projectId;
  const actionsId = 'project-actions-' + projectId;
  const projectName = useRef<HTMLButtonElement>(null);
  const [archivedChats, setArchivedChats] = useState(true);
  const archived = archiveView && (!project.archived || archivedChats);
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [page, setPage] = useState<ConversationPage>({ data: [], nextCursor: null, scanned: 0 });
  const [loading, setLoading] = useState(filtering);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [projectMenu, setProjectMenu] = useState(false);
  const projectMenuButton = useRef<HTMLButtonElement>(null);
  const [projectEdit, setProjectEdit] = useState<{ original: string; name: string }>();
  const [savingProject, setSavingProject] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [pending, setPending] = useState('');
  const [confirmation, saveConfirmation] = useState<Summary | 'project'>();
  const setConfirmation = useCallback(
    (value?: Summary | 'project') => {
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
  const shouldLoad = filtering || archiveView || isExpanded;
  const keepOpen = !!(filtering || archiveView || error || pending || confirmation || projectEdit);
  const collapsed = !keepOpen && !isExpanded;
  const projectConfirmation = confirmation === 'project';
  const archiveBusy = projectConfirmation ? savingProject : !!pending;
  const closeProjectEdit = () => {
    setProjectEdit(undefined);
    projectMenuButton.current?.focus();
  };
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
      onProjectUpdated({ id: projectId, name: updated.name }, { name: projectEdit.original });
      setProjectEdit(undefined);
      setProjectMenu(false);
      projectName.current?.focus();
    } catch (error) {
      setProjectError(message(error));
    } finally {
      setSavingProject(false);
    }
  };
  const changeProjectArchive = async () => {
    if (savingProject) return;
    const archived = !project.archived;
    setSavingProject(true);
    setProjectError('');
    try {
      const updated = await request<ProjectUpdate>(
        '/projects/' + encodeURIComponent(projectId) + '/archive',
        {
          method: 'PUT',
          body: JSON.stringify({ archived }),
        },
      );
      setConfirmation(undefined);
      setProjectMenu(false);
      onProjectUpdated(updated, { archived: !archived });
      requestAnimationFrame(onArchiveChange);
    } catch (error) {
      setProjectError(message(error));
    } finally {
      setSavingProject(false);
    }
  };
  const mutate = async (row: Summary, action: 'archive' | 'check') => {
    if (pending) return;
    setPending(row.id);
    setError('');
    try {
      const result = await post<Summary>(
        '/threads/' + row.id + '/' + (action === 'check' ? 'management-status' : action),
        action === 'check' ? {} : { operationId: crypto.randomUUID(), archived: !row.archived },
      );
      onUpdated(result);
      setConfirmation(undefined);
      if (!!result.archived !== !!row.archived) requestAnimationFrame(onArchiveChange);
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
  };
  const back = () => {
    if (!previous.length || loading) return;
    setCursor(previous.at(-1));
    setPrevious((old) => old.slice(0, -1));
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
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !projectMenu || savingProject) return;
        event.stopPropagation();
        setProjectMenu(false);
        projectMenuButton.current?.focus();
      }}
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
            aria-description={
              project.archived
                ? t('Archived project')
                : preference?.pinned
                  ? t('Pinned project')
                  : undefined
            }
            aria-controls={collapsed ? listId : undefined}
            aria-expanded={collapsed ? false : undefined}
            title={project.path}
            disabled={!collapsed && disabled}
            onClick={() => {
              if (collapsed) onSidebarPreference(projectId, { expanded: true });
              else onProject(projectId);
            }}
          >
            {!collapsed && (
              <Icon
                name={project.archived ? 'archive' : preference?.pinned ? 'pin' : 'folder'}
                size={16}
              />
            )}
            <span>{project.name}</span>
          </button>
        </h2>
        {!collapsed && !project.archived && (
          <button
            className="icon-button project-card-new"
            aria-label={
              active
                ? t('New conversation')
                : t('New conversation in {project}', { project: project.name })
            }
            data-tooltip={t('New conversation in {project}', { project: project.name })}
            disabled={disabled}
            onClick={() => onNew(projectId)}
          >
            <Icon name="newchat" size={16} />
          </button>
        )}
        {!collapsed && (
          <button
            ref={projectMenuButton}
            className="icon-button"
            aria-label={t('Project actions for {project}', { project: project.name })}
            aria-expanded={projectMenu}
            aria-controls={projectMenu ? actionsId : undefined}
            data-tooltip=""
            disabled={savingProject}
            onClick={() => {
              setProjectMenu(!projectMenu);
              setProjectEdit(undefined);
              setProjectError('');
            }}
          >
            <Icon name="more" size={16} />
          </button>
        )}
        {!collapsed && !keepOpen && (
          <button
            className="icon-button project-card-collapse"
            aria-label={t('Collapse {project}', { project: project.name })}
            data-tooltip=""
            aria-controls={listId}
            aria-expanded="true"
            onClick={() => {
              setProjectMenu(false);
              onSidebarPreference(projectId, { expanded: false });
              projectName.current?.focus();
            }}
          >
            <Icon name="chevron" size={14} />
          </button>
        )}
      </header>
      {!collapsed && projectMenu && (
        <div
          id={actionsId}
          className="project-actions"
          role="group"
          aria-label={t('Project actions: {project}', { project: project.name })}
        >
          <SidebarAction
            icon="edit"
            label={t('Rename')}
            disabled={savingProject}
            onClick={() => {
              setProjectEdit({ original: project.name, name: project.name });
              setProjectError('');
            }}
          />
          <SidebarAction
            icon={preference?.pinned ? 'pin-off' : 'pin'}
            label={preference?.pinned ? t('Unpin') : t('Pin')}
            onClick={() => onSidebarPreference(projectId, { pinned: !preference?.pinned })}
          />
          <SidebarAction
            icon={project.archived ? 'unarchive' : 'archive'}
            label={project.archived ? t('Restore project') : t('Archive project')}
            disabled={savingProject}
            description={
              project.archived
                ? t('Return this project to the main sidebar.')
                : t('Move this project to the archive view. Its files and conversations are kept.')
            }
            onClick={() => {
              setProjectEdit(undefined);
              setProjectError('');
              if (project.archived) void changeProjectArchive();
              else setConfirmation('project');
            }}
          />
        </div>
      )}
      {projectError && !projectEdit && !projectConfirmation && (
        <p className="conversation-error" role="alert">
          {t(projectError)}
        </p>
      )}
      {projectEdit && (
        <form
          className="conversation-rename"
          onSubmit={(event) => {
            event.preventDefault();
            void renameProject();
          }}
        >
          <label htmlFor={'project-rename-' + projectId}>{t('Project name')}</label>
          <input
            id={'project-rename-' + projectId}
            value={projectEdit.name}
            maxLength={80}
            disabled={savingProject}
            autoFocus
            onChange={(event) => setProjectEdit({ ...projectEdit, name: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !savingProject) {
                event.stopPropagation();
                closeProjectEdit();
              }
            }}
          />
          {projectError && (
            <p className="error-text" role="alert">
              {t(projectError)}
            </p>
          )}
          <div>
            <button type="button" disabled={savingProject} onClick={closeProjectEdit}>
              {t('Cancel')}
            </button>
            <button
              className="primary"
              disabled={
                savingProject ||
                !projectEdit.name.trim() ||
                projectEdit.name.trim() === projectEdit.original
              }
            >
              {savingProject ? t('Saving…') : t('Save project name')}
            </button>
          </div>
        </form>
      )}
      {error && !confirmation && (
        <div className="conversation-error" role="alert">
          {t(error)}
          <button onClick={refresh}>{t('Refresh list')}</button>
        </div>
      )}
      {project.archived && (
        <div className="project-chat-filter">
          <select
            aria-label={t('Chats in {project}', { project: project.name })}
            value={archivedChats ? 'archived' : 'active'}
            disabled={!!pending || !!confirmation}
            onChange={(event) => {
              setArchivedChats(event.target.value === 'archived');
              setPage({ data: [], nextCursor: null, scanned: 0 });
              setLoading(true);
              refresh();
            }}
          >
            <option value="archived">{t('Archived chats')}</option>
            <option value="active">{t('Active chats')}</option>
          </select>
        </div>
      )}
      <div className="project-conversations" id={listId} hidden={collapsed}>
        {rows.map((row) => {
          const status = conversationStatus(row, t);
          const routine = status.tone === 'neutral' && row.state === 'idle';
          const time = row.updatedAt > 0 ? formatMessageTime(row.updatedAt, locale) : undefined;
          const shortTime =
            time &&
            (row.updatedAt >= today.getTime()
              ? sidebarTimes[locale]!.clock
              : sidebarTimes[locale]!.date
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
                        title={t('Conversation branch')}
                        aria-label={t('Conversation branch')}
                      >
                        ⑂
                      </span>
                    )}
                    {time && (
                      <time
                        id={'conversation-updated-' + row.id}
                        dateTime={time.iso}
                        title={t('Updated: {time}', { time: time.full })}
                        aria-label={t('Updated: {time}', { time: time.full })}
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
                      data-indicator={status.indicator}
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
                {row.managementPending ? (
                  <IconButton
                    className="conversation-row-action"
                    icon="refresh"
                    label={t('Check status for {title}', { title: row.title })}
                    disabled={!!pending}
                    onClick={() => void mutate(row, 'check')}
                  />
                ) : (
                  <IconButton
                    className="conversation-row-action"
                    icon={row.archived ? 'unarchive' : 'archive'}
                    label={t(row.archived ? 'Restore {title}' : 'Archive {title}', {
                      title: row.title,
                    })}
                    disabled={!!pending || isWorking(row)}
                    hint={
                      isWorking(row)
                        ? t(
                            'Finish or stop the task, confirm its result, and remove queued messages first.',
                          )
                        : undefined
                    }
                    onClick={() =>
                      row.archived
                        ? void mutate(row, 'archive')
                        : (setConfirmation(row), setError(''))
                    }
                  />
                )}
              </div>
            </div>
          );
        })}
        {!rows.length && !loading && !error && (search || archiveView) && (
          <p className="conversation-empty">
            {search
              ? page.nextCursor
                ? t('No matches on this page')
                : t('No matches')
              : archived
                ? t('No archived chats')
                : t('No active chats')}
          </p>
        )}
      </div>
      {!collapsed && (page.nextCursor || previous.length > 0) && (
        <div className="conversation-pagination">
          <button
            aria-label={t('Previous conversation page')}
            data-tooltip=""
            disabled={!previous.length || loading}
            onClick={back}
          >
            <Icon name="chevron" size={12} />
          </button>
          <span>{t('Page {number}', { number: previous.length + 1 })}</span>
          <button
            aria-label={t('Next conversation page')}
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
            title={t(projectConfirmation ? 'Archive this project?' : 'Archive this conversation?')}
            close={() => setConfirmation(undefined)}
            busy={archiveBusy}
            className="conversation-confirm"
            closeOnBackdrop
            initialFocus="[data-confirm-cancel]"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (confirmation === 'project') void changeProjectArchive();
                else void mutate(confirmation, 'archive');
              }}
            >
              <div className="conversation-confirm-target">
                <Icon name="archive" size={18} />
                <strong>{confirmation === 'project' ? project.name : confirmation.title}</strong>
              </div>
              <p>
                {t(
                  projectConfirmation
                    ? 'Restore this project anytime from Archived projects and chats. Its files and conversations are kept.'
                    : 'Restore this conversation anytime from Archived projects and chats. Its history and project files are kept.',
                )}
              </p>
              {!projectConfirmation && (
                <p>{t('Codex may also archive conversations started from this one.')}</p>
              )}
              {(projectConfirmation ? projectError : error) && (
                <p className="error-text" role="alert">
                  {t(projectConfirmation ? projectError : error)}
                </p>
              )}
              <div className="conversation-confirm-actions">
                <button
                  type="button"
                  className="secondary"
                  data-confirm-cancel
                  disabled={archiveBusy}
                  onClick={() => setConfirmation(undefined)}
                >
                  {t('Cancel')}
                </button>
                <button
                  className="primary"
                  aria-label={t(
                    archiveBusy
                      ? 'Archiving…'
                      : projectConfirmation
                        ? 'Archive project'
                        : 'Archive conversation',
                  )}
                  disabled={archiveBusy}
                >
                  {archiveBusy ? t('Archiving…') : t('Archive')}
                </button>
              </div>
            </form>
          </InteractionDialog>,
          document.querySelector<HTMLElement>('.app')!,
        )}
    </section>
  );
});
