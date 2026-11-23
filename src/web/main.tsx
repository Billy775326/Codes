import {
  InterfaceLanguageContext,
  interfaceLanguages,
  useInterfaceLanguage,
} from './interface-language';
import {
  linkedConversation,
  projectSidebarPreferences,
  projectViews,
  rememberProject,
  type ProjectSidebarPreference,
} from './project-navigation';
import { sameSettings } from '../shared/types';
import { messagePreviewText } from '../shared/question-replies';
import { imageLimits } from '../shared/images';
import { useSettingsProfile } from './useSettingsProfile';
import { settingsSchema } from '../shared/settings';
import { ImageAttachmentView } from './ImageAttachments';
import { AnswerMarkdown } from './ContentPreview';
import { useLocalAttachments } from './useLocalAttachments';
import { readBrowserPreferences, type Preferences } from './browser-preferences';
import { ConversationNotifications, notificationAccess } from './browser-notifications';
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  Action,
  Attachment,
  SettingsProfile,
  Envelope,
  FileContent,
  Message,
  Operation,
  Project,
  ProjectContext,
  ProjectUpdate,
  Settings,
  Summary,
  System,
  Thread,
  QueueState,
  QueuePayload,
  Model,
  ReviewTarget,
  FileChange,
} from '../shared/types';
import { ApiError, message, post, request, onAuthenticationRequired } from './api';
import { Feed } from './feed';
import { Brand, Icon } from './primitives';
import { Login } from './Login';
import { Conversations } from './Conversations';
import { QueuePanel } from './QueuePanel';
import { Approval } from './Approval';
import { DiffView } from './DiffView';
import { FilesPanel } from './FilesPanel';
import { PanelMenu } from './PanelMenu';
import { usePanelFocus } from './usePanelFocus';
import { ChangeSummary } from './ChangeSummary';
import { Transcript } from './Transcript';
import { isTurnOutcome } from './TurnResult';
import { MessageTime } from './MessageTime';
import {
  earlierWindow,
  historyLimit,
  refreshHistory,
  liveRevision,
  linkedToLatest,
  type HistoryDirection,
  type HistoryPage,
  type HistoryWindow,
} from './history';
import {
  InteractionDialog,
  PreferencesDialog,
  ReviewDialog,
  StatusDialog,
} from './InteractionDialog';
import { ComposerControls, type ComposerControlsHandle } from './ComposerControls';
import { ControlTooltip } from './ControlTooltip';
import { AddProjectDialog } from './AddProjectDialog';
import { WorkspaceHeader } from './WorkspaceHeader';
import './foundation.css';
import './interactions.css';
import './workflow.css';
import './style.css';
import './workspace.css';
import './preferences.css';
import './composer.css';

const saved = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};
const save = (key: string, value: string) => {
  try {
    if ((key.startsWith('codes.draft.') || key.startsWith('codes.new-settings.')) && value) {
      const drafts = Object.keys(localStorage).filter(
        (entry) =>
          entry.startsWith(
            key.startsWith('codes.new-settings.') ? 'codes.new-settings.' : 'codes.draft.',
          ) && entry !== key,
      );
      while (drafts.length >= 20) localStorage.removeItem(drafts.shift()!);
    }
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
    return true;
  } catch {
    // Storage may be unavailable; preference callers surface the failed save.
    return false;
  }
};
const draftKey = (projectId: string, threadId: string) =>
  'codes.draft.' + (threadId || 'new.' + projectId);
const streamBatchMs = 96;
const sameQueueDraft = (a: QueuePayload, b: QueuePayload) =>
  a.text === b.text &&
  sameSettings(a.settings, b.settings) &&
  JSON.stringify(a.attachments) === JSON.stringify(b.attachments);

const MessageView = memo(function MessageView({
  projectId,
  projectPath,
  item,
  streaming,
  onReply,
  onFork,
  disabled,
  onReview,
  actions = false,
  changes,
  timestamp,
  completion,
}: {
  onReply?: (item: Message) => void;
  onFork?: (item: Message) => void;
  disabled?: boolean;
  onReview?: (item: Message, path?: string) => void;
  projectId: string;
  projectPath?: string;
  item: Message;
  streaming: boolean;
  actions?: boolean;
  changes?: Message;
  timestamp?: number;
  completion?: React.ReactNode;
}) {
  const { t } = useInterfaceLanguage();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState('');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  if (item.kind === 'change' && item.files?.length)
    return (
      <ChangeSummary item={item} review={onReview ? (path) => onReview(item, path) : undefined} />
    );
  if (item.kind === 'command' || item.kind === 'change' || item.kind === 'tool') {
    const firstLine = item.text
      .slice(0, item.text.indexOf('\n') < 0 ? 120 : item.text.indexOf('\n'))
      .slice(0, 100);
    return (
      <details
        className="tool"
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>
          <Icon name={item.status === 'completed' ? 'check' : 'terminal'} size={14} />
          <span className="activity-label">
            {item.kind === 'command'
              ? t(item.status === 'inProgress' ? 'Running {command}' : 'Ran {command}', {
                  command: firstLine || t('command'),
                })
              : item.kind === 'tool'
                ? firstLine
                : t('File changes')}
          </span>
          <span className="activity-status">{t(item.status ?? '')}</span>
        </summary>
        {expanded && (
          <>
            <pre>{item.text}</pre>
            {item.truncated && (
              <p className="tool-truncated">
                {t('Output preview is truncated. Inspect native history for the complete output.')}
              </p>
            )}
          </>
        )}
      </details>
    );
  }
  if (item.kind === 'compaction')
    return (
      <p className="message compaction" data-message-id={item.id} data-turn-id={item.turnId}>
        {item.text}
      </p>
    );
  return (
    <article
      data-message-id={item.id}
      data-turn-id={item.turnId}
      className={`message ${item.kind}`}
      data-testid={`message-${item.kind}`}
    >
      <div className="message-body">
        <div className="message-label">
          {streaming && (
            <span className="thinking">
              {t('Working')}
              <span>•••</span>
            </span>
          )}
        </div>
        {!!item.images?.length && (
          <div className="message-images">
            {item.images.map((image, index) => (
              <ImageAttachmentView
                key={image.id + ':' + index}
                image={image}
                projectId={projectId}
              />
            ))}
          </div>
        )}
        {!!item.unavailableImages && (
          <p className="image-unavailable">
            {item.unavailableImages}
            {' ' + t('image attachment(s) available in native history.')}
          </p>
        )}
        <div className="prose">
          {item.kind === 'assistant' ? (
            <AnswerMarkdown
              text={item.text}
              projectId={projectId}
              projectPath={projectPath}
              streaming={streaming}
            />
          ) : (
            <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
          )}
          {streaming && <span className="caret" aria-hidden="true" />}
        </div>
        {changes && (
          <ChangeSummary
            item={changes}
            review={onReview ? (path) => onReview(changes, path) : undefined}
          />
        )}
        {!streaming &&
          item.kind !== 'user' &&
          ((actions && item.turnId && (onReply || onFork)) ||
            timestamp !== undefined ||
            completion) && (
            <div className="message-footer">
              {actions && !streaming && item.turnId && (onReply || onFork) && (
                <div className="message-actions" role="group" aria-label={t('Reply actions')}>
                  <button
                    aria-label={t('Copy message')}
                    data-tooltip=""
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(item.text)
                        .then(() => {
                          setCopied('Copied');
                          clearTimeout(copyTimer.current);
                          copyTimer.current = setTimeout(() => setCopied(''), 2000);
                        })
                        .catch(() => setCopied('Copy unavailable. Select the message text.'));
                      if (!navigator.clipboard)
                        setCopied('Copy unavailable. Select the message text.');
                    }}
                  >
                    <Icon name="copy" size={13} />
                  </button>
                  {copied && <span role="status">{t(copied)}</span>}
                  {onReply && (
                    <button
                      aria-label={t('Reply')}
                      title={t('Quote this reply into a new draft; the original stays unchanged')}
                      disabled={disabled}
                      onClick={() => onReply(item)}
                    >
                      <Icon name="reply" size={13} />
                      <span className="action-label">{t('Reply')}</span>
                    </button>
                  )}
                  {onFork && (
                    <button
                      aria-label={t('Branch from here')}
                      title={t(
                        'Create a conversation branch through this turn; current project files stay shared',
                      )}
                      disabled={disabled}
                      onClick={() => onFork(item)}
                    >
                      <Icon name="branch" size={13} />
                      <span className="action-label">{t('Branch from here')}</span>
                    </button>
                  )}
                </div>
              )}
              {completion ?? <MessageTime value={timestamp} kind="finished" />}
            </div>
          )}
      </div>
      {item.kind === 'user' && <MessageTime value={timestamp} kind="started" />}
    </article>
  );
});

