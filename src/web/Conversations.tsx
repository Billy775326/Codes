import { matchesConversationText } from '../shared/conversation-search';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  ConversationSort,
  NativeConversationPage,
  NativeConversationSummary,
  Project,
  Summary,
} from '../shared/types';
import { message, post, request } from './api';
import { Icon, IconButton } from './primitives';
import { InteractionDialog } from './InteractionDialog';
import { conversationStatus } from './conversation-status';
import { useInterfaceLanguage } from './interface-language';
import { formatMessageTime } from './MessageTime';
import './conversations.css';

const pageLimit = 30;
const maximumSearchRequests = 12;
type DirectoryScope = 'cwd' | 'repo' | 'all';
const isWorking = (row: Summary) =>
  !!row.executionPending ||
  !!row.queueCount ||
  ['running', 'waitingApproval', 'waitingInput'].includes(row.state);

interface Props {
  projects: Project[];
  cwd?: string;
  selectedId: string;
  updates: Summary[];
  disabled: boolean;
  connection: string;
  supportsCreatedSort: boolean;
  supportsRepositoryScope: boolean;
  accountScoped: boolean;
  onNew: () => void;
  onSelect: (id: string, projectId: string) => void;
  onUpdated: (summary: Summary) => void;
  onModalChange: (open: boolean) => void;
}

export const Conversations = memo(function Conversations(props: Props) {
  const { t } = useInterfaceLanguage();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [chosenScope, setChosenScope] = useState<DirectoryScope>();
  const [repository, setRepository] = useState<{ cwd: string; directories: string[] }>();
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState<ConversationSort>('updated_at');
  const [revision, setRevision] = useState(0);
  const archiveToggle = useRef<HTMLButtonElement>(null);
  const repositoryDirectories = repository?.cwd === props.cwd ? repository?.directories : undefined;
  const scope = !props.cwd
    ? 'all'
    : chosenScope === 'repo' && !repositoryDirectories?.length
      ? 'cwd'
      : (chosenScope ?? 'cwd');
  const cwd = scope === 'all' ? undefined : props.cwd;
  const repo = scope === 'repo';
  const effectiveSort = props.supportsCreatedSort ? sort : 'updated_at';

  useEffect(() => {
    if (!props.cwd || !props.supportsRepositoryScope) return;
    const controller = new AbortController();
    const workdir = props.cwd;
    void request<{ directories: string[] }>(
      '/conversations/repository?' + new URLSearchParams({ cwd: workdir }),
      {},
      controller.signal,
    ).then(
      ({ directories }) => {
        if (!controller.signal.aborted) setRepository({ cwd: workdir, directories });
      },
      () => {
        // Repo is available only when the runtime confirms linked worktrees.
        if (!controller.signal.aborted) setRepository({ cwd: workdir, directories: [] });
      },
    );
    return () => controller.abort();
  }, [props.cwd, props.supportsRepositoryScope, revision]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <section
      className="conversations"
      aria-label={t('Conversation management')}
      data-live={props.connection === 'Connected'}
    >
      <div className="conversation-controls">
        <div className="conversation-tools" role="group" aria-label={t('Session actions')}>
          <IconButton
            icon="newchat"
            label={t('New conversation')}
            disabled={props.disabled}
            onClick={props.onNew}
          />
          <IconButton
            icon="refresh"
            label={t('Refresh conversations')}
            onClick={() => setRevision((value) => value + 1)}
          />
        </div>
        {props.supportsCreatedSort && (
          <select
            className="session-sort"
            aria-label={t('Sort conversations')}
            value={effectiveSort}
            onChange={(event) => setSort(event.currentTarget.value as ConversationSort)}
          >
            <option value="updated_at">{t('Updated')}</option>
            <option value="created_at">{t('Created')}</option>
          </select>
        )}
      </div>
      <div className="conversation-search-row">
        <div className="conversation-search">
          <Icon name="search" size={14} />
          <input
            aria-label={t('Search conversations')}
            placeholder={t('Search conversations')}
            value={query}
            maxLength={120}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query && (
            <button aria-label={t('Clear search')} data-tooltip="" onClick={() => setQuery('')}>
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="session-filters">
        <div role="group" aria-label={t('Directory filter')}>
          <button
            aria-pressed={scope === 'cwd'}
            disabled={!props.cwd}
            data-tooltip={props.cwd || t('Choose a working directory')}
            onClick={() => setChosenScope('cwd')}
          >
            {t('Cwd')}
          </button>
          {!!repositoryDirectories?.length && (
            <button
              aria-pressed={repo}
              data-tooltip={t('Linked Git worktrees')}
              onClick={() => setChosenScope('repo')}
            >
              {t('Repo')}
            </button>
          )}
          <button aria-pressed={scope === 'all'} onClick={() => setChosenScope('all')}>
            {t('All')}
          </button>
        </div>
        <div role="group" aria-label={t('Archive filter')}>
          <button aria-pressed={!archived} onClick={() => setArchived(false)}>
            {t('Active')}
          </button>
          <button ref={archiveToggle} aria-pressed={archived} onClick={() => setArchived(true)}>
            {t('Archived')}
          </button>
        </div>
      </div>
      <ConversationList
        key={JSON.stringify([scope, cwd, archived, effectiveSort, search])}
        {...props}
        cwd={cwd}
        repositoryDirectories={repo ? repositoryDirectories : undefined}
        archived={archived}
        search={search}
        sort={effectiveSort}
        revision={revision}
        onArchive={() => archiveToggle.current?.focus()}
        onResumeArchived={() => setArchived(false)}
      />
    </section>
  );
});

function ConversationList({
  projects,
  cwd,
  repositoryDirectories,
  accountScoped,
  archived,
  search,
  sort,
  revision,
  selectedId,
  updates,
  disabled,
  connection,
  onSelect,
  onUpdated,
  onArchive,
  onResumeArchived,
  onModalChange,
}: Props & {
  archived: boolean;
  repositoryDirectories?: string[];
  search: string;
  sort: ConversationSort;
  revision: number;
  onArchive: () => void;
  onResumeArchived: () => void;
}) {
  const { t } = useInterfaceLanguage();
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [page, setPage] = useState<NativeConversationPage>();
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [pending, setPending] = useState('');
  const [confirmation, setConfirmation] = useState<NativeConversationSummary>();
  const archiveOpener = useRef<HTMLElement | null>(null);
  const refreshOnConnect = useRef(false);
  const latest = useRef(updates);
  latest.current = updates;
  const baseline = useRef(new Map(updates.map((row) => [row.id, row])));
  const loadedAt = useRef(0);
  const lastConnection = useRef(connection);
  useEffect(() => {
    const wasOffline = ['Reconnecting', 'Disconnected', 'Unavailable'].includes(
      lastConnection.current,
    );
    lastConnection.current = connection;
    if ((wasOffline || refreshOnConnect.current) && connection === 'Connected') {
      refreshOnConnect.current = false;
      setReload((value) => value + 1);
    }
  }, [connection]);
  useEffect(() => {
    const refresh = () => {
      if (
        !cursor &&
        document.visibilityState === 'visible' &&
        Date.now() - loadedAt.current > 15_000
      )
        setReload((value) => value + 1);
    };
    const online = () => {
      refreshOnConnect.current = true;
    };
    window.addEventListener('online', online);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('focus', refresh);
    };
  }, [cursor]);
  const dialogOpen = !!confirmation;

  useEffect(() => {
    if (!dialogOpen) return;
    onModalChange(true);
    return () => onModalChange(false);
  }, [dialogOpen, onModalChange]);

  const repo = !!repositoryDirectories;
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ archived: String(archived), search, sort });
    if (cwd) params.set('cwd', cwd);
    if (repo) params.set('repo', 'true');
    if (cursor) params.set('cursor', cursor);
    const known = new Map(latest.current.map((row) => [row.id, row]));
    setLoading(true);
    setError('');
    const load = async () => {
      let result = await request<NativeConversationPage>(
        '/conversations?' + params,
        {},
        controller.signal,
      );
      for (
        let i = 1;
        search && !result.data.length && result.nextCursor && i < maximumSearchRequests;
        i++
      ) {
        controller.signal.throwIfAborted();
        params.set('cursor', result.nextCursor);
        result = await request<NativeConversationPage>(
          '/conversations?' + params,
          {},
          controller.signal,
        );
      }
      return result;
    };
    void load()
      .then(
        (result) => {
          if (controller.signal.aborted) return;
          baseline.current = known;
          loadedAt.current = Date.now();
          setPage(result);
        },
        (cause) => {
          if (!controller.signal.aborted) setError(message(cause));
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [archived, cursor, cwd, repo, search, sort, revision, reload]);

  const { rows, findNewSessions } = useMemo(() => {
    if (!page) return { rows: [], findNewSessions: false };
    const pendingUpdates = updates.filter((row) => baseline.current.get(row.id) !== row);
    const byId = new Map(pendingUpdates.map((row) => [row.id, row]));
    const paths = new Map(projects.map((project) => [project.id, project.path]));
    const matches = (row: NativeConversationSummary) =>
      !!row.archived === archived &&
      (repositoryDirectories?.includes(row.cwd) ?? (!cwd || row.cwd === cwd)) &&
      (row.matchesSearchContext ||
        matchesConversationText(search, row.title, row.id, row.cwd, row.gitBranch));
    const present = new Set(page.data.map((row) => row.id));
    const visible = page.data.flatMap((row) => {
      const change = byId.get(row.id);
      if (!change) return [row];
      const next = {
        ...row,
        ...change,
        cwd:
          change.projectId === row.projectId ? row.cwd : (paths.get(change.projectId) ?? row.cwd),
      };
      return matches(next) ? [next] : [];
    });
    if (cursor || sort !== 'updated_at') return { rows: visible, findNewSessions: false };
    const oldest = page.data.at(-1)?.updatedAt ?? 0;
    const newRows = pendingUpdates.flatMap((row) => {
      const path = paths.get(row.projectId);
      if (!path || present.has(row.id) || row.updatedAt < oldest) return [];
      const next = { ...row, cwd: path, createdAt: 0 };
      return matches(next) ? [next] : [];
    });
    return {
      rows: accountScoped ? visible : [...newRows, ...visible].slice(0, pageLimit),
      findNewSessions: accountScoped && newRows.length > 0,
    };
  }, [
    page,
    updates,
    projects,
    archived,
    cwd,
    repositoryDirectories,
    search,
    cursor,
    sort,
    accountScoped,
  ]);

  useEffect(() => {
    if (!findNewSessions || loading || error) return;
    const timer = setTimeout(() => setReload((value) => value + 1), 180);
    return () => clearTimeout(timer);
  }, [findNewSessions, loading, error]);

  const closeConfirmation = () => {
    onModalChange(false);
    setConfirmation(undefined);
    requestAnimationFrame(() => archiveOpener.current?.focus());
  };
  const mutate = async (row: NativeConversationSummary, check = false) => {
    if (pending) return;
    setPending(row.id);
    setMutationError('');
    try {
      const result = await post<Summary>(
        '/threads/' + encodeURIComponent(row.id) + (check ? '/management-status' : '/archive'),
        check ? {} : { operationId: crypto.randomUUID(), archived: !row.archived },
      );
      onUpdated(result);
      onModalChange(false);
      setConfirmation(undefined);
      if (!check && row.archived && !result.archived) {
        onSelect(result.id, result.projectId);
        onResumeArchived();
      } else {
        if (!!result.archived !== !!row.archived) requestAnimationFrame(onArchive);
        setReload((value) => value + 1);
      }
    } catch (cause) {
      setMutationError(message(cause));
    } finally {
      setPending('');
    }
  };
  const next = () => {
    if (!page?.nextCursor || loading) return;
    setPrevious((value) => [...value.slice(-127), cursor]);
    setCursor(page.nextCursor);
  };
  const back = () => {
    if (!previous.length || loading) return;
    setCursor(previous.at(-1));
    setPrevious((value) => value.slice(0, -1));
  };

  return (
    <nav className="session-list" aria-label={t('Conversations')} aria-busy={loading}>
      {rows.map((row) => (
        <ConversationRow
          key={row.id}
          row={row}
          selected={row.id === selectedId}
          showDirectory={!cwd || row.cwd !== cwd}
          sort={sort}
          disabled={disabled}
          pending={!!pending}
          onSelect={() => (row.archived ? void mutate(row) : onSelect(row.id, row.projectId))}
          onPreview={() => onSelect(row.id, row.projectId)}
          onArchive={(button) => {
            archiveOpener.current = button;
            setMutationError('');
            setConfirmation(row);
          }}
          onCheck={() => void mutate(row, true)}
        />
      ))}
      {loading && !rows.length && (
        <p className="conversation-empty" role="status">
          {t('Loading conversations…')}
        </p>
      )}
      {!loading && !error && !rows.length && (
        <p className="conversation-empty">
          {t(
            page?.nextCursor
              ? 'No matches on this page'
              : archived
                ? 'No archived conversations'
                : 'No conversations',
          )}
        </p>
      )}
      {!confirmation && (error || mutationError) && (
        <div className="conversation-error" role="alert">
          <span>{t(error || mutationError)}</span>
          {error && <button onClick={() => setReload((value) => value + 1)}>{t('Retry')}</button>}
        </div>
      )}
      {(!!page?.nextCursor || previous.length > 0) && (
        <div className="conversation-pagination">
          <IconButton
            icon="chevron"
            label={t('Previous conversation page')}
            disabled={loading || !previous.length}
            onClick={back}
          />
          <span>{t('Page {number}', { number: previous.length + 1 })}</span>
          <IconButton
            icon="chevron"
            label={t('Next conversation page')}
            disabled={loading || !page?.nextCursor}
            onClick={next}
          />
        </div>
      )}
      {confirmation &&
        createPortal(
          <InteractionDialog
            title={t('Archive this conversation?')}
            close={closeConfirmation}
            busy={!!pending}
            className="conversation-confirm"
            closeOnBackdrop
            initialFocus="[data-confirm-cancel]"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(confirmation);
              }}
            >
              <div className="conversation-confirm-target">
                <Icon name="archive" size={18} />
                <strong>{confirmation.title}</strong>
              </div>
              <p>{t('Codex may also archive conversations started from this one.')}</p>
              {mutationError && (
                <p className="error-text" role="alert">
                  {t(mutationError)}
                </p>
              )}
              <div className="conversation-confirm-actions">
                <button
                  type="button"
                  className="secondary"
                  data-confirm-cancel
                  disabled={!!pending}
                  onClick={closeConfirmation}
                >
                  {t('Cancel')}
                </button>
                <button className="primary" disabled={!!pending}>
                  {t(pending ? 'Archiving…' : 'Archive conversation')}
                </button>
              </div>
            </form>
          </InteractionDialog>,
          document.querySelector('.app') ?? document.body,
        )}
    </nav>
  );
}