function App() {
  const [auth, setAuth] = useState<'loading' | 'login' | 'ready'>('loading');
  const [token, setToken] = useState('');
  const [system, setSystem] = useState<System>();
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const maintenanceExpiresAt = system?.maintenance?.expiresAt;
  const [projects, setProjects] = useState<Project[]>([]);
  const projectMetadataRevision = useRef(0);
  const [sidebarPreferences, setSidebarPreferences] = useState(() =>
    projectSidebarPreferences(saved('codes.project-sidebar')),
  );
  const changeSidebarPreference = useCallback((id: string, patch: ProjectSidebarPreference) => {
    setSidebarPreferences((old) => ({ ...old, [id]: { ...old[id], ...patch } }));
  }, []);
  useEffect(() => {
    save('codes.project-sidebar', JSON.stringify(sidebarPreferences));
  }, [sidebarPreferences]);
  const projectUpdated = useCallback(
    (project: ProjectUpdate, expected?: Omit<ProjectUpdate, 'id'>) => {
      projectMetadataRevision.current++;
      setProjects((list) =>
        list.map((old) =>
          old.id === project.id &&
          (expected?.name === undefined || old.name === expected.name) &&
          (expected?.archived === undefined || !!old.archived === expected.archived)
            ? { ...old, ...project }
            : old,
        ),
      );
    },
    [],
  );
  const views = useRef<Record<string, string>>({});
  const recentProject = useRef<string | undefined>(undefined);
  const [selection, setSelection] = useState(() => {
    // Streaming renders must not repeatedly read browser storage.
    views.current = projectViews(saved('codes.project-views'));
    const projectId = saved('codes.project'),
      explicitThread = linkedConversation(location.search) || saved('codes.thread');
    const threadId = explicitThread || views.current[projectId] || '';
    recentProject.current = !explicitThread && threadId ? projectId : undefined;
    return { projectId, threadId };
  });
  const { projectId, threadId } = selection;
  const [threads, setThreads] = useState<Record<string, Summary[]>>({});
  const [context, setContext] = useState<ProjectContext>();
  const [thread, setThread] = useState<Thread>();
  const contextProjectId = threadId ? (thread?.id === threadId ? thread.projectId : '') : projectId;
  const contextBase = threadId ? '/threads/' + threadId : '/projects/' + projectId;
  const contextReady = !!contextProjectId && context?.project.id === contextProjectId;
  const directoryBlocked = contextReady && !context.directory.available;
  const remember = (owner: string, id: string) => {
    if (!owner) return;
    views.current = rememberProject(views.current, owner, id);
    save('codes.project-views', JSON.stringify(views.current));
  };
  const [models, setModels] = useState<Model[]>([]);
  const [autoReviewReady, setAutoReviewReady] = useState(false);
  const [modes, setModes] = useState<{ mode?: 'default' | 'plan'; name: string }[]>([]);
  const [dialog, setDialog] = useState<'preferences' | 'review' | 'status'>();
  const [preferences, setPreferences] = useState(() =>
    readBrowserPreferences(saved('codes.preferences')),
  );
  const interfaceLanguage = interfaceLanguages[preferences.language];
  const { t } = interfaceLanguage;
  const latestPreferences = useRef(preferences);
  const [preferencesError, setPreferencesError] = useState('');
  const notifications = useMemo(() => new ConversationNotifications(), []);
  const notifyInBackground = preferences.notifications && notificationAccess() === 'granted';
  const changePreferences = (value: Preferences) => {
    latestPreferences.current = value;
    setPreferences(value);
    const stored = save('codes.preferences', JSON.stringify(value));
    setPreferencesError(stored ? '' : 'Changes apply now, but this browser could not save them.');
  };
  const [steerReceipt, setSteerReceipt] = useState<{
    operationId: string;
    text: string;
    attachments?: Attachment[];
  }>();
  const threadRef = useRef(threadId);
  threadRef.current = threadId;
  const composerControls = useRef<ComposerControlsHandle>(null);
  const [newSettings, setNewSettings] = useState<Settings>({ permission: 'read-only' });
  const defaultSettings = useSettingsProfile(auth === 'ready' ? '/settings/defaults' : undefined);
  const conversationSettings = useSettingsProfile(
    auth === 'ready' && threadId ? '/threads/' + threadId + '/settings' : undefined,
  );
  const settings = threadId
    ? (conversationSettings.value?.settings ??
      (thread?.id === threadId
        ? (thread.composerSettings?.settings ?? thread.settings)
        : { permission: 'read-only' as const }))
    : newSettings;
  const profile = threadId ? conversationSettings : defaultSettings;
  const settingsBlocked = profile.loading || profile.saving || !!profile.error || !profile.saved;
  const changeSettings = (next: Settings) => {
    if (threadId) conversationSettings.change(next);
    else {
      setNewSettings(next);
      if (!save('codes.new-settings.' + projectId, JSON.stringify(next)))
        setError('Draft settings apply now, but this browser could not save them.');
    }
  };
  useEffect(() => {
    if (threadId || !defaultSettings.saved) return;
    let restored: Settings | undefined;
    try {
      const parsed = settingsSchema.safeParse(
        JSON.parse(saved('codes.new-settings.' + projectId) || 'null'),
      );
      if (parsed.success) restored = parsed.data;
    } catch {
      /* An invalid browser-only draft falls back to the server defaults. */
    }
    setNewSettings(restored ?? defaultSettings.saved.settings);
  }, [projectId, threadId, defaultSettings.saved]);
  const [draft, setDraft] = useState('');
  const [queueEditing, setQueueEditing] = useState(false);
  const draftRevision = useRef(0);
  const draftValue = useRef(draft);
  draftValue.current = draft;
  const [queueRequest, setQueueRequest] = useState<{
    operationId: string;
    payload: QueuePayload;
  }>();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [forking, setForking] = useState<Message>();
  const [recoveryFork, setRecoveryFork] = useState(false);
  const branchContext = useRef<{ id: string; attachments: Attachment[] } | undefined>(undefined);
  const [forkBusy, setForkBusy] = useState(false);
  const forkOperations = useRef(new Map<string, string>());
  const [forkError, setForkError] = useState('');
  const composer = useRef<HTMLTextAreaElement>(null);
  const queueRevision = useRef(0);
  const queueRevisionAtRender = queueRevision.current;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('Connecting');
  const [connectionError, setConnectionError] = useState('');
  const [retry, setRetry] = useState(0);
  const [sidebar, setSidebar] = useState(
    window.innerWidth > 1099 && saved('codes.navigation') !== 'closed',
  );
  const [prefersDark, setPrefersDark] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const theme =
    preferences.theme === 'system' ? (prefersDark ? 'dark' : 'light') : preferences.theme;
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = preferences.language;
  }, [theme, preferences.language]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setPrefersDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (window.innerWidth > 1099) save('codes.navigation', sidebar ? 'open' : 'closed');
  }, [sidebar]);
  const [panel, setPanel] = useState<'files' | 'diff' | null>(null);
  const navigationElement = useRef<HTMLElement>(null);
  const contextElement = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(window.innerWidth <= 1099);
  const closeNavigation = useCallback(() => {
    setSidebar(false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('[data-open-navigation]')?.focus(),
    );
  }, []);
  const closeContext = useCallback(() => setPanel(null), []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1099px)');
    const resize = () => {
      setNarrow(media.matches);
      setSidebar(media.matches ? false : saved('codes.navigation') !== 'closed');
    };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  usePanelFocus(navigationElement, narrow && sidebar, closeNavigation, '[data-open-navigation]');
  usePanelFocus(contextElement, narrow && !!panel && !sidebar, closeContext, '[data-browse-files]');
  const [diffTurn, setDiffTurn] = useState('');
  const [diffPath, setDiffPath] = useState('');
  const [adding, setAdding] = useState(false);
  const openAddProject = useCallback(() => setAdding(true), []);
  const [conversationModalOpen, setConversationModalOpen] = useState(false);
  const [directory, setDirectory] = useState('');
  const [filePath, setFilePath] = useState<string>();
  const [receipt, setReceipt] = useState('');
  const feed = useRef<Feed | undefined>(undefined);
  const transcript = useRef<HTMLDivElement>(null);
  const historyAnchor = useRef<{ threadId: string; turnId?: string; offset: number } | undefined>(
    undefined,
  );
  const follow = useRef(true);
  const positionedConversation = useRef<string | undefined>(undefined);
  const historyRead = useRef<AbortController | undefined>(undefined);
  const scrollPosition = useRef(0);
  const touchPosition = useRef<number | undefined>(undefined);
  const restoringScroll = useRef(false);
  const [anchorRevision, setAnchorRevision] = useState(0);
  const automaticHistory = useRef(new Set<string>());
  const scrollDirection = useRef<HistoryDirection | undefined>(undefined);
  const [historyError, setHistoryError] = useState<{
    direction: HistoryDirection;
    message: string;
  }>();
  const [historyWindow, setHistoryWindow] = useState<HistoryWindow>();
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [atLatest, setAtLatest] = useState(true);
  const history = historyWindow?.threadId === threadId ? historyWindow : undefined;
  const timelineLatest = !history || (!!thread && linkedToLatest(history, thread));
  const visibleMessages = useMemo(
    () => (thread ? (history ? refreshHistory(history, thread) : thread.messages) : []),
    [thread?.messages, history],
  );
  const visibleTurns = useMemo(
    () => [
      ...(history?.turns ?? []).filter(
        (turn) => !thread?.turns?.some((latest) => latest.id === turn.id),
      ),
      ...(thread?.turns ?? []),
    ],
    [history?.turns, thread?.turns],
  );
  const reviewMessages = useMemo(() => {
    const latest = thread?.messages ?? [];
    if (!history) return latest;
    const liveIds = new Set(latest.map((item) => item.id));
    return [...visibleMessages.filter((item) => !liveIds.has(item.id)), ...latest];
  }, [visibleMessages, thread?.messages, history]);
  const returnToLatest = useCallback(() => {
    historyRead.current?.abort();
    historyRead.current = undefined;
    historyAnchor.current = undefined;
    setLoadingHistory(false);
    setHistoryError(undefined);
    automaticHistory.current.clear();
    scrollDirection.current = undefined;
    setHistoryWindow(undefined);
    setAtLatest(true);
    follow.current = true;
    requestAnimationFrame(() => {
      if (follow.current && transcript.current) {
        transcript.current.scrollTop = transcript.current.scrollHeight;
        scrollPosition.current = transcript.current.scrollTop;
      }
    });
  }, []);
  useEffect(() => () => historyRead.current?.abort(), [threadId, projectId, auth]);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const notice = useCallback((e: unknown) => {
    if (e instanceof ApiError && (e.code === 'AUTH_REQUIRED' || e.status === 401)) {
      setError(
        'Your session has expired. Sign in again to continue. Your draft is saved in this browser.',
      );
      setBusy(false);
      setAuth('login');
    } else {
      if (e instanceof ApiError && ['DIRECTORY_UNAVAILABLE', 'DIRECTORY_ACCESS'].includes(e.code))
        setContext((current) =>
          current?.project.id === projectRef.current
            ? {
                ...current,
                directory: {
                  available: false,
                  code: e.code as 'DIRECTORY_UNAVAILABLE' | 'DIRECTORY_ACCESS',
                  message: e.message,
                },
              }
            : current,
        );
      setError(message(e));
    }
  }, []);
  const attachmentsUnavailable =
    auth !== 'ready' ||
    !contextReady ||
    directoryBlocked ||
    !!thread?.archived ||
    !!thread?.managementPending;
  const localAttachments = useLocalAttachments({
    projectId: contextProjectId,
    scope: auth + ':' + projectId + ':' + threadId,
    count: attachments.length,
    disabled: attachmentsUnavailable,
    attach: (attachment) => {
      draftRevision.current++;
      setAttachments((list) =>
        list.length >= imageLimits.attachments ||
        list.some(
          (entry) => 'id' in entry && entry.kind === attachment.kind && entry.id === attachment.id,
        )
          ? list
          : [...list, attachment],
      );
    },
    error: notice,
  });
  const attachmentBlocked =
    attachmentsUnavailable ||
    !!localAttachments.pending ||
    attachments.length >= imageLimits.attachments;
  const hasInput = !!draft.trim() || attachments.some((entry) => entry.kind === 'image');
  const connectionStatus = useCallback((status: string) => {
    setConnection(status);
    if (status === 'Connected') setConnectionError('');
  }, []);
  const connectionFailure = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && (error.status === 401 || error.code === 'AUTH_REQUIRED'))
        notice(error);
      else setConnectionError(message(error));
    },
    [notice],
  );
  const refreshProjects = useCallback(() => {
    const revision = ++projectMetadataRevision.current;
    void request<Project[]>('/projects').then((projects) => {
      if (revision === projectMetadataRevision.current) setProjects(projects);
    }, notice);
  }, [notice]);
  useEffect(() => {
    if (auth === 'ready' && connection === 'Connected') refreshProjects();
  }, [auth, connection, refreshProjects]);
  useEffect(() => {
    if (auth === 'ready') return onAuthenticationRequired(notice);
  }, [auth, notice]);
  const init = async () => {
    try {
      const [system, projects] = await Promise.all([
        request<System>('/system'),
        request<Project[]>('/projects'),
      ]);
      setSystem(system);
      setProjects(projects);
      if (!projects.some((p) => p.id === projectId)) {
        const project = projects.find((p) => !p.archived) ?? projects[0];
        setSelection((current) => ({ ...current, projectId: project?.id ?? '' }));
      }
      setAuth('ready');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'AUTH_REQUIRED') setAuth('login');
      else notice(e);
    }
  };
  useEffect(() => {
    void init();
  }, []);
  useEffect(() => {
    if (auth !== 'ready') return;
    const controller = new AbortController();
    void Promise.all([
      request<Model[]>('/models', {}, controller.signal),
      request<typeof modes>('/modes', {}, controller.signal),
    ])
      .then(async ([models, modes]) => {
        setModels(models);
        setModes(modes);
        setSystem(await request<System>('/system', {}, controller.signal));
      })
      .catch((e) => {
        if (!controller.signal.aborted) notice(e);
      });
    void request<{ autoReview: boolean }>('/permissions', {}, controller.signal)
      .then((permissions) => setAutoReviewReady(permissions.autoReview))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setAutoReviewReady(false);
          notice(error);
        }
      });
    return () => controller.abort();
  }, [auth]);
  useEffect(() => {
    if (auth !== 'ready' || !maintenanceExpiresAt) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const next = await request<System>('/system', {}, controller.signal);
        if (!controller.signal.aborted) setSystem(next);
      } catch {
        // The connection indicator reports outages during a preview switch.
      }
    };
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [auth, maintenanceExpiresAt]);
  const changeMaintenance = async (action: 'start' | 'cancel') => {
    setMaintenanceBusy(true);
    try {
      setSystem(await post<System>('/maintenance', { action }));
    } catch (error) {
      notice(error);
    } finally {
      setMaintenanceBusy(false);
    }
  };
  const conversationUpdated = useCallback((value: Summary, updateThread = true) => {
    const {
      id,
      projectId,
      title,
      state,
      updatedAt,
      archived,
      managementPending,
      executionPending,
      forkedFromId,
      queueCount,
      queuePaused,
      queueIssue,
      executionUnknown,
      sidebarActivity,
      expiredQuestion,
    } = value;
    const summary: Summary = {
      id,
      projectId,
      title,
      state,
      updatedAt,
      archived,
      managementPending,
      executionPending,
      forkedFromId,
      queueCount,
      queuePaused,
      queueIssue,
      executionUnknown,
      sidebarActivity,
      expiredQuestion,
    };
    setThreads((byProject) => ({
      ...byProject,
      [projectId]: [summary, ...(byProject[projectId] ?? []).filter((row) => row.id !== id)].slice(
        0,
        200,
      ),
    }));
    if (updateThread)
      setThread((current) => (current?.id === summary.id ? { ...current, ...summary } : current));
  }, []);
  useEffect(() => {
    if (auth !== 'ready') setThreads({});
  }, [auth]);
  useEffect(() => {
    setThread((current) =>
      current?.projectId === projectId && current.id === threadId ? current : undefined,
    );
    setDirectory('');
    setPanel(null);
    setFilePath(undefined);
    setAttachments([]);
    save('codes.project', projectId);
  }, [projectId, auth]);
  useEffect(() => {
    if (!projectId || threadId || auth !== 'ready') return;
    const controller = new AbortController();
    void request<ProjectContext>('/projects/' + projectId + '/context', {}, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setContext(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) notice(error);
      });
    return () => controller.abort();
  }, [projectId, threadId, auth, retry]);
  useEffect(() => {
    if (!projectId || threadId || auth !== 'ready') return;
    const stream = new Feed<{ threads: Summary[]; cursor: { seq: number; epoch: string } }>(
      projectId,
      (snapshot) => {
        if (notifyInBackground)
          for (const row of snapshot.threads) notifications.observe(row, false);
        setThreads((byProject) => ({ ...byProject, [projectId]: snapshot.threads }));
      },
      (event) => {
        if (event.kind === 'summary') {
          const row = event.data as Summary;
          if (notifyInBackground)
            notifications.observe(
              row,
              true,
              interfaceLanguages[latestPreferences.current.language].t,
            );
          conversationUpdated(row, false);
        } else if (event.kind === 'project') {
          const { id, name } = event.data as Project;
          projectUpdated({ id, name });
        } else if (event.kind === 'project-archive') projectUpdated(event.data as ProjectUpdate);
        else if (event.kind === 'defaults') defaultSettings.sync(event.data as SettingsProfile);
        else if (event.kind === 'runtime') setSystem(event.data as System);
      },
      connectionStatus,
      'projects',
      connectionFailure,
    );
    const focus = () => {
      if (notifyInBackground || document.visibilityState === 'visible') void stream.connect();
      else stream.suspend();
    };
    focus();
    if (!notifyInBackground) document.addEventListener('visibilitychange', focus);
    window.addEventListener('online', focus);
    return () => {
      stream.close();
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('online', focus);
    };
  }, [projectId, threadId, auth, retry, notifyInBackground, notifications]);
  const select = useCallback(
    (id: string, owner = projectRef.current, restore = false) => {
      const changed = id !== threadRef.current || owner !== projectRef.current;
      setThread((current) =>
        current?.id === id && current.projectId === owner ? current : undefined,
      );
      recentProject.current = restore && id ? owner : undefined;
      setSelection({ projectId: owner, threadId: id });
      if (!id) remember(owner, '');
      if (changed) {
        setContext(undefined);
        setFilePath(undefined);
        setDirectory('');
        setAttachments([]);
      }
      setConnectionError('');
      returnToLatest();
      setDiffTurn('');
      setDiffPath('');
      if (changed) setPanel(null);
      if (window.innerWidth <= 1099) setSidebar(false);
      follow.current = true;
    },
    [returnToLatest],
  );
  useEffect(() => {
    if (auth !== 'ready') return;
    queueRevision.current++;
    if (
      save('codes.thread', threadId) &&
      linkedConversation(location.search) === threadId &&
      threadId
    ) {
      const url = new URL(location.href);
      url.searchParams.delete('conversation');
      window.history.replaceState(window.history.state, '', url);
    }
    const key = draftKey(projectId, threadId);
    // Move the legacy unscoped new draft into the selected project once.
    const restored = saved(key) || (!threadId ? saved('codes.draft.new') : '');
    if (!threadId && restored && !saved(key)) {
      save(key, restored);
      if (saved(key) === restored) save('codes.draft.new', '');
    }
    draftValue.current = restored.slice(0, 50_000);
    setDraft(draftValue.current);
    setReceipt(threadId ? saved(`codes.operation.${threadId}`) : '');
    try {
      const stored = saved('codes.queue-request.' + threadId);
      setQueueRequest(stored ? JSON.parse(stored) : undefined);
    } catch {
      setQueueRequest(undefined);
    }
    setAttachments(branchContext.current?.id === threadId ? branchContext.current.attachments : []);
    branchContext.current = undefined;
    try {
      setSteerReceipt(JSON.parse(saved('codes.steer.' + threadId) || 'null') ?? undefined);
    } catch {
      setSteerReceipt(undefined);
    }
    if (!threadId || auth !== 'ready') {
      if (!projectId) setConnection('Ready');
      return;
    }
    const deltas = new Map<string, string>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      if (!deltas.size) return;
      const changes = new Map(deltas);
      deltas.clear();
      setThread(
        (t) =>
          t && {
            ...t,
            messages: t.messages.map((m) =>
              changes.has(m.id) ? { ...m, text: m.text + changes.get(m.id) } : m,
            ),
          },
      );
    };
    const event = (e: Envelope) => {
      if (e.kind === 'defaults') {
        defaultSettings.sync(e.data as SettingsProfile);
        return;
      }
      if (e.kind === 'settings' && e.threadId === threadId)
        conversationSettings.sync(e.data as SettingsProfile);
      if (e.kind === 'runtime') {
        setSystem(e.data as System);
        return;
      }
      if (e.kind === 'summary') {
        const row = e.data as Summary;
        if (notifyInBackground)
          notifications.observe(
            row,
            true,
            interfaceLanguages[latestPreferences.current.language].t,
          );
        conversationUpdated(row, false);
        return;
      }
      if (e.kind === 'project') {
        const { id, name } = e.data as Project;
        projectUpdated({ id, name });
        return;
      }
      if (e.kind === 'project-archive') {
        projectUpdated(e.data as ProjectUpdate);
        return;
      }
      if (e.threadId !== threadId) return;
      if (e.kind === 'text') {
        const d = e.data as { id: string; delta: string };
        deltas.set(d.id, (deltas.get(d.id) ?? '') + d.delta);
        flushTimer ??= setTimeout(flush, streamBatchMs);
        return;
      }
      flush();
      if (e.kind === 'queue') queueRevision.current++;
      if (
        e.kind === 'state' &&
        Object.hasOwn(e.data as object, 'pending') &&
        !(e.data as Partial<Thread>).pending
      ) {
        save(`codes.operation.${threadId}`, '');
        setReceipt('');
      }
      setThread((t) => {
        if (!t) return t;
        if (e.kind === 'item') {
          const item = e.data as Message;
          return {
            ...t,
            messages: (t.messages.some((m) => m.id === item.id)
              ? t.messages.map((m) => (m.id === item.id ? item : m))
              : [...t.messages, item]
            ).slice(-historyLimit),
          };
        }
        if (e.kind === 'state') {
          const data = e.data as Partial<Thread>;
          return { ...t, ...data };
        }
        if (e.kind === 'actions') return { ...t, actions: e.data as Action[] };
        if (e.kind === 'queue') return { ...t, queue: e.data as QueueState };
        if (e.kind === 'diff') return { ...t, diff: String(e.data) };
        return t;
      });
    };
    const stream = new Feed(
      threadId,
      (snapshot) => {
        if (threadRef.current !== threadId) return;
        if (recentProject.current && snapshot.thread.projectId !== recentProject.current) {
          remember(recentProject.current, '');
          recentProject.current = undefined;
          setSelection((current) => ({ ...current, threadId: '' }));
          setThread(undefined);
          setContext(undefined);
          setError('The saved conversation belongs to another project. Choose a conversation.');
          return;
        }
        recentProject.current = undefined;
        if (snapshot.thread.projectId !== projectId)
          setSelection({ projectId: snapshot.thread.projectId, threadId });
        if (snapshot.context) {
          setContext(snapshot.context);
          if (!snapshot.context.directory.available) setFilePath(undefined);
        }
        remember(snapshot.thread.projectId, snapshot.thread.id);
        deltas.clear();
        queueRevision.current++;
        setThread({ ...snapshot.thread, messages: snapshot.thread.messages.slice(-historyLimit) });
        // Project summaries may arrive while subscriptions switch. The selected
        // snapshot is also the authoritative summary for the navigation list.
        if (notifyInBackground) notifications.observe(snapshot.thread, false);
        conversationUpdated(snapshot.thread);
        conversationSettings.sync(snapshot.thread.composerSettings);
        void defaultSettings.refresh();
      },
      event,
      connectionStatus,
      'threads',
      connectionFailure,
    );
    feed.current = stream;
    const focus = () => {
      if (notifyInBackground || document.visibilityState === 'visible') void stream.connect();
      else stream.suspend();
    };
    focus();
    if (!notifyInBackground) document.addEventListener('visibilitychange', focus);
    window.addEventListener('online', focus);
    return () => {
      stream.close();
      clearTimeout(flushTimer);
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('online', focus);
    };
  }, [threadId, projectId, retry, auth, notifyInBackground, notifications]);
  useEffect(() => {
    if (
      auth !== 'ready' ||
      connection !== 'Connected' ||
      !receipt ||
      !thread ||
      thread.id !== threadId ||
      thread.pending
    )
      return;
    const controller = new AbortController();
    const id = threadId,
      operationId = receipt;
    void request<Operation>('/operations/' + operationId, {}, controller.signal)
      .then((operation) => {
        if (
          controller.signal.aborted ||
          threadRef.current !== id ||
          operation.threadId !== id ||
          !['completed', 'failed'].includes(operation.state)
        )
          return;
        if (saved('codes.operation.' + id) === operationId) save('codes.operation.' + id, '');
        setReceipt((current) => (current === operationId ? '' : current));
      })
      .catch((error) => {
        if (controller.signal.aborted || (error instanceof ApiError && error.code === 'NOT_FOUND'))
          return;
        connectionFailure(error);
      });
    return () => controller.abort();
  }, [auth, connection, receipt, threadId, thread?.id, thread?.pending?.id, thread?.state]);
  useLayoutEffect(() => {
    const element = composer.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = Math.min(180, Math.max(66, element.scrollHeight)) + 'px';
  }, [draft, auth]);
  useLayoutEffect(() => {
    const anchor = historyAnchor.current;
    const element = transcript.current;
    if (anchor && element) {
      restoringScroll.current = true;
      if (anchor.threadId === threadId) {
        const turn = [...element.querySelectorAll<HTMLElement>('.turn')].find(
          (item) => item.dataset.turnId === anchor.turnId,
        );
        if (turn)
          element.scrollTop +=
            turn.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset;
        else element.scrollTop = 0;
      }
      scrollPosition.current = element.scrollTop;
      requestAnimationFrame(() => {
        restoringScroll.current = false;
        setAnchorRevision((value) => value + 1);
      });
      historyAnchor.current = undefined;
    }
  }, [visibleMessages, threadId]);
  useEffect(() => {
    const element = transcript.current;
    if (!timelineLatest || !element) return;
    const current = thread?.id === threadId ? threadId : undefined;
    const opened = current !== positionedConversation.current;
    positionedConversation.current = current;
    if (follow.current && (preferences.autoScroll || opened)) {
      element.scrollTop = element.scrollHeight;
    } else if (!preferences.autoScroll) {
      setAtLatest(element.scrollHeight - element.scrollTop - element.clientHeight < 100);
    }
  }, [
    visibleMessages,
    thread?.actions,
    thread?.state,
    thread?.id,
    threadId,
    timelineLatest,
    preferences.autoScroll,
  ]);
  const changeDraft = useCallback(
    (value: string) => {
      draftRevision.current++;
      draftValue.current = value;
      setDraft(value);
      save(draftKey(projectId, threadId), value.slice(0, 50_000));
    },
    [projectId, threadId],
  );
  const reply = useCallback(
    (item: Message) => {
      const selected = window.getSelection();
      const article = selected?.anchorNode?.parentElement?.closest('[data-message-id]');
      const excerpt =
        (article?.getAttribute('data-message-id') === item.id
          ? selected?.toString()
          : undefined
        )?.trim() || item.text;
      const quote =
        'Regarding this ' +
        (item.kind === 'assistant' ? 'Codex reply' : 'earlier message') +
        ':\n' +
        excerpt
          .slice(0, 4000)
          .split('\n')
          .map((line) => '> ' + line)
          .join('\n') +
        '\n\n';
      if (quote.length + draftValue.current.length > 50_000) {
        setError('Shorten the current draft before adding this quote.');
        return;
      }
      changeDraft(quote + draftValue.current);
      composer.current?.focus();
    },
    [changeDraft],
  );
  const clearAcceptedDraft = (id: string, version: number, origin = id) => {
    // A network acknowledgement belongs to the captured draft, not whatever the
    // user has typed since dispatch. Preserve the next draft and its attachments.
    if (version !== draftRevision.current) return;
    save('codes.draft.' + id, '');
    if (!origin) save(draftKey(projectId, ''), '');
    if (threadRef.current === id || threadRef.current === origin) {
      draftValue.current = '';
      setDraft('');
      setAttachments([]);
    }
  };
  const enqueue = async () => {
    if (
      !threadId ||
      busy ||
      localAttachments.pending ||
      settingsBlocked ||
      !!thread?.writerConflict ||
      !hasInput ||
      thread?.archived ||
      thread?.managementPending
    )
      return;
    setBusy(true);
    setError('');
    const version = draftRevision.current;
    const key = 'codes.queue-request.' + threadId;
    let payload = { text: draft, settings, attachments };
    let operationId = crypto.randomUUID();
    try {
      const previous = queueRequest ?? (saved(key) ? JSON.parse(saved(key)) : undefined);
      if (previous) {
        const record = previous;
        if (!sameQueueDraft(record.payload, payload))
          throw new Error('Check the pending queue receipt before changing this draft.');
        operationId = record.operationId;
        payload = record.payload;
      }
      save(key, JSON.stringify({ operationId, payload }));
      setQueueRequest({ operationId, payload });
      const before = queueRevision.current;
      const queue = await post<QueueState>('/threads/' + threadId + '/queue', {
        operationId,
        ...payload,
      });
      setThread((current) =>
        current?.id === threadId && before === queueRevision.current
          ? { ...current, queue }
          : current,
      );
      save(key, '');
      setQueueRequest(undefined);
      clearAcceptedDraft(threadId, version);
    } catch (error) {
      notice(error);
      if (error instanceof ApiError && !error.uncertain) {
        save(key, '');
        setQueueRequest(undefined);
      }
    } finally {
      setBusy(false);
    }
  };
  const checkQueueReceipt = async () => {
    if (!queueRequest || !threadId) return;
    setBusy(true);
    setError('');
    try {
      await request('/threads/' + threadId + '/queue/' + queueRequest.operationId);
      const before = queueRevision.current;
      const queue = await request<QueueState>('/threads/' + threadId + '/queue');
      if (sameQueueDraft({ text: draft, settings, attachments }, queueRequest.payload)) {
        save('codes.draft.' + threadId, '');
        setDraft('');
        setAttachments([]);
      }
      save('codes.queue-request.' + threadId, '');
      setQueueRequest(undefined);
      setThread((current) =>
        current?.id === threadId && before === queueRevision.current
          ? { ...current, queue }
          : current,
      );
    } catch (error) {
      notice(error);
    } finally {
      setBusy(false);
    }
  };
  const fork = async () => {
    if (!forking || !threadId || forkBusy) return;
    setForkBusy(true);
    setForkError('');
    const source = threadId;
    const key = 'codes.fork.' + source + '.' + forking.turnId;
    const operationId = forkOperations.current.get(key) || saved(key) || crypto.randomUUID();
    forkOperations.current.set(key, operationId);
    save(key, operationId);
    try {
      const created = await post<Summary>('/threads/' + source + '/fork', {
        operationId,
        lastTurnId: forking.turnId,
      });
      save(key, '');
      forkOperations.current.delete(key);
      conversationUpdated(created);
      if (recoveryFork) {
        save('codes.draft.' + created.id, draftValue.current);
        branchContext.current = { id: created.id, attachments };
      }
      setForking(undefined);
      setRecoveryFork(false);
      setError('');
      select(created.id);
    } catch (error) {
      setForkError(message(error));
      if (error instanceof ApiError && !error.uncertain && error.code !== 'FORK_UNKNOWN') {
        save(key, '');
        forkOperations.current.delete(key);
      }
    } finally {
      setForkBusy(false);
    }
  };
  const recoverBranch = async () => {
    if (!threadId || busy) return;
    setBusy(true);
    try {
      const point = await request<{ lastTurnId: string }>('/threads/' + threadId + '/branch-point');
      setRecoveryFork(true);
      setForking({ id: 'recovery-branch', turnId: point.lastTurnId, kind: 'assistant', text: '' });
      setForkError('');
    } catch (error) {
      notice(error);
    } finally {
      setBusy(false);
    }
  };
  const checkWriter = async () => {
    if (!threadId || busy) return;
    setBusy(true);
    try {
      const updated = await post<Thread>('/threads/' + threadId + '/retry-writer');
      setThread(updated);
      setError('');
    } catch (error) {
      notice(error);
    } finally {
      setBusy(false);
    }
  };
  const newThreadIn = useCallback(
    (owner: string) => {
      select('', owner);
      requestAnimationFrame(() => composer.current?.focus());
      save('codes.new-settings.' + owner, '');
      setNewSettings(defaultSettings.saved?.settings ?? { permission: 'read-only' });
      setError('');
    },
    [select, defaultSettings.saved],
  );
  const newThread = () => newThreadIn(projectId);
  const verifiedProject = thread?.projectId;
  const changeProject = useCallback(
    (id: string) => {
      if (!threadId || verifiedProject === projectId) remember(projectId, threadId);
      select(views.current[id] || '', id, true);
      setPanel(null);
      setError('');
    },
    [projectId, select, threadId, verifiedProject],
  );
  const send = async () => {
    if (draft.trimStart().startsWith('/')) {
      runCommand(draft.trim());
      return;
    }
    if (
      busy ||
      localAttachments.pending ||
      settingsBlocked ||
      !!thread?.writerConflict ||
      queueRequest ||
      !hasInput ||
      !contextReady ||
      directoryBlocked ||
      loadingConversation ||
      connection !== 'Connected' ||
      thread?.archived ||
      thread?.managementPending
    )
      return;
    returnToLatest();
    setBusy(true);
    setError('');
    let id = threadId;
    const origin = threadId;
    const version = draftRevision.current;
    let operationId = '';
    try {
      if (!id) {
        const created = await post<Thread>(`/projects/${projectId}/threads`, settings);
        id = created.id;
        save('codes.new-settings.' + projectId, '');
        save(`codes.draft.${id}`, threadRef.current === origin ? draftValue.current : draft);
        conversationUpdated(created);
        select(id);
        setThread(created);
      }
      operationId = crypto.randomUUID();
      save(`codes.operation.${id}`, operationId);
      setReceipt(operationId);
      const operation = await post<Operation>(`/threads/${id}/send`, {
        operationId,
        text: draft,
        settings,
        attachments,
      });
      if (operation.state === 'failed')
        throw new ApiError(operation.error ?? 'The operation failed.', 'OPERATION_FAILED');
      clearAcceptedDraft(id, version, origin);
      follow.current = true;
      if (operation.state === 'completed') {
        save(`codes.operation.${id}`, '');
        setReceipt('');
      }
      if (feed.current && threadId === id) void feed.current.connect();
    } catch (e) {
      notice(e);
      if (
        version === draftRevision.current &&
        (threadRef.current === id || threadRef.current === origin)
      )
        setAttachments(attachments);
      if (id && e instanceof ApiError && !e.uncertain) {
        save(`codes.operation.${id}`, '');
        setReceipt('');
      }
    } finally {
      setBusy(false);
    }
  };
  const reconcile = async () => {
    const id = threadId;
    const operationId = receipt;
    if (!id) return;
    setBusy(true);
    try {
      if (operationId) {
        try {
          await request<Operation>(`/operations/${operationId}`);
        } catch (error) {
          if (error instanceof ApiError && error.code === 'NOT_FOUND') {
            if (saved(`codes.operation.${id}`) === operationId) save(`codes.operation.${id}`, '');
            if (threadRef.current === id) {
              setReceipt((current) => (current === operationId ? '' : current));
              setError('This request was not recorded. Your draft is safe; you may send it again.');
              void feed.current?.connect();
            }
            return;
          }
          throw error;
        }
      }
      const updated = await post<Thread>(`/threads/${id}/reconcile`);
      if (updated.id !== id)
        throw new ApiError(
          'The service returned a result for a different conversation.',
          'INVALID_RESPONSE',
        );
      if (!updated.pending && saved(`codes.operation.${id}`) === operationId)
        save(`codes.operation.${id}`, '');
      // A slow check belongs to its original conversation, not a newer selection.
      if (threadRef.current !== id) return;
      setThread(updated);
      void feed.current?.connect();
      if (!updated.pending) setReceipt((current) => (current === operationId ? '' : current));
      else
        setError(
          'The CLI has not confirmed a terminal result. This conversation remains locked against duplicate sends.',
        );
    } catch (error) {
      if (threadRef.current === id) notice(error);
    } finally {
      setBusy(false);
    }
  };

  const submitAction = async (
    action: Action,
    resolution: { decision?: string; answers?: Record<string, string> },
  ) => {
    await post(`/actions/${action.id}`, { operationId: crypto.randomUUID(), ...resolution });
  };
  const projectAdded = (project: Project) => {
    projectMetadataRevision.current++;
    setProjects((list) => (list.some((x) => x.id === project.id) ? list : [...list, project]));
    if (project.id !== projectRef.current) changeProject(project.id);
    setAdding(false);
  };
  const browseDirectory = useCallback((path: string) => {
    setDirectory(path);
    setFilePath(undefined);
  }, []);
  const attachProjectFile = useCallback(
    (file: FileContent, fromLine: number, toLine: number) => {
      if (attachmentBlocked) return;
      draftRevision.current++;
      setAttachments((list) => [
        ...list.filter((entry) => !('path' in entry) || entry.path !== file.path),
        { path: file.path, sha: file.sha, fromLine, toLine },
      ]);
      if (narrow) setPanel(null);
      requestAnimationFrame(() => composer.current?.focus());
    },
    [attachmentBlocked, narrow],
  );
  const loadingConversation = !!threadId && (!thread || thread.id !== threadId);
  const active =
    !!thread?.pending ||
    !!thread?.steering?.length ||
    (!!thread &&
      !thread.writerConflict &&
      ['running', 'waitingApproval', 'waitingInput', 'unknown'].includes(thread.state));
  const outcome = isTurnOutcome(thread?.state) ? thread.state : undefined;
  const finishedTurn = outcome
    ? thread?.turns?.findLast((turn) => turn.id === thread.turnId && turn.status === outcome)
    : undefined;
  const taskResult = outcome ? { status: outcome, turn: finishedTurn } : undefined;
  const project =
    projects.find((x) => x.id === contextProjectId) ??
    (context?.project.id === contextProjectId ? context.project : undefined);
  const reviewMessage = useCallback(
    (item: Message, path?: string) => {
      setDiffTurn(item.turnId === thread?.turnId ? '' : item.turnId);
      setDiffPath(
        path?.startsWith((project?.path ?? '') + '/')
          ? path.slice(project!.path.length + 1)
          : (path ?? ''),
      );
      setPanel('diff');
    },
    [thread?.turnId, project?.path],
  );
  const branchMessage = useCallback((item: Message) => {
    setRecoveryFork(false);
    setForking(item);
    setForkError('');
  }, []);
  const activeTurnIds = useMemo(
    () =>
      thread && ['running', 'waitingApproval', 'waitingInput', 'unknown'].includes(thread.state)
        ? [thread.turnId ?? '', thread.pending?.turnId ?? '']
        : [],
    [thread?.state, thread?.turnId, thread?.pending?.turnId],
  );
  const assistantTail = useMemo(() => {
    const tails = new Map<string, string>();
    for (const item of thread?.messages ?? [])
      if (item.kind === 'assistant') tails.set(item.turnId, item.id);
    return tails;
  }, [thread?.messages]);
  const changeTurns = [
    ...new Set(reviewMessages.filter((item) => item.kind === 'change').map((item) => item.turnId)),
  ].reverse();
  const selectedDiffTurn = diffTurn || thread?.turnId;
  const changeFiles = new Map<string, FileChange>();
  for (const message of reviewMessages)
    if (message.kind === 'change' && message.turnId === selectedDiffTurn)
      for (const file of message.files ?? [])
        changeFiles.set(message.id + ':' + (file.movePath ?? file.path), file);
  const diffPatch = selectedDiffTurn === thread?.turnId ? thread?.diff : undefined;
  const changeTruncated = reviewMessages.some(
    (item) => item.kind === 'change' && item.turnId === selectedDiffTurn && item.truncated,
  );
  const unresolvedQuestions =
    thread?.actions.filter(
      (action) => action.kind === 'questions' && ['pending', 'responding'].includes(action.status),
    ) ?? [];
  const inlineQuestions = new Map(
    thread?.actions
      .filter((action) => action.kind === 'questions')
      .map((action) => [action.id, action]),
  );
  const visibleTurnIds = new Set(visibleMessages.map((item) => item.turnId));
  const transcriptMessages = [...visibleMessages];
  for (const action of [...inlineQuestions.values()].reverse()) {
    // A resolved question belongs to its history page. Open requests must remain reachable.
    if (
      !visibleTurnIds.has(action.turnId) &&
      (!timelineLatest || action.status === 'answered' || action.status === 'expired')
    )
      continue;
    const last = transcriptMessages.findLastIndex((item) => item.turnId === action.turnId);
    const anchor = transcriptMessages.findLastIndex(
      (item) => item.id === action.afterMessageId && item.turnId === action.turnId,
    );
    const at = anchor >= 0 ? anchor : last;
    transcriptMessages.splice(at < 0 ? transcriptMessages.length : at + 1, 0, {
      id: action.id,
      kind: 'question',
      turnId: action.turnId,
      text: '',
    });
  }
  const openChangedFile = (path: string) => {
    if (!contextReady || directoryBlocked) return;
    const prefix = project?.path?.replace(/\/?$/, '/');
    const relative = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
    setDirectory(relative.split('/').slice(0, -1).join('/'));
    setFilePath(relative);
    setPanel('files');
  };
  const canSteer =
    !!thread?.turnId &&
    thread.state === 'running' &&
    thread.pending?.state !== 'unknown' &&
    thread.pending?.kind !== 'review' &&
    !thread.archived &&
    !thread.managementPending;
  const deliveryMode =
    active && preferences.followUp === 'steer' && thread && sameSettings(settings, thread.settings)
      ? 'steer'
      : 'queue';
  const deliveryBlocked =
    connection !== 'Connected' ||
    busy ||
    settingsBlocked ||
    !!system?.maintenance ||
    !!thread?.writerConflict ||
    !!localAttachments.pending ||
    !!steerReceipt ||
    !!queueRequest ||
    !hasInput ||
    !contextReady ||
    directoryBlocked ||
    loadingConversation ||
    !!thread?.archived ||
    !!thread?.managementPending;
  const queueBlocked = deliveryBlocked || (thread?.queue?.items.length ?? 0) >= 10;
  const addBlocked = deliveryBlocked || !canSteer || !sameSettings(settings, thread!.settings);
  const deliveryHelp =
    active || !!thread?.queue?.items.length
      ? deliveryMode === 'queue'
        ? (thread?.queue?.items.length ?? 0) >= 10
          ? t(
              'Queue is full (10 messages). Edit or remove a waiting entry, or use Add now if available.',
            )
          : active
            ? t('Queue runs after this task completes. Waiting text can be edited or removed.') +
              (!canSteer
                ? ' ' + t('Add now waits until the pending request or result is resolved.')
                : !sameSettings(settings, thread!.settings)
                  ? ' ' + t('Queue to use the updated conversation settings.')
                  : '')
            : t(
                'Queue joins the waiting list. Waiting text stays editable; resume a paused queue to continue.',
              )
        : canSteer
          ? t(
              'Add now updates this running task using its current settings. Accepted additions cannot be edited.',
            )
          : t(
              'Add now is unavailable while awaiting approval, input, or confirmation. Queue a message for later.',
            )
      : t('Send starts a new turn. Edit this draft before sending; sent history stays unchanged.');
  const shortcut =
    window.innerWidth <= 700 ||
    preferences.enter === 'cmdAlways' ||
    (preferences.enter === 'cmdIfMultiline' && draft.includes('\n'))
      ? 'Ctrl/Cmd+Enter'
      : 'Enter';
  const followUpHint =
    deliveryMode === 'steer'
      ? 'Add to current task'
      : !active || thread?.queue?.paused
        ? t('Add to waiting queue')
        : 'Queue for next turn';
  const commands = [
    {
      name: '/model',
      detail: 'Choose a model',
      run: () => composerControls.current?.openModel(),
    },
    {
      name: '/reasoning',
      detail: 'Set reasoning effort',
      run: () => composerControls.current?.openReasoning(),
    },
    {
      name: '/plan',
      detail: 'Toggle Plan and Code mode',
      run: () => {
        changeSettings({ ...settings, mode: settings.mode === 'plan' ? 'default' : 'plan' });
      },
    },
    { name: '/review', detail: 'Start a native code review', run: () => setDialog('review') },
    { name: '/status', detail: 'Connection, model and usage', run: () => setDialog('status') },
    {
      name: '/approve',
      detail: 'Choose task permissions',
      run: () => composerControls.current?.openPermissions(),
    },
    {
      name: '/ide-context',
      detail: 'Attach context from Web file browsing',
      run: () => setPanel('files'),
    },
    {
      name: '/fork',
      detail: 'Branch from the latest displayed completed reply',
      run: () => {
        const last = thread?.messages.findLast(
          (entry) => entry.kind === 'assistant' && (!active || entry.turnId !== thread.turnId),
        );
        if (!last) throw new Error('No completed reply is available to branch from.');
        setRecoveryFork(false);
        setForking(last);
        setForkError('');
      },
    },
  ];
  const runCommand = (input: string) => {
    const [name, ...rest] = input.split(/\s+/);
    const command = commands.find((entry) => entry.name === name);
    if (!command) {
      setError('Unknown command. Choose one of the supported commands below.');
      return;
    }
    try {
      command.run();
      changeDraft(rest.join(' '));
    } catch (error) {
      notice(error);
    }
  };
  const steer = async () => {
    if (addBlocked || !hasInput || steerReceipt || queueRequest) return;
    if (draft.trimStart().startsWith('/')) {
      runCommand(draft.trim());
      return;
    }
    const id = threadId;
    const text = draft;
    const version = draftRevision.current;
    const record = { operationId: crypto.randomUUID(), text, attachments };
    setBusy(true);
    setError('');
    save('codes.steer.' + id, JSON.stringify(record));
    setSteerReceipt(record);
    try {
      const result = await post<Operation>('/threads/' + id + '/steer', {
        operationId: record.operationId,
        text,
        expectedTurnId: thread!.turnId,
        attachments,
      });
      if (result.state === 'unknown' || result.state === 'failed')
        throw new Error(result.error || 'Check the follow-up result.');
      save('codes.steer.' + id, '');
      clearAcceptedDraft(id, version);
      if (threadRef.current === id) setSteerReceipt(undefined);
    } catch (error) {
      notice(error);
      if (error instanceof ApiError && !error.uncertain) {
        save('codes.steer.' + id, '');
        if (threadRef.current === id) setSteerReceipt(undefined);
      }
    } finally {
      setBusy(false);
    }
  };
  const checkSteer = async () => {
    if (!steerReceipt || busy) return;
    const id = threadId;
    const record = steerReceipt;
    const key = 'codes.steer.' + id;
    const version = draftRevision.current;
    const readReceipt = async () => {
      const result = await request<Operation>('/operations/' + record.operationId);
      if (result.id !== record.operationId || result.threadId !== id || result.kind !== 'steer')
        throw new ApiError(
          'The service returned a result for a different conversation.',
          'INVALID_RESPONSE',
        );
      return result;
    };
    let recorded = false;
    setBusy(true);
    setError('');
    try {
      let result = await readReceipt();
      recorded = true;
      if (result.state === 'unknown' || result.state === 'dispatching') {
        await post<Thread>('/threads/' + id + '/reconcile');
        result = await readReceipt();
        if (result.state === 'unknown' || result.state === 'dispatching')
          throw new Error('Follow-up acceptance is still unconfirmed. It will not be resent.');
      }
      save(key, '');
      if (threadRef.current !== id) return;
      if (
        result.state !== 'failed' &&
        draft === record.text &&
        JSON.stringify(attachments) === JSON.stringify(record.attachments ?? [])
      )
        clearAcceptedDraft(id, version);
      setSteerReceipt(undefined);
      if (result.state === 'failed')
        setError(result.error || 'The follow-up was rejected. Your draft is safe.');
    } catch (error) {
      if (!recorded && error instanceof ApiError && error.code === 'NOT_FOUND') {
        save(key, '');
        if (threadRef.current === id) {
          setSteerReceipt(undefined);
          setError('The follow-up was not recorded. Your draft is safe.');
        }
      } else if (threadRef.current === id) notice(error);
    } finally {
      setBusy(false);
    }
  };
  const checkFollowUpStatus = async () => {
    if (!threadId || busy) return;
    const id = threadId;
    const previous = thread?.steering;
    setBusy(true);
    setError('');
    try {
      const updated = await post<Thread>('/threads/' + id + '/reconcile');
      if (updated.id !== id)
        throw new ApiError(
          'The service returned a result for a different conversation.',
          'INVALID_RESPONSE',
        );
      // A status check can finish after a newer event. Only refresh receipts it observed.
      setThread((current) =>
        current?.id === id && current.steering === previous
          ? { ...current, steering: updated.steering }
          : current,
      );
      if (threadRef.current === id && connection !== 'Connected') void feed.current?.connect();
    } catch (error) {
      if (threadRef.current === id) notice(error);
    } finally {
      setBusy(false);
    }
  };
  const followUp = (reverse = false) => {
    if (draft.trimStart().startsWith('/')) {
      runCommand(draft.trim());
      return;
    }
    const behavior = reverse
      ? preferences.followUp === 'queue'
        ? 'steer'
        : 'queue'
      : preferences.followUp;
    if (active && behavior === 'steer') void steer();
    else void enqueue();
  };
  const startReview = async (target: ReviewTarget, delivery: Preferences['review']) => {
    if (!projectId || busy) throw new Error('Choose a project and wait for the current request.');
    let id = threadId;
    setBusy(true);
    try {
      if (delivery === 'detached' || !id) {
        const created = await post<Thread>(`/projects/${projectId}/threads`, {
          ...settings,
          mode: 'default',
          permission: 'read-only',
        });
        id = created.id;
        conversationUpdated(created);
        select(id);
        setThread(created);
      }
      const operationId = crypto.randomUUID();
      save('codes.operation.' + id, operationId);
      setReceipt(operationId);
      try {
        const operation = await post<Operation>('/threads/' + id + '/review', {
          operationId,
          target,
          settings,
        });
        if (operation.state === 'failed')
          throw new ApiError(operation.error || 'Review failed.', 'OPERATION_FAILED');
        if (operation.state === 'completed') {
          save('codes.operation.' + id, '');
          setReceipt('');
        }
        if (threadId === id) void feed.current?.connect();
      } catch (error) {
        if (error instanceof ApiError && !error.uncertain) {
          save('codes.operation.' + id, '');
          setReceipt('');
          throw error;
        }
        notice(error); // Keep the receipt and close the dialog after an uncertain result.
      }
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (auth !== 'ready') return;
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'n' &&
        !event.shiftKey &&
        !event.altKey &&
        !document.querySelector(
          '[role="dialog"][aria-modal="true"],details[open] [role="dialog"]',
        ) &&
        !busy
      ) {
        event.preventDefault();
        newThread();
        composer.current?.focus();
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [auth, busy, settings]);
  const loadHistory = async (direction: HistoryDirection = 'older', automatic = false) => {
    const cursor =
      direction === 'older'
        ? history
          ? history.olderCursor
          : thread?.olderCursor
        : history?.newerCursor;
    const key = direction + ':' + cursor;
    if (
      !thread ||
      !cursor ||
      historyRead.current ||
      (automatic &&
        (historyError || automaticHistory.current.has(key) || automaticHistory.current.size >= 32))
    )
      return;
    if (automatic) automaticHistory.current.add(key);
    else {
      automaticHistory.current.clear();
      scrollDirection.current = undefined;
    }
    const id = thread.id;
    const project = projectId;
    const controller = new AbortController();
    historyRead.current = controller;
    setLoadingHistory(true);
    try {
      const page = await request<HistoryPage>(
        `/threads/${id}/history?cursor=${encodeURIComponent(cursor)}`,
        {},
        controller.signal,
      );
      if (controller.signal.aborted || threadRef.current !== id || projectRef.current !== project)
        return;
      follow.current = false;
      setAtLatest(false);
      const element = transcript.current;
      if (element) {
        const top = element.getBoundingClientRect().top;
        const turn = [...element.querySelectorAll<HTMLElement>('.turn')].find(
          (item) => item.getBoundingClientRect().bottom > top,
        );
        historyAnchor.current = {
          threadId: id,
          turnId: turn?.dataset.turnId,
          offset: turn ? turn.getBoundingClientRect().top - top : 0,
        };
      }
      setHistoryError(undefined);
      setHistoryWindow((current) => earlierWindow(thread, current, page, direction));
    } catch (error) {
      if (!controller.signal.aborted) {
        setHistoryError({ direction, message: message(error) });
        if (error instanceof ApiError && error.status === 401) notice(error);
      }
    } finally {
      if (historyRead.current === controller) {
        historyRead.current = undefined;
        setLoadingHistory(false);
      }
    }
  };
  useEffect(() => {
    if (loadingHistory || historyError || !scrollDirection.current || restoringScroll.current)
      return;
    const element = transcript.current;
    const direction = scrollDirection.current;
    if (
      element &&
      (direction === 'older'
        ? element.scrollTop < 240
        : !timelineLatest && element.scrollHeight - element.scrollTop - element.clientHeight < 240)
    )
      void loadHistory(direction, true);
  }, [
    loadingHistory,
    history?.olderCursor,
    history?.newerCursor,
    timelineLatest,
    historyError,
    anchorRevision,
  ]);

  const modalOpen = adding || !!dialog || !!forking || conversationModalOpen;
  const conversationLoadError =
    connectionError ||
    (['Unavailable', 'Disconnected'].includes(connection) ? 'Connection lost.' : '');
  const withLanguage = (view: React.ReactNode) => (
    <InterfaceLanguageContext value={interfaceLanguage}>{view}</InterfaceLanguageContext>
  );
  if (auth !== 'ready')
    return withLanguage(
      <Login
        token={token}
        error={error}
        checking={auth === 'loading'}
        busy={busy}
        onTokenChange={setToken}
        onRetry={() => {
          setError('');
          void init();
        }}
        onSubmit={() => {
          setBusy(true);
          setError('');
          void post('/login', { token })
            .then(() => {
              setToken('');
              return init();
            })
            .catch((e) => setError(message(e)))
            .finally(() => setBusy(false));
        }}
      />,
    );
  return withLanguage(
    <div
      data-theme={theme}
      data-chat-font-size={preferences.chatFontSize}
      data-code-font-size={preferences.codeFontSize}
      style={
        {
          '--chat-font-size': preferences.chatFontSize
            ? `${preferences.chatFontSize}px`
            : undefined,
          '--code-font-size': preferences.codeFontSize
            ? `${preferences.codeFontSize}px`
            : undefined,
        } as React.CSSProperties
      }
      className={`app ${panel ? 'has-panel' : ''} ${sidebar ? 'history-open' : ''} ${panel === 'files' ? 'files-open' : ''}`}
    >
      {sidebar && <div className="scrim" onClick={closeNavigation} />}
      <aside
        ref={navigationElement}
        className={`sidebar ${sidebar ? 'open' : ''}`}
        aria-label={t('Workspace navigation')}
        inert={modalOpen || undefined}
        role={narrow && sidebar && !modalOpen ? 'dialog' : undefined}
        aria-modal={narrow && sidebar && !modalOpen ? true : undefined}
      >
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button"
            aria-label={t('Close navigation')}
            data-tooltip=""
            onClick={closeNavigation}
          >
            <Icon name="close" />
          </button>
        </div>
        <Conversations
          projects={projects}
          activeProjectId={projectId}
          selectedId={threadId}
          updates={threads}
          connection={connection}
          disabled={busy}
          sidebarPreferences={sidebarPreferences}
          onSidebarPreference={changeSidebarPreference}
          onRefreshProjects={refreshProjects}
          onAddProject={openAddProject}
          onProjectUpdated={projectUpdated}
          onProject={changeProject}
          onNew={newThreadIn}
          onSelect={select}
          onUpdated={conversationUpdated}
          onModalChange={setConversationModalOpen}
        />
        <div className="workspace-footer" role="group" aria-label={t('Workspace controls')}>
          <div className="workspace-connection">
            <span
              className={`connection ${['Connected', 'Ready'].includes(connection) ? 'connected' : ''}`}
              role="status"
              aria-label={t('Connection: {status}', { status: t(connection) })}
            >
              <i />
              {t(connection)}
            </span>
            {!['Connected', 'Ready'].includes(connection) && (
              <button
                className="icon-button"
                aria-label={t('Reconnect conversation updates')}
                data-tooltip=""
                onClick={() => setRetry((n) => n + 1)}
              >
                <Icon name="refresh" size={16} />
              </button>
            )}
          </div>
          <div className="workspace-actions">
            <button
              className="icon-button"
              aria-label={t('Interaction settings')}
              data-tooltip=""
              onClick={() => setDialog('preferences')}
            >
              <Icon name="settings" size={16} />
            </button>
            <PanelMenu
              label={t('Workspace actions')}
              className="workspace-menu"
              iconOnly
              trigger={<Icon name="more" size={16} />}
            >
              <button data-close-menu onClick={() => setRetry((n) => n + 1)}>
                <Icon name="refresh" size={14} />
                {t('Reconnect updates')}
              </button>
              <button
                data-close-menu
                onClick={() =>
                  void post('/logout')
                    .then(() => {
                      feed.current?.close();
                      setAuth('login');
                    })
                    .catch(notice)
                }
              >
                <Icon name="logout" size={14} />
                {t('Sign out')}
              </button>
            </PanelMenu>
          </div>
        </div>
      </aside>
      <main
        className="main"
        aria-label={t('Conversation workspace')}
        inert={modalOpen || (narrow && (sidebar || !!panel)) || undefined}
      >
        <WorkspaceHeader
          title={loadingConversation ? t('Conversation') : (thread?.title ?? t('New conversation'))}
          projectName={project?.name}
          sidebarOpen={sidebar}
          connection={connection}
          theme={theme}
          panel={panel}
          busy={busy}
          hasProject={contextReady && !directoryBlocked}
          onNavigation={() => setSidebar(true)}
          onNewConversation={newThread}
          onSettings={() => setDialog('preferences')}
          onToggleTheme={() =>
            changePreferences({ ...preferences, theme: theme === 'dark' ? 'light' : 'dark' })
          }
          onReview={() => setDialog('review')}
          onStatus={() => setDialog('status')}
          onPanel={(kind) => {
            if (kind === 'diff' || (contextReady && !directoryBlocked))
              setPanel(panel === kind ? null : kind);
          }}
          onDraft={changeDraft}
          showStarters={!loadingConversation && !thread?.messages.length && !active}
        />
        {system?.runtime === 'mock' && (
          <div className="simulation-strip">{t('Simulation · No model or command execution')}</div>
        )}
        {system?.maintenance && (
          <div className="conversation-lock-banner" role="status">
            <span>
              {system.maintenance.ready
                ? t('Maintenance ready. New tasks are paused.')
                : t('Maintenance pending. Existing tasks can finish.')}
            </span>
            <button disabled={maintenanceBusy} onClick={() => void changeMaintenance('cancel')}>
              {t('Cancel maintenance')}
            </button>
          </div>
        )}
        {directoryBlocked && (
          <div className="conversation-lock-banner directory-unavailable" role="alert">
            <span>{t(context.directory.message ?? '')}</span>
            <button
              disabled={busy}
              onClick={() => {
                setError('');
                setRetry((value) => value + 1);
              }}
            >
              {t('Retry directory')}
            </button>
          </div>
        )}
        {thread?.forkedFromId && (
          <div className="branch-origin">
            <Icon name="branch" size={14} />
            <span>{t('Conversation branch')}</span>
            <button
              onClick={() => {
                setBusy(true);
                void request<Summary>('/threads/' + thread.id + '/source')
                  .then((source) => {
                    conversationUpdated(source);
                    select(source.id);
                  })
                  .catch(notice)
                  .finally(() => setBusy(false));
              }}
              disabled={busy}
            >
              {t('Open source conversation')}
            </button>
          </div>
        )}
        {(thread?.archived || thread?.managementPending) && (
          <div className="conversation-lock-banner" role="status">
            <span>
              <Icon name="archive" size={14} />
              {thread.managementPending
                ? t('A conversation change needs confirmation. Check its status before sending.')
                : t('This conversation is archived. Restore it to continue.')}
            </span>
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void post<Summary>(
                  '/threads/' +
                    thread.id +
                    '/' +
                    (thread.managementPending ? 'management-status' : 'archive'),
                  thread.managementPending
                    ? {}
                    : { operationId: crypto.randomUUID(), archived: false },
                )
                  .then(conversationUpdated)
                  .catch(notice)
                  .finally(() => setBusy(false));
              }}
            >
              {thread.managementPending ? t('Check status') : t('Restore conversation')}
            </button>
          </div>
        )}
        <div
          className="conversation"
          ref={transcript}
          role="region"
          aria-label={t('Conversation timeline')}
          tabIndex={0}
          onPointerDown={(event) => {
            // Only a scrollbar drag begins scrolling. Clicking prose or a
            // disclosure must not turn programmatic focus scrolling into paging.
            if (
              event.target === event.currentTarget &&
              event.clientX >= event.currentTarget.getBoundingClientRect().right - 24
            ) {
              automaticHistory.current.clear();
              scrollDirection.current ??= 'older';
            }
          }}
          onTouchStart={(event) => {
            touchPosition.current = event.touches[0]?.clientY;
            automaticHistory.current.clear();
          }}
          onTouchMove={(event) => {
            const y = event.touches[0]?.clientY;
            if (
              y === undefined ||
              touchPosition.current === undefined ||
              y === touchPosition.current
            )
              return;
            const direction = y > touchPosition.current ? 'older' : 'newer';
            touchPosition.current = y;
            automaticHistory.current.clear();
            scrollDirection.current = direction;
            const element = event.currentTarget;
            const bottom = element.scrollHeight - element.scrollTop - element.clientHeight;
            if (direction === 'newer' && timelineLatest && bottom < 100) {
              follow.current = true;
              setAtLatest(true);
            }
            if (direction === 'older' ? element.scrollTop < 240 : !timelineLatest && bottom < 240)
              void loadHistory(direction, true);
          }}
          onKeyDown={(event) => {
            if (['ArrowUp', 'PageUp', 'Home', 'ArrowDown', 'PageDown', 'End'].includes(event.key)) {
              automaticHistory.current.clear();
              scrollDirection.current = ['ArrowUp', 'PageUp', 'Home'].includes(event.key)
                ? 'older'
                : 'newer';
            }
          }}
          onWheel={(event) => {
            if (!event.deltaY) return;
            automaticHistory.current.clear();
            const direction = event.deltaY < 0 ? 'older' : 'newer';
            scrollDirection.current = direction;
            const element = event.currentTarget;
            if (
              direction === 'newer' &&
              timelineLatest &&
              element.scrollHeight - element.scrollTop - element.clientHeight < 100
            ) {
              follow.current = true;
              setAtLatest(true);
            }
            if (
              direction === 'older'
                ? element.scrollTop < 240
                : !timelineLatest &&
                  element.scrollHeight - element.scrollTop - element.clientHeight < 240
            )
              void loadHistory(direction, true);
          }}
          onScroll={(e) => {
            const el = e.currentTarget;
            const delta = el.scrollTop - scrollPosition.current;
            scrollPosition.current = el.scrollTop;
            if (restoringScroll.current) return;
            const nearBottom =
              timelineLatest && el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            follow.current = nearBottom;
            setAtLatest(nearBottom);
            if (delta && scrollDirection.current) {
              const direction = delta < 0 ? 'older' : 'newer';
              scrollDirection.current = direction;
              if (
                direction === 'older'
                  ? el.scrollTop < 240
                  : !timelineLatest && el.scrollHeight - el.scrollTop - el.clientHeight < 240
              )
                void loadHistory(direction, true);
            }
          }}
        >
          <div className="conversation-inner">
            {loadingConversation ? (
              <section
                className="conversation-loading-state"
                role="status"
                aria-label={t('Conversation loading')}
              >
                <Icon name="history" size={24} />
                <h2>
                  {conversationLoadError
                    ? t('Unable to load conversation')
                    : t('Loading conversation…')}
                </h2>
                {conversationLoadError && <p role="alert">{t(conversationLoadError)}</p>}
                <button
                  onClick={() => {
                    setError('');
                    setRetry((value) => value + 1);
                  }}
                >
                  {t('Retry loading')}
                </button>
              </section>
            ) : !thread?.messages.length && !active ? (
              <section className="conversation-start" aria-label={t('New conversation')}>
                {!projectId && (
                  <button className="primary" onClick={openAddProject}>
                    <Icon name="folder-add" />
                    {t('Add project')}
                  </button>
                )}
              </section>
            ) : (
              <>
                {(history ? history.olderCursor : thread?.olderCursor) && (
                  <button
                    className="older"
                    disabled={busy || loadingHistory}
                    onClick={() => void loadHistory('older')}
                  >
                    {loadingHistory ? t('Loading earlier messages…') : t('Load earlier messages')}
                  </button>
                )}
                {historyError?.direction === 'older' && (
                  <div role="alert" className="history-load-error">
                    <span>{t(historyError.message)}</span>
                    <button onClick={() => void loadHistory('older')}>
                      {t('Retry loading earlier messages')}
                    </button>
                  </div>
                )}
                {thread && (
                  <Transcript
                    key={thread.id}
                    messages={transcriptMessages}
                    turns={visibleTurns}
                    activeIds={activeTurnIds}
                    result={taskResult}
                    render={(m, finalReply, changes, timestamp, completion) => {
                      if (m.kind === 'question') {
                        const action = inlineQuestions.get(m.id);
                        if (action && ['pending', 'responding'].includes(action.status))
                          return <Approval action={action} submit={submitAction} />;
                        return (
                          <section
                            className="approval"
                            aria-label={t('Codex question')}
                            data-testid="message-question"
                          >
                            <div className="approval-heading">
                              <strong>{t('Codex question')}</strong>
                              <span className="badge">
                                {action?.status === 'expired'
                                  ? t('Expired')
                                  : action?.skipped
                                    ? t('Skipped')
                                    : t('Answered')}
                              </span>
                            </div>
                            {m.answeredQuestions?.map(({ question, answer }, index) => (
                              <div key={index}>
                                <strong>{question}</strong>
                                <p>
                                  {t('Answer:') + ' '}
                                  {answer}
                                </p>
                              </div>
                            ))}
                            {action?.questions?.map((question) => (
                              <div key={question.id}>
                                <strong>{question.question}</strong>
                                {action.status === 'answered' &&
                                  action.submittedAnswers?.[question.id] && (
                                    <p>
                                      {t('Answer:') + ' '}
                                      {action.submittedAnswers[question.id]}
                                    </p>
                                  )}
                              </div>
                            ))}
                          </section>
                        );
                      }
                      return (
                        <MessageView
                          projectId={contextProjectId}
                          projectPath={project?.path}
                          key={m.id}
                          item={m}
                          actions={finalReply}
                          changes={changes}
                          timestamp={timestamp}
                          completion={completion}
                          onReview={reviewMessage}
                          onReply={thread.archived ? undefined : reply}
                          onFork={
                            !active || m.turnId !== thread.turnId
                              ? m.kind === 'assistant'
                                ? branchMessage
                                : undefined
                              : undefined
                          }
                          disabled={busy || forkBusy || thread.managementPending}
                          streaming={
                            m.kind === 'assistant' &&
                            m.id === assistantTail.get(m.turnId) &&
                            (m.turnId === thread.turnId ||
                              (thread.pending?.kind === 'review' &&
                                m.turnId === thread.pending.turnId)) &&
                            ['running', 'waitingApproval', 'waitingInput'].includes(thread.state)
                          }
                        />
                      );
                    }}
                  />
                )}
                {history && !timelineLatest && (
                  <div className="history-page-edge" role="status" aria-label={t('Newer messages')}>
                    {historyError?.direction === 'newer' ? (
                      <>
                        <span role="alert">{t(historyError.message)}</span>
                        <button onClick={() => void loadHistory('newer')}>
                          {t('Retry loading newer messages')}
                        </button>
                      </>
                    ) : (
                      <button disabled={loadingHistory} onClick={() => void loadHistory('newer')}>
                        {loadingHistory
                          ? t('Loading messages…')
                          : t('Continue scrolling for newer messages')}
                      </button>
                    )}
                  </div>
                )}
                {thread?.pending &&
                  !thread.messages.some((m) => m.clientId === thread.pending?.id) && (
                    <MessageView
                      projectId={contextProjectId}
                      item={{
                        id: thread.pending.id,
                        turnId: '',
                        kind: 'user',
                        text: messagePreviewText(thread.pending.text ?? ''),
                      }}
                      streaming={false}
                    />
                  )}
                {thread?.actions
                  .filter(
                    (a) =>
                      a.kind !== 'questions' &&
                      (a.status === 'pending' || a.status === 'responding'),
                  )
                  .map((action) => (
                    <Approval key={action.id} action={action} submit={submitAction} />
                  ))}
                {thread?.plan && (
                  <section className="turn-plan" aria-label={t('Task plan')}>
                    <strong>{t('Plan')}</strong>
                    {thread.plan.explanation && <p>{thread.plan.explanation}</p>}
                    <ol>
                      {thread.plan.steps.map((entry, index) => (
                        <li key={index}>
                          <small>
                            {entry.status === 'completed'
                              ? t('Done')
                              : entry.status === 'inProgress'
                                ? t('In progress')
                                : t('Pending')}
                          </small>
                          {entry.step}
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
        <div className="composer-area">
          {thread && !loadingConversation && !atLatest && (
            <div
              className="history-navigation"
              role="status"
              aria-label={t('Conversation position')}
            >
              <span>
                {history
                  ? liveRevision(thread) !== history.liveRevision
                    ? t('New activity below')
                    : t('Earlier messages · Scroll down to continue')
                  : t('More recent messages below')}
              </span>
              <button onClick={returnToLatest} aria-label={t('Back to latest messages')}>
                {t('Back to latest ↓')}
              </button>
            </div>
          )}
          {!!unresolvedQuestions.length && (
            <div className="question-attention" role="status">
              <span>
                {t(
                  unresolvedQuestions.length === 1
                    ? '{count} request needs your input.'
                    : '{count} requests need your input.',
                  { count: unresolvedQuestions.length },
                )}
              </span>
              <button
                onClick={() => {
                  const card = document.getElementById('action-' + unresolvedQuestions[0]!.id);
                  follow.current = false;
                  card?.scrollIntoView({ block: 'center' });
                  card
                    ?.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled)')
                    ?.focus({ preventScroll: true });
                }}
              >
                {t('Answer questions')}
              </button>
            </div>
          )}
          {steerReceipt && (
            <div className="recovery">
              <span>{t('An immediate follow-up needs confirmation.')}</span>
              <button disabled={busy} onClick={() => void checkSteer()}>
                {t('Check follow-up receipt')}
              </button>
            </div>
          )}
          {!!thread?.steering?.length && (
            <section className="steering-receipt" aria-label={t('Immediate follow-ups')}>
              {thread.steering.map((entry) => (
                <p key={entry.id}>
                  {entry.state === 'unknown'
                    ? t('Follow-up acceptance unconfirmed')
                    : entry.state === 'acknowledged'
                      ? t('Added to current task')
                      : t('Sending follow-up')}{' '}
                  · {entry.text.slice(0, 200)}
                </p>
              ))}
              {thread.steering.some(
                (entry) => entry.state === 'unknown' && entry.id !== steerReceipt?.operationId,
              ) && (
                <button disabled={busy} onClick={() => void checkFollowUpStatus()}>
                  {t('Check follow-up results')}
                </button>
              )}
            </section>
          )}
          {queueRequest && (
            <div className="recovery">
              <span>
                {t('A queue receipt needs confirmation. Check before sending another message.')}
              </span>
              <button disabled={busy} onClick={() => void checkQueueReceipt()}>
                {t('Check queue receipt')}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  changeDraft(queueRequest.payload.text);
                  changeSettings(queueRequest.payload.settings);
                  setAttachments(queueRequest.payload.attachments);
                }}
              >
                {t('Restore pending draft')}
              </button>
            </div>
          )}
          {thread?.queue && (
            <QueuePanel
              dispatchDisabled={!contextReady || directoryBlocked}
              projectId={contextProjectId}
              key={threadId}
              threadId={threadId}
              state={thread.queue}
              onChange={(queue) =>
                setThread((current) =>
                  current?.id === threadId && queueRevisionAtRender === queueRevision.current
                    ? { ...current, queue }
                    : current,
                )
              }
              onCheck={reconcile}
              turnId={canSteer ? thread?.turnId : undefined}
              settings={thread?.settings}
              onEditingChange={setQueueEditing}
              onStop={
                active && thread?.turnId
                  ? () => {
                      setBusy(true);
                      void post(`/threads/${threadId}/interrupt`)
                        .catch(notice)
                        .finally(() => setBusy(false));
                    }
                  : undefined
              }
            />
          )}

          {connectionError && !loadingConversation && (
            <div className="error-banner" role="alert">
              <span>{t(connectionError)}</span>
              <button
                onClick={() => {
                  setConnectionError('');
                  setRetry((value) => value + 1);
                }}
              >
                {t('Retry connection')}
              </button>
            </div>
          )}
          {thread?.writerConflict && (
            <section className="recovery" aria-label={t('Conversation ownership')}>
              <span>{t('Open in another Codex client')}</span>
              <button disabled={busy || !!thread.pending} onClick={() => void checkWriter()}>
                {t('Check availability')}
              </button>
              <button disabled={busy || !!thread.pending} onClick={() => void recoverBranch()}>
                {t('Continue in branch')}
              </button>
            </section>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>{t(error)}</span>
              <button
                className="icon-button"
                aria-label={t('Dismiss error')}
                onClick={() => setError('')}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          )}
          {(thread?.state === 'unknown' || (receipt && !thread?.pending)) && (
            <div className="recovery">
              <span>
                {thread?.expiredQuestion
                  ? t(
                      'The pending question expired when Codex stopped. Its answer can no longer be submitted. Check the task result before continuing.',
                    )
                  : t('A request may still be running. Check before continuing.')}
              </span>
              <button disabled={busy} onClick={() => void reconcile()}>
                {t('Check result')}
              </button>
              {thread?.expiredQuestion && (
                <button disabled={busy} onClick={() => void recoverBranch()}>
                  {t('Continue in branch')}
                </button>
              )}
            </div>
          )}
          {!queueEditing && draft.startsWith('/') && !draft.includes('\n') && (
            <div className="slash-commands" role="group" aria-label={t('Commands')}>
              {commands
                .filter((entry) => entry.name.startsWith(draft.split(/\s+/)[0] ?? ''))
                .map((entry) => (
                  <button key={entry.name} onClick={() => runCommand(entry.name)}>
                    <strong>{entry.name}</strong>
                    <span>{t(entry.detail)}</span>
                  </button>
                ))}
            </div>
          )}
          <div
            className={`composer ${active ? 'is-active' : ''}`}
            style={{ display: queueEditing ? 'none' : undefined }}
          >
            {attachments.length > 0 && (
              <div
                className={
                  'attachments' +
                  (attachments.some((entry) => entry.kind === 'image') ? ' has-images' : '')
                }
              >
                {attachments.map((a) =>
                  a.kind === 'image' ? (
                    <ImageAttachmentView
                      key={a.id}
                      image={a}
                      projectId={contextProjectId}
                      remove={() => {
                        draftRevision.current++;
                        setAttachments((list) => list.filter((entry) => entry !== a));
                      }}
                    />
                  ) : (
                    <span key={a.kind === 'uploaded-file' ? a.id : a.path}>
                      <Icon name="file" size={13} />
                      <span
                        className="attachment-name"
                        title={a.kind === 'uploaded-file' ? a.name : a.path}
                      >
                        {a.kind === 'uploaded-file'
                          ? a.name
                          : `${a.path}:${a.fromLine}–${a.toLine}`}
                      </span>
                      <button
                        aria-label={t('Remove {name}', {
                          name: a.kind === 'uploaded-file' ? a.name : a.path,
                        })}
                        onClick={() => {
                          draftRevision.current++;
                          setAttachments((list) => list.filter((x) => x !== a));
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ),
                )}
              </div>
            )}
            {!!localAttachments.pending && (
              <p className="attachment-upload-status" role="status">
                {t('Uploading {count} attachment(s)…', { count: localAttachments.pending })}
              </p>
            )}
            {threadId && conversationSettings.saving && (
              <p role="status" className="settings-save-status">
                {t('Saving conversation settings…')}
              </p>
            )}
            {settingsBlocked && profile.error && (
              <p role="alert" className="settings-save-status">
                {t(profile.error)}{' '}
                <button onClick={() => void profile.retry()}>
                  {profile.conflict ? t('Reload settings') : t('Retry settings')}
                </button>
              </p>
            )}
            <textarea
              onPaste={localAttachments.paste}
              aria-label={t('Message Codex')}
              aria-describedby="message-delivery-help"
              aria-keyshortcuts={shortcut === 'Enter' ? 'Enter' : 'Control+Enter Meta+Enter'}
              ref={composer}
              value={draft}
              readOnly={!!thread?.archived || !!thread?.managementPending}
              onChange={(e) => changeDraft(e.target.value)}
              placeholder={
                thread?.archived
                  ? t('Restore this conversation to continue…')
                  : thread?.managementPending
                    ? t('Check conversation status to continue…')
                    : active
                      ? deliveryMode === 'queue'
                        ? t('Write a message for the next turn…')
                        : t('Add a correction to this running task…')
                      : t('Ask Codex anything')
              }
              maxLength={50_000}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && draft.startsWith('/')) {
                  e.preventDefault();
                  changeDraft('');
                  return;
                }
                if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.altKey) return;
                const modifier = e.ctrlKey || e.metaKey;
                if (modifier && e.shiftKey && active) {
                  e.preventDefault();
                  if (!busy && !steerReceipt && !queueRequest) followUp(true);
                  return;
                }
                const sendKey =
                  modifier ||
                  (window.innerWidth > 700 &&
                    preferences.enter !== 'cmdAlways' &&
                    (preferences.enter !== 'cmdIfMultiline' || !draft.includes('\n')));
                if (!e.shiftKey && sendKey) {
                  e.preventDefault();
                  if (busy || steerReceipt || queueRequest) return;
                  if (active || thread?.queue?.items.length) followUp();
                  else if (!receipt) void send();
                }
              }}
            />
            <div className="composer-toolbar">
              <PanelMenu
                label={t('Attach files')}
                className="composer-attachment-menu"
                disabled={attachmentBlocked}
                iconOnly
                trigger={<Icon name="plus" size={17} />}
              >
                <button
                  type="button"
                  data-close-menu
                  onClick={() => localAttachments.picker.current?.click()}
                >
                  <Icon name="upload" size={16} />
                  {t('Upload from device')}
                </button>
                <button type="button" data-close-menu onClick={() => setPanel('files')}>
                  <Icon name="folder" size={16} />
                  {t('Browse project files')}
                </button>
              </PanelMenu>
              <input
                hidden
                ref={localAttachments.picker}
                type="file"
                multiple
                aria-label={t('Choose local files')}
                onChange={localAttachments.choose}
              />
              <ComposerControls
                ref={composerControls}
                settings={settings}
                autoReviewReady={autoReviewReady}
                change={changeSettings}
                models={models}
                resolvedModel={thread?.resolvedModel}
                modesReady={modes.some((entry) => entry.mode === 'default')}
                planReady={modes.some((entry) => entry.mode === 'plan')}
                disabled={
                  busy ||
                  loadingConversation ||
                  profile.loading ||
                  !profile.saved ||
                  !!thread?.archived ||
                  !!thread?.managementPending
                }
              />
              <div className="composer-dispatch-actions">
                {(active || !!thread?.queue?.items.length) && (
                  <button
                    className="queue-send"
                    aria-label={
                      deliveryMode === 'steer' ? t('Add to current task') : t('Queue message')
                    }
                    data-tooltip={t(followUpHint) + ' · ' + shortcut}
                    aria-describedby="message-delivery-help"
                    disabled={deliveryMode === 'steer' ? addBlocked : queueBlocked}
                    onClick={() => followUp()}
                  >
                    <Icon name={deliveryMode === 'steer' ? 'steer' : 'queue'} size={15} />
                    <span className="action-label">
                      {deliveryMode === 'steer' ? t('Add now') : t('Queue')}
                    </span>
                  </button>
                )}
                {active ? (
                  <button
                    className="stop-button"
                    aria-label={t('Stop task')}
                    data-tooltip={t('Stop current task and pause queue')}
                    aria-description={t(
                      'Stop the current task and pause queued work. Completed file changes remain.',
                    )}
                    disabled={
                      busy ||
                      !thread?.turnId ||
                      !['running', 'waitingApproval', 'waitingInput'].includes(thread.state)
                    }
                    onClick={() => {
                      setBusy(true);
                      void post(`/threads/${threadId}/interrupt`)
                        .catch(notice)
                        .finally(() => setBusy(false));
                    }}
                  >
                    <Icon name="stop" size={16} />
                    <span className="action-label">{t('Stop')}</span>
                  </button>
                ) : (
                  <button
                    className="send-button"
                    aria-label={t('Send message')}
                    aria-describedby="message-delivery-help"
                    data-tooltip={t('Send message') + ' · ' + shortcut}
                    onClick={() => void send()}
                    disabled={deliveryBlocked || !!receipt || !!thread?.queue?.items.length}
                  >
                    <Icon name="arrow" size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <span hidden id="message-delivery-help">
            {deliveryHelp}
          </span>
          <div className="composer-footer" style={{ display: queueEditing ? 'none' : undefined }}>
            {active && (
              <button
                type="button"
                disabled={deliveryMode === 'queue' ? addBlocked : queueBlocked}
                title={
                  deliveryMode === 'queue'
                    ? thread && !sameSettings(settings, thread.settings)
                      ? t('Queue this message to use the updated conversation settings')
                      : t(
                          'Apply this draft to the running task; accepted additions cannot be edited',
                        )
                    : t('Wait for a new turn; waiting text remains editable')
                }
                onClick={() => followUp(true)}
              >
                {deliveryMode === 'queue' ? t('Add now instead') : t('Queue instead')}
              </button>
            )}
          </div>
        </div>
      </main>
      {dialog === 'preferences' && (
        <PreferencesDialog
          value={preferences}
          defaults={{
            settings: defaultSettings.value?.settings,
            saving: defaultSettings.saving,
            loading: defaultSettings.loading,
            error: defaultSettings.error,
            conflict: defaultSettings.conflict,
            change: defaultSettings.change,
            retry: () => void defaultSettings.retry(),
            models,
            autoReviewReady,
            modesReady: modes.some((entry) => entry.mode === 'default'),
            planReady: modes.some((entry) => entry.mode === 'plan'),
          }}
          saveError={preferencesError}
          close={() => setDialog(undefined)}
          change={changePreferences}
          changeNotifications={(notifications) =>
            changePreferences({ ...latestPreferences.current, notifications })
          }
        />
      )}
      {dialog === 'review' && (
        <ReviewDialog
          close={() => setDialog(undefined)}
          submit={startReview}
          delivery={preferences.review}
          inlineAvailable={
            !!threadId &&
            !loadingConversation &&
            !active &&
            !thread?.archived &&
            !thread?.managementPending &&
            !thread?.queue?.items.length &&
            !receipt
          }
        />
      )}
      {dialog === 'status' && (
        <StatusDialog
          system={system}
          maintenanceBusy={maintenanceBusy}
          changeMaintenance={changeMaintenance}
          thread={thread}
          settings={thread?.settings ?? settings}
          connection={t(connection)}
          close={() => setDialog(undefined)}
        />
      )}
      {forking && (
        <InteractionDialog
          title={t('Branch from this turn?')}
          close={() => {
            setForking(undefined);
            setRecoveryFork(false);
          }}
          busy={forkBusy}
          initialFocus="[data-confirm-cancel]"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void fork();
            }}
          >
            <p>
              {t(
                'Copy the conversation through this completed turn into a new conversation. Later turns and queued messages stay in the source conversation. Both conversations use the current project files; files are not copied or rolled back. The branch starts in Read only.',
              )}
            </p>
            {recoveryFork && (
              <p>
                {t(
                  'Your unsent draft and attachments will be copied to the branch. Nothing will be sent automatically.',
                )}
              </p>
            )}
            {forkError && (
              <p className="fork-error" role="alert">
                {t(forkError)}
              </p>
            )}
            <div className="conversation-confirm-actions">
              <button
                type="button"
                className="secondary"
                data-confirm-cancel
                disabled={forkBusy}
                onClick={() => setForking(undefined)}
              >
                {t('Cancel')}
              </button>
              <button className="primary" disabled={forkBusy}>
                {forkBusy ? t('Creating branch…') : t('Create branch')}
              </button>
            </div>
          </form>
        </InteractionDialog>
      )}
      {panel && (
        <aside
          ref={contextElement}
          inert={modalOpen || (narrow && sidebar) || undefined}
          className="context-panel"
          aria-label={t('Project context')}
          role={narrow && !sidebar && !modalOpen ? 'dialog' : undefined}
          aria-modal={narrow && !sidebar && !modalOpen ? true : undefined}
        >
          <div className="panel-heading">
            <div className="panel-tabs">
              <button
                className={panel === 'files' ? 'active' : ''}
                aria-pressed={panel === 'files'}
                onClick={() => setPanel('files')}
              >
                {t('Files')}
              </button>
              <button
                className={panel === 'diff' ? 'active' : ''}
                aria-pressed={panel === 'diff'}
                onClick={() => setPanel('diff')}
              >
                {t('Changes')}
                {thread?.diff && <i />}
              </button>
            </div>
            <button
              className="icon-button"
              aria-label={t('Close panel')}
              data-tooltip=""
              onClick={() => setPanel(null)}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          {panel === 'diff' ? (
            <div className="diff-panel">
              <label className="diff-scope">
                {t('Change scope')}
                <select
                  aria-label={t('Change scope')}
                  value={diffTurn}
                  onChange={(event) => {
                    setDiffTurn(event.target.value);
                    setDiffPath('');
                  }}
                >
                  <option value="">{t('Last turn')}</option>
                  {changeTurns
                    .filter((id) => id !== thread?.turnId)
                    .map((id, i) => (
                      <option key={id} value={id}>
                        {t('Earlier turn {number} · {id}', { number: i + 1, id: id.slice(0, 8) })}
                      </option>
                    ))}
                </select>
              </label>
              {diffPatch || changeFiles.size ? (
                <DiffView
                  key={threadId + ':' + selectedDiffTurn}
                  patch={diffPatch || undefined}
                  files={diffPatch ? undefined : [...changeFiles.values()]}
                  truncated={
                    !!changeTruncated ||
                    (selectedDiffTurn === thread?.turnId && thread?.diffTruncated)
                  }
                  openFile={openChangedFile}
                  focusPath={diffPath}
                />
              ) : (
                <div className="panel-empty">
                  <Icon name="diff" size={30} />
                  <h3>{t('No changes to review')}</h3>
                  <p>{t('Changes from the current turn will appear here.')}</p>
                </div>
              )}
            </div>
          ) : (
            <FilesPanel
              key={contextBase}
              apiBase={contextReady && !directoryBlocked ? contextBase : undefined}
              directoryIssue={directoryBlocked ? context.directory.message : undefined}
              projectId={contextProjectId}
              projectName={project?.name ?? t('Project')}
              directory={directory}
              filePath={filePath}
              narrow={narrow}
              onDirectory={browseDirectory}
              onFile={setFilePath}
              onAttach={attachProjectFile}
              attachmentBlocked={attachmentBlocked}
            />
          )}
        </aside>
      )}
      {adding && <AddProjectDialog close={() => setAdding(false)} added={projectAdded} />}
      <ControlTooltip />
    </div>,
  );
}
createRoot(document.getElementById('root')!).render(<App />);