function ConversationRow({
  row,
  selected,
  showDirectory,
  sort,
  disabled,
  pending,
  onSelect,
  onPreview,
  onArchive,
  onCheck,
}: {
  row: NativeConversationSummary;
  selected: boolean;
  showDirectory: boolean;
  sort: ConversationSort;
  disabled: boolean;
  pending: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onArchive: (button: HTMLButtonElement) => void;
  onCheck: () => void;
}) {
  const { t, locale } = useInterfaceLanguage();
  const status = conversationStatus(row, t);
  const routine = status.tone === 'neutral' && !status.queue;
  const moment = sort === 'created_at' ? row.createdAt : row.updatedAt;
  const date = useMemo(() => {
    if (!moment) return;
    const full = formatMessageTime(moment, locale);
    const elapsed = Math.max(0, Math.floor((Date.now() - moment) / 1000));
    const [amount, unit] =
      elapsed >= 86_400
        ? ([Math.floor(elapsed / 86_400), 'day'] as const)
        : elapsed >= 3600
          ? ([Math.floor(elapsed / 3600), 'hour'] as const)
          : elapsed >= 60
            ? ([Math.floor(elapsed / 60), 'minute'] as const)
            : ([elapsed, 'second'] as const);
    return (
      full && {
        ...full,
        label: new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }).format(
          -amount,
          unit,
        ),
      }
    );
  }, [moment, locale]);
  const timeLabel = date
    ? t(sort === 'created_at' ? 'Created: {time}' : 'Updated: {time}', { time: date.full })
    : undefined;
  return (
    <div
      className={'conversation-row' + (selected ? ' selected' : '')}
      data-conversation-id={row.id}
      data-state={row.state}
    >
      <div className="conversation-row-heading">
        <button
          className="thread-link"
          aria-current={selected ? 'page' : undefined}
          disabled={disabled || (row.archived && (pending || !!row.managementPending))}
          onClick={onSelect}
          aria-label={
            row.archived ? t('Restore and resume {title}', { title: row.title }) : row.title
          }
          aria-describedby={
            'conversation-status-' + row.id + (date ? ' conversation-time-' + row.id : '')
          }
        >
          <span className="conversation-title">
            <span data-tooltip-overflow="">{row.title}</span>
            {row.forkedFromId && <Icon name="branch" size={12} />}
            {date && (
              <time
                id={'conversation-time-' + row.id}
                dateTime={date.iso}
                title={timeLabel}
                aria-label={timeLabel}
              >
                {date.label}
              </time>
            )}
          </span>
          <span
            className={
              'conversation-meta' +
              (!showDirectory && !row.gitBranch && routine ? ' is-routine' : '')
            }
            id={'conversation-status-' + row.id}
          >
            {row.gitBranch && (
              <span className="session-branch" data-tooltip-overflow="">
                <Icon name="branch" size={11} />
                {row.gitBranch}
              </span>
            )}
            {showDirectory && (
              <span className="session-cwd" data-tooltip-overflow="">
                {row.cwd}
              </span>
            )}
            <span
              data-indicator={status.indicator}
              className={
                'conversation-status tone-' + status.tone + (routine ? ' visually-hidden' : '')
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
            disabled={pending}
            onClick={onCheck}
          />
        ) : row.archived ? (
          <IconButton
            className="conversation-row-action"
            icon="eye"
            label={t('Preview {title}', { title: row.title })}
            disabled={disabled || pending}
            hint={t('Preview archived conversation')}
            onClick={onPreview}
          />
        ) : (
          <IconButton
            className="conversation-row-action"
            icon="archive"
            label={t('Archive {title}', { title: row.title })}
            disabled={pending || isWorking(row)}
            hint={t(
              isWorking(row)
                ? 'Resolve active work and clear the queue first.'
                : 'Archive conversation',
            )}
            onClick={(event) => onArchive(event.currentTarget)}
          />
        )}
      </div>
    </div>
  );
}
