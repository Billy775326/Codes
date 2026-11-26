import { useCodexConfiguration } from './useCodexConfiguration';
import { PreferencesDialog } from './PreferencesDialog';
import { taskActivity } from './conversation-status';
import {
  InterfaceLanguageContext,
  interfaceLanguages,
  useInterfaceLanguage,
} from './interface-language';
import { linkedConversation, projectViews } from './project-navigation';
import { draftKey, save, saved } from './browser-storage';
import { useMessageDelivery } from './useMessageDelivery';
import { parseQuestionReplies, questionSourceItemId } from '../shared/question-replies';
import { imageLimits } from '../shared/images';
import { hasHiddenPathSegment, type ProjectFileReferenceAttachment } from '../shared/project-files';
import { ImageAttachmentView } from './ImageAttachments';
import { ImagePreviewDialog } from './ContentPreview';
import { MessageView } from './ConversationMessage';
import { useLocalAttachments } from './useLocalAttachments';
import { readBrowserPreferences, type Preferences } from './browser-preferences';
import { defaultTextSize } from './font-sizes';
import { ConversationNotifications, notificationAccess } from './browser-notifications';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  Action,
  Attachment,
  Envelope,
  FileContent,
  Message,
  Project,
  ProjectContext,
  ProjectUpdate,
  Settings,
  Summary,
  System,
  Thread,
  FileChange,
} from '../shared/types';
import { ApiError, message, post, request, onAuthenticationRequired } from './api';
import { Feed } from './feed';
import { Brand, Icon, IconButton } from './primitives';
import { Login } from './Login';
import { Conversations } from './Conversations';
import { QueuePanel } from './QueuePanel';
import { Approval } from './Approval';
import { DiffView, type DiffLayout } from './DiffView';
import { FilesPanel, LinkedFilePreview } from './FilesPanel';
import { resolveProjectFile, type ProjectFileReference } from './remarkProjectFileLinks';
import { PanelMenu } from './PanelMenu';
import { useWorkspaceLayout } from './useWorkspaceLayout';
import { Transcript } from './Transcript';
import { isTurnOutcome } from './TurnResult';
import { historyLimit, liveRevision } from './history';
import { useConversationTimeline } from './useConversationTimeline';
import { useComposerTextareaHeight } from './useComposerTextareaHeight';
import { recallComposerMessage, type ComposerHistory } from './composer-history';
import { ConversationViewCache } from './conversation-view-cache';
import { applyConversationEvent } from './conversation-events';
import { reloadStaleWebBuildAfterSignIn, useWebBuild } from './useWebBuild';
import { InteractionDialog, ReviewDialog, StatusDialog } from './InteractionDialog';
import { ComposerControls, type ComposerControlsHandle } from './ComposerControls';
import { ControlTooltip } from './ControlTooltip';
import { WorkingDirectoryDialog } from './WorkingDirectoryDialog';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ConnectionStatus } from './ConnectionStatus';
import { SidebarResize } from './SidebarResize';
import './foundation.css';
import './interactions.css';
import './workflow.css';
import './style.css';
import './workspace.css';
import './preferences.css';
import './composer.css';

const starters = [
  ['Explore this project', 'Explain the architecture of this project and its main entry points.'],
  ['Plan a change', 'Review this project and help me plan a small, verifiable improvement.'],
  ['Review the code', 'Review the current code for potential bugs and explain your findings.'],
] as const;

const streamBatchMs = 96;
function App() {
  const [auth, setAuth] = useState<'loading' | 'login' | 'ready'>('loading');
  const [token, setToken] = useState('');
  const [loginNotice, setLoginNotice] = useState('');
  const [system, setSystem] = useState<System>();
  const canReview = system?.capabilities?.review !== false;
  const canBranch = system?.capabilities?.branch !== false;
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const maintenanceExpiresAt = system?.maintenance?.expiresAt;
  const [projects, setProjects] = useState<Project[]>([]);
  const resolveFile = useCallback(
    (href: string | undefined) => resolveProjectFile(href, projects, true),
    [projects],
  );
  const projectMetadataRevision = useRef(0);
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
  const [selection, setSelection] = useState(() => {
    const projectId = saved('codes.project');
    const threadId =
      linkedConversation(location.search) ||
      saved('codes.thread') ||
      (saved('codes.native-navigation')
        ? ''
        : projectViews(saved('codes.project-views'))[projectId]) ||
      '';
    return { projectId, threadId };
  });
  const { projectId, threadId } = selection;
  const [sidebarUpdates, setSidebarUpdates] = useState<Summary[]>([]);
  const [context, setContext] = useState<ProjectContext>();
  const [thread, setThread] = useState<Thread>();
  const conversationViews = useMemo(() => new ConversationViewCache(), []);
  const liveThread = useRef(thread);
  liveThread.current = thread;
  const preview =
    auth === 'ready' && threadId && thread?.id !== threadId
      ? conversationViews.peek(threadId, projectId)
      : undefined;
  const contextProjectId = threadId ? (thread?.id === threadId ? thread.projectId : '') : projectId;
  const contextBase = threadId ? '/threads/' + threadId : '/projects/' + projectId;
  const contextReady = !!contextProjectId && context?.project.id === contextProjectId;
  const directoryBlocked = contextReady && !context.directory.available;

  const [dialog, setDialog] = useState<'preferences' | 'review' | 'status'>();
  const [previewedImage, setPreviewedImage] = useState<string>();
  const [linkedFile, setLinkedFile] = useState<ProjectFileReference>();
  const [fileScopeWarning, setFileScopeWarning] = useState(0);
  const showFileScopeWarning = useCallback(() => setFileScopeWarning((value) => value + 1), []);
  useEffect(() => {
    if (!fileScopeWarning) return;
    const timer = setTimeout(() => setFileScopeWarning(0), 4500);
    return () => clearTimeout(timer);
  }, [fileScopeWarning]);
  const [preferences, setPreferences] = useState(() =>
    readBrowserPreferences(saved('codes.preferences')),
  );
  const interfaceLanguage = interfaceLanguages[preferences.language];
  const { t } = interfaceLanguage;
  const latestPreferences = useRef(preferences);
  const [preferencesError, setPreferencesError] = useState('');
  const notifications = useMemo(() => new ConversationNotifications(), []);
  const notifyInBackground =
    preferences.notifications &&
    preferences.notificationEvents.length > 0 &&
    notificationAccess() === 'granted';
  const changePreferences = (value: Preferences) => {
    latestPreferences.current = value;
    setPreferences(value);
    const stored = save('codes.preferences', JSON.stringify(value));
    setPreferencesError(stored ? '' : 'Changes apply now, but this browser could not save them.');
  };
  const threadRef = useRef(threadId);
  threadRef.current = threadId;
  const composerControls = useRef<ComposerControlsHandle>(null);
  const [mode, setMode] = useState<'default' | 'plan'>('default');
  const settings: Settings = { mode };
  const changeSettings = (next: Settings) => setMode(next.mode ?? 'default');
  useEffect(() => setMode('default'), [projectId, threadId]);
  const [draft, setDraft] = useState('');
  const [queueEditing, setQueueEditing] = useState(false);
  const draftRevision = useRef(0);
  const composerHistory = useRef<ComposerHistory>(undefined);
  const draftValue = useRef(draft);
  draftValue.current = draft;
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [forking, setForking] = useState<Message>();
  const [recoveryFork, setRecoveryFork] = useState(false);
  const branchContext = useRef<{ id: string; attachments: Attachment[] } | undefined>(undefined);
  const [forkBusy, setForkBusy] = useState(false);
  const forkOperations = useRef(new Map<string, string>());
  const [forkError, setForkError] = useState('');
  const composer = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('Connecting');
  const [connectionError, setConnectionError] = useState('');
  const [retry, setRetry] = useState(0);
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
  const {
    sidebar,
    setSidebar,
    panel,
    setPanel,
    narrow,
    phoneLayout,
    workspaceElement,
    navigationElement,
    navigationClose,
    contextElement,
    sidebarLayout,
    openNavigation,
    closeNavigation,
    closeContext,
    dismissContext,
    changeNavigationWidth,
    changeContextWidth,
  } = useWorkspaceLayout();
  const [diffTurn, setDiffTurn] = useState('');
  const [diffLayout, setDiffLayout] = useState<DiffLayout>(() =>
    saved('codes.diff-layout') === 'split' ? 'split' : 'unified',
  );
  const [diffPath, setDiffPath] = useState('');
  const [choosingDirectory, setChoosingDirectory] = useState(false);
  const openDirectoryPicker = useCallback(() => setChoosingDirectory(true), []);
  const [conversationModalOpen, setConversationModalOpen] = useState(false);
  const [directory, setDirectory] = useState('');
  const showHiddenFiles = preferences.showHiddenFiles;
  const [filePath, setFilePath] = useState<string>();
  const feed = useRef<Feed | undefined>(undefined);
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
  const {
    transcript,
    history,
    timelineLatest,
    visibleMessages,
    visibleTurns,
    reviewMessages,
    setFollowing,
    returnToLatest,
    loadHistory,
    loadingHistory,
    historyError,
    atLatest,
    timelineEvents,
  } = useConversationTimeline({
    auth,
    thread,
    preview,
    threadId,
    projectId,
    autoScroll: preferences.autoScroll,
    notice,
  });
  const updateAvailable = useWebBuild(auth === 'ready');
  const reloadPage = () => {
    if (
      (attachments.length || localAttachments.pending || queueEditing) &&
      !window.confirm(t('Reload this page? Unsent attachments or a queue edit may be lost.'))
    )
      return;
    window.location.reload();
  };
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
  const retryUpdates = () => {
    setConnectionError('');
    setRetry((value) => value + 1);
  };
  const refreshProjects = useCallback(() => {
    const revision = ++projectMetadataRevision.current;
    void request<Project[]>('/projects').then((projects) => {
      if (revision === projectMetadataRevision.current) setProjects(projects);
    }, notice);
  }, [notice]);
  useEffect(() => {
    if (auth === 'ready' && connection === 'Connected') refreshProjects();
  }, [auth, connection, refreshProjects]);
  const {
    codexDefaults,
    models,
    planReady,
    autoReviewReady,
    refreshConfiguration,
    saveComposerConfiguration,
  } = useCodexConfiguration({ auth, connection, contextProjectId, setBusy, setSystem, notice });
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
      setSelection((current) => {
        if (current.threadId || projects.some((entry) => entry.id === current.projectId))
          return current;
        const initial = projects.find((entry) => entry.path === system.initialWorkingDirectory);
        return { ...current, projectId: initial?.id ?? '' };
      });
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
  const changeMaintenance = async (action: 'start' | 'cancel', report = notice) => {
    setMaintenanceBusy(true);
    try {
      setSystem(await post<System>('/maintenance', { action }));
    } catch (error) {
      report(error);
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
    setSidebarUpdates((rows) => [summary, ...rows.filter((row) => row.id !== id)].slice(0, 100));
    if (updateThread)
      setThread((current) => (current?.id === summary.id ? { ...current, ...summary } : current));
  }, []);
  useEffect(() => {
    if (auth !== 'ready') {
      conversationViews.clear();
      setSidebarUpdates([]);
      setContext(undefined);
    }
  }, [auth, conversationViews]);
  useEffect(() => {
    setThread((current) =>
      auth === 'ready' && current?.projectId === projectId && current.id === threadId
        ? current
        : undefined,
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
    if (threadId || auth !== 'ready') return;
    const stream = new Feed<{ cursor: { seq: number; epoch: string } }>(
      '',
      () => {},
      (event) => {
        if (event.kind === 'summary') {
          const row = event.data as Summary;
          if (notifyInBackground)
            notifications.observe(
              row,
              true,
              interfaceLanguages[latestPreferences.current.language].t,
              latestPreferences.current.notificationEvents,
            );
          conversationUpdated(row, false);
        } else if (event.kind === 'project') {
          const { id, name } = event.data as Project;
          projectUpdated({ id, name });
        } else if (event.kind === 'project-archive') projectUpdated(event.data as ProjectUpdate);
        else if (event.kind === 'codex-configuration') refreshConfiguration();
        else if (event.kind === 'runtime') setSystem(event.data as System);
      },
      connectionStatus,
      'conversations',
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
  }, [threadId, auth, retry, notifyInBackground, notifications]);
  const select = useCallback(
    (id: string, owner = projectRef.current) => {
      const changed = id !== threadRef.current || owner !== projectRef.current;
      if (changed) {
        conversationViews.refreshRecency(id, owner);
        const leaving = liveThread.current;
        if (
          auth === 'ready' &&
          leaving?.id === threadRef.current &&
          leaving.projectId === projectRef.current
        )
          conversationViews.remember(leaving);
        feed.current?.close();
        setConnection(owner ? 'Connecting' : 'Ready');
      }
      setThread((current) =>
        current?.id === id && current.projectId === owner ? current : undefined,
      );
      setSelection({ projectId: owner, threadId: id });
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
      setFollowing(true);
    },
    [auth, conversationViews, returnToLatest],
  );
  const loadingConversation = !!threadId && (!thread || thread.id !== threadId);
  const clearAcceptedDraft = (id: string, version: number, origin = id) => {
    // A network acknowledgement belongs to the captured draft, not whatever the
    // user has typed since dispatch. Preserve the next draft and its attachments.
    if (version !== draftRevision.current) return;
    save('codes.draft.' + id, '');
    if (!origin) save(draftKey(projectId, ''), '');
    if (threadRef.current === id || threadRef.current === origin) {
      composerHistory.current = undefined;
      draftValue.current = '';
      setDraft('');
      setAttachments([]);
    }
  };
  const {
    receipt,
    queueRequest,
    steerReceipt,
    restoreReceipts,
    clearSendReceipt,
    observeQueue,
    applyQueue,
    send: sendMessage,
    enqueue,
    steer,
    checkQueueReceipt,
    reconcile,
    checkSteer,
    checkFollowUpStatus,
    startReview,
    stop,
  } = useMessageDelivery({
    auth,
    connection,
    projectId,
    threadId,
    thread,
    threadRef,
    loadingConversation,
    contextReady,
    directoryBlocked,
    uploadsPending: localAttachments.pending > 0,
    busy,
    setBusy,
    setError,
    setThread,
    notice,
    connectionFailure,
    reconnect: () => feed.current?.connect(),
    onCreated: (created) => {
      conversationUpdated(created);
      select(created.id);
      setThread(created);
    },
    returnToLatest,
    setFollowing,
    composer: {
      text: draft,
      attachments,
      settings,
      hasInput,
      revision: draftRevision,
      latestText: draftValue,
      clearAccepted: clearAcceptedDraft,
      restoreAttachments: setAttachments,
    },
  });
  useEffect(() => {
    if (auth !== 'ready') return;
    if (save('codes.thread', threadId)) {
      if (!saved('codes.native-navigation')) save('codes.native-navigation', '1');
      if (threadId && linkedConversation(location.search) === threadId) {
        const url = new URL(location.href);
        url.searchParams.delete('conversation');
        window.history.replaceState(window.history.state, '', url);
      }
    }
    const key = draftKey(projectId, threadId);
    // Move the legacy unscoped new draft into the selected project once.
    const restored = saved(key) || (!threadId ? saved('codes.draft.new') : '');
    if (!threadId && restored && !saved(key)) {
      save(key, restored);
      if (saved(key) === restored) save('codes.draft.new', '');
    }
    composerHistory.current = undefined;
    draftValue.current = restored.slice(0, 50_000);
    setDraft(draftValue.current);
    restoreReceipts();
    setAttachments(branchContext.current?.id === threadId ? branchContext.current.attachments : []);
    branchContext.current = undefined;
  }, [threadId, projectId, auth]);
  useEffect(() => {
    if (auth !== 'ready') return;
    if (!threadId) return;
    const deltas = new Map<string, string>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      if (!deltas.size) return;
      const changes = new Map(deltas);
      deltas.clear();
      setThread((t) =>
        t?.id === threadId
          ? {
              ...t,
              messages: t.messages.map((m) =>
                changes.has(m.id) ? { ...m, text: m.text + changes.get(m.id) } : m,
              ),
            }
          : t,
      );
    };
    const event = (e: Envelope) => {
      if (e.kind === 'codex-configuration') {
        refreshConfiguration();
        return;
      }
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
            latestPreferences.current.notificationEvents,
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
      if (e.kind === 'queue') observeQueue();
      if (
        e.kind === 'state' &&
        Object.hasOwn(e.data as object, 'pending') &&
        !(e.data as Partial<Thread>).pending
      ) {
        clearSendReceipt();
      }
      setThread((thread) => applyConversationEvent(thread, e));
    };
    const stream = new Feed(
      threadId,
      (snapshot) => {
        if (threadRef.current !== threadId) return;
        if (snapshot.thread.id !== threadId)
          throw new ApiError(
            'The service returned a result for a different conversation.',
            'INVALID_RESPONSE',
          );
        if (snapshot.thread.projectId !== projectId)
          setSelection({ projectId: snapshot.thread.projectId, threadId });
        if (snapshot.context) {
          const workspace = snapshot.context.project;
          setProjects((list) =>
            list.some((entry) => entry.id === workspace.id) ? list : [...list, workspace],
          );
          setContext(snapshot.context);
          if (!snapshot.context.directory.available) setFilePath(undefined);
        }
        deltas.clear();
        observeQueue();
        setThread({ ...snapshot.thread, messages: snapshot.thread.messages.slice(-historyLimit) });
        // Project summaries may arrive while subscriptions switch. The selected
        // snapshot is also the authoritative summary for the navigation list.
        if (notifyInBackground) notifications.observe(snapshot.thread, false);
        conversationUpdated(snapshot.thread);
      },
      event,
      (status) => {
        if (status === 'Unavailable' || status === 'Sign in required')
          conversationViews.forget(threadId);
        connectionStatus(status);
      },
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
  useComposerTextareaHeight(composer, draft, auth === 'ready' && !queueEditing);
  const changeDraft = useCallback(
    (value: string, recalling = false) => {
      draftRevision.current++;
      draftValue.current = value;
      setDraft(value);
      if (!recalling) {
        composerHistory.current = undefined;
        save(draftKey(projectId, threadId), value.slice(0, 50_000));
      }
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
      setMode('default');
      setError('');
    },
    [select],
  );
  const newThread = useCallback(() => {
    if (projectId && !directoryBlocked) newThreadIn(projectId);
    else openDirectoryPicker();
  }, [projectId, directoryBlocked, newThreadIn, openDirectoryPicker]);
  const send = () => {
    if (draft.trimStart().startsWith('/')) runCommand(draft.trim());
    else void sendMessage();
  };
  const submitAction = async (
    action: Action,
    resolution: { decision?: string; answers?: Record<string, string> },
  ) => {
    await post(`/actions/${action.id}`, { operationId: crypto.randomUUID(), ...resolution });
  };
  const directoryChosen = (workspace: Project) => {
    if (!projectRef.current && !threadRef.current && draftValue.current) {
      const key = draftKey(workspace.id, '');
      if (!saved(key) && save(key, draftValue.current)) save(draftKey('', ''), '');
    }
    projectMetadataRevision.current++;
    setProjects((list) =>
      list.some((entry) => entry.id === workspace.id) ? list : [...list, workspace],
    );
    newThreadIn(workspace.id);
    setChoosingDirectory(false);
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
        {
          path: file.path,
          sha: file.sha,
          fromLine,
          toLine,
          ...(showHiddenFiles ? { showHidden: true as const } : {}),
        },
      ]);
      if (narrow) setPanel(null);
      requestAnimationFrame(() => composer.current?.focus());
    },
    [attachmentBlocked, narrow, showHiddenFiles],
  );
  const attachProjectReference = useCallback(
    (reference: ProjectFileReferenceAttachment) => {
      if (attachmentBlocked) return;
      draftRevision.current++;
      setAttachments((list) => [
        ...list.filter((entry) => !('path' in entry) || entry.path !== reference.path),
        reference,
      ]);
      if (narrow) setPanel(null);
      requestAnimationFrame(() => composer.current?.focus());
    },
    [attachmentBlocked, narrow],
  );
  const active =
    !!thread?.pending ||
    !!thread?.steering?.length ||
    (!!thread &&
      !thread.writerConflict &&
      ['running', 'waitingApproval', 'waitingInput', 'unknown'].includes(thread.state));
  const activity =
    thread && !loadingConversation ? taskActivity(thread, connection === 'Connected') : undefined;
  const outcome = isTurnOutcome(thread?.state) ? thread.state : undefined;
  const finishedTurn = outcome
    ? thread?.turns?.findLast((turn) => turn.id === thread.turnId && turn.status === outcome)
    : undefined;
  const taskResult = outcome ? { status: outcome, turn: finishedTurn } : undefined;
  const project =
    projects.find((x) => x.id === contextProjectId) ??
    (context?.project.id === contextProjectId ? context.project : undefined);
  const transcriptProject = preview
    ? projects.find((entry) => entry.id === preview.projectId)
    : project;
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
  const questionsByItem = new Map(
    [...inlineQuestions.values()]
      .filter((action) => action.async && action.afterMessageId)
      .flatMap((action) =>
        [action.afterMessageId, ...(action.legacyQuestion?.itemIds ?? [])]
          .filter(Boolean)
          .map((id) => [id, action] as const),
      ),
  );
  const pendingFollowUps =
    thread?.steering?.filter(
      (entry) =>
        !entry.questionReply && (entry.state === 'dispatching' || entry.state === 'unknown'),
    ) ?? [];
  const pending = thread?.pending;
  // A native turn owns an accepted prompt even after it leaves the live window.
  // Reviews have no guaranteed native user item to replace their preview.
  const pendingPreview =
    timelineLatest &&
    pending &&
    (pending.kind === 'review' || (!pending.turnId && pending.state !== 'acknowledged')) &&
    !parseQuestionReplies(pending.text ?? '') &&
    !visibleMessages.some((item) => item.clientId === pending.id)
      ? pending
      : undefined;
  const visibleTurnIds = new Set(visibleMessages.map((item) => item.turnId));
  const transcriptMessages = visibleMessages.flatMap((item) => {
    if (!item.answeredQuestions?.length) return [item];
    const standalone = item.answeredQuestions.filter(({ questionItemId, question }) => {
      if (!questionItemId) return true;
      const source = questionSourceItemId(questionItemId);
      const action = questionsByItem.get(source);
      if (!action?.submittedAnswers) return true;
      const answers = action.submittedAnswers;
      // Older reply envelopes used the source item ID and the question text.
      return (
        !Object.hasOwn(
          answers,
          action.legacyQuestion?.questionIds[questionItemId] ?? questionItemId,
        ) &&
        (questionItemId !== source ||
          !action.questions?.some(
            (entry) => entry.question === question && Object.hasOwn(answers, entry.id),
          ))
      );
    });
    if (!standalone.length) return [];
    return standalone.length === item.answeredQuestions.length
      ? [item]
      : [{ ...item, answeredQuestions: standalone }];
  });
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
    const legacyAnchor =
      anchor < 0 && action.legacyQuestion
        ? transcriptMessages.findLastIndex(
            (item) =>
              action.legacyQuestion?.itemIds.includes(item.id) && item.turnId === action.turnId,
          )
        : -1;
    const at = anchor >= 0 ? anchor : legacyAnchor >= 0 ? legacyAnchor : last;
    transcriptMessages.splice(at < 0 ? transcriptMessages.length : at + 1, 0, {
      id: action.id,
      kind: 'question',
      turnId: action.turnId,
      text: '',
    });
  }
  const openProjectFile = useCallback(
    (path: string) => {
      if (!contextReady || directoryBlocked) return;
      const prefix = project?.path?.replace(/\/?$/, '/');
      const relative = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
      if (!showHiddenFiles && hasHiddenPathSegment(relative)) {
        setLinkedFile({ projectId: contextProjectId, path: relative });
        return;
      }
      setDirectory(relative.split('/').slice(0, -1).join('/'));
      setFilePath(relative);
      setPanel('files');
    },
    [contextReady, directoryBlocked, project?.path, showHiddenFiles, contextProjectId],
  );
  const openLinkedFile = useCallback(
    (file: ProjectFileReference) => {
      if (file.projectId === contextProjectId && contextReady && !directoryBlocked)
        openProjectFile(file.path);
      else setLinkedFile(file);
    },
    [contextProjectId, contextReady, directoryBlocked, openProjectFile],
  );
  const canSteer =
    !!thread?.turnId &&
    thread.state === 'running' &&
    thread.pending?.state !== 'unknown' &&
    thread.pending?.kind !== 'review' &&
    !thread.archived &&
    !thread.managementPending;
  const deliveryMode = canSteer && preferences.followUp === 'steer' ? 'steer' : 'queue';
  const alternateDelivery = deliveryMode === 'queue' ? 'steer' : 'queue';
  const hasFollowUps = active || !!thread?.queue?.items.length;
  const deliveryReason = (
    [
      [thread?.archived, 'Conversation archived.'],
      [directoryBlocked, 'Project directory unavailable.'],
      [system?.maintenance, 'New tasks are paused for maintenance.'],
      [connection !== 'Connected' || loadingConversation, 'Wait for the connection.'],
      [thread?.writerConflict, 'Open in another Codex client'],
      [steerReceipt || queueRequest, 'Check the pending result first.'],
      [localAttachments.pending, 'Wait for attachments to upload.'],
      [busy || thread?.managementPending, 'Wait for the current request.'],
      [!contextReady, 'Wait for project context.'],
      [!hasInput, 'Write a message first.'],
    ] as const
  ).find(([blocked]) => blocked)?.[1];
  const queueFull = (thread?.queue?.items.length ?? 0) >= 10;
  const queueReason = queueFull ? 'Queue full. Remove a queued message.' : deliveryReason;
  const steerReason = (
    [
      [thread?.state === 'waitingApproval', 'Respond to the approval first.'],
      [thread?.state === 'waitingInput', 'Answer the question first.'],
      [
        thread?.state === 'unknown' || thread?.pending?.state === 'unknown',
        'Check the pending result first.',
      ],
      [thread?.pending?.kind === 'review', 'Wait for the review to finish.'],
      [!canSteer, 'No task is accepting messages.'],
    ] as const
  ).find(([blocked]) => blocked)?.[1];
  const addNowReason = steerReason ?? deliveryReason;
  const deliveryBlocked = !!deliveryReason;
  const queueBlocked = !!queueReason;
  const addBlocked = !!addNowReason;
  const tabQueues = deliveryMode === 'steer' && !queueBlocked && !draft.trimStart().startsWith('/');
  const stopReason = busy
    ? 'Wait for the current request.'
    : !thread?.turnId || !['running', 'waitingApproval', 'waitingInput'].includes(thread.state)
      ? 'No task can be stopped.'
      : undefined;
  const queueDescription = t(
    queueFull
      ? 'Queue full. Remove a queued message.'
      : thread?.queue?.paused
        ? 'Resume the queue to send waiting messages.'
        : 'Queued messages can be edited until dispatch.',
  );
  const addNowDescription = t(addNowReason ?? 'Accepted additions cannot be edited.');
  const deliveryHelp = hasFollowUps
    ? deliveryMode === 'queue'
      ? queueDescription
      : addNowDescription
    : t('Starts a new turn.');
  const shortcut =
    phoneLayout ||
    preferences.enter === 'cmdAlways' ||
    (preferences.enter === 'cmdIfMultiline' && draft.includes('\n'))
      ? 'Ctrl/Cmd+Enter'
      : 'Enter';
  const keyShortcut = shortcut === 'Enter' ? 'Enter' : 'Control+Enter Meta+Enter';
  const alternateShortcut = 'Ctrl/Cmd+Shift+Enter';
  const alternateKeyShortcut = 'Control+Shift+Enter Meta+Shift+Enter';
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
    ...(canReview
      ? [{ name: '/review', detail: 'Start a native code review', run: () => setDialog('review') }]
      : []),
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
  const followUp = (behavior: Preferences['followUp'] = deliveryMode) => {
    if (draft.trimStart().startsWith('/')) {
      runCommand(draft.trim());
      return;
    }
    if (behavior === 'steer') {
      if (!addBlocked) void steer();
    } else if (!queueBlocked) {
      void enqueue();
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
  const modalOpen =
    choosingDirectory ||
    !!dialog ||
    !!previewedImage ||
    !!linkedFile ||
    !!forking ||
    conversationModalOpen;
  const conversationLoadError =
    connectionError ||
    (['Unavailable', 'Disconnected'].includes(connection) ? 'Connection lost.' : '');
  const canRetryUpdates = ['Reconnecting', 'Disconnected', 'Unavailable'].includes(connection);
  const reconnect = canRetryUpdates && (!loadingConversation || preview) ? retryUpdates : undefined;
  const withLanguage = (view: React.ReactNode) => (
    <InterfaceLanguageContext value={interfaceLanguage}>
      {view}
      <ControlTooltip />
    </InterfaceLanguageContext>
  );
  if (auth !== 'ready')
    return withLanguage(
      <Login
        token={token}
        error={error}
        notice={loginNotice}
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
            .then(async () => {
              setToken('');
              setLoginNotice('');
              if (!(await reloadStaleWebBuildAfterSignIn())) await init();
            })
            .catch((e) => setError(message(e)))
            .finally(() => setBusy(false));
        }}
      />,
    );
  return withLanguage(
    <div
      ref={workspaceElement}
      data-theme={theme}
      data-live={connection === 'Connected'}
      data-chat-font-size={preferences.chatFontSize}
      data-code-font-size={preferences.codeFontSize}
      style={
        {
          '--navigation-width': `${sidebarLayout.navigation.width}px`,
          '--context-width': `${sidebarLayout.context.width}px`,
          '--chat-font-size': `${preferences.chatFontSize ?? defaultTextSize}px`,
          '--code-font-size': `${preferences.codeFontSize ?? defaultTextSize}px`,
        } as React.CSSProperties
      }
      className={`app ${panel ? 'has-panel' : ''} ${sidebar ? 'history-open' : ''}`}
    >
      {sidebar && <div className="scrim" onClick={closeNavigation} />}
      <aside
        ref={navigationElement}
        id="sidebar-navigation"
        className={`sidebar ${sidebar ? 'open' : ''}`}
        aria-label={t('Workspace navigation')}
        inert={modalOpen || undefined}
        role={narrow && sidebar && !modalOpen ? 'dialog' : undefined}
        aria-modal={narrow && sidebar && !modalOpen ? true : undefined}
      >
        <div className="sidebar-brand">
          <Brand />
          <IconButton
            ref={navigationClose}
            className="navigation-close"
            icon="sidebar-collapse"
            label={t('Close navigation')}
            size={18}
            onClick={closeNavigation}
          />
        </div>
        <Conversations
          projects={projects}
          cwd={project?.path}
          selectedId={threadId}
          updates={sidebarUpdates}
          connection={connection}
          disabled={busy}
          supportsCreatedSort={system?.capabilities?.conversationSort !== false}
          onNew={newThread}
          onSelect={select}
          onUpdated={conversationUpdated}
          onModalChange={setConversationModalOpen}
        />
        <div className="workspace-footer" role="group" aria-label={t('Workspace controls')}>
          <ConnectionStatus status={connection} placement="sidebar" onReconnect={reconnect} />
          <div className="workspace-actions">
            <button
              className="icon-button"
              aria-label={t('Interaction settings')}
              data-tooltip=""
              onClick={() => setDialog('preferences')}
            >
              <Icon name="settings" size={16} />
            </button>
            <IconButton
              icon="logout"
              label={t('Sign out')}
              onClick={() =>
                void post('/logout')
                  .then(() => {
                    feed.current?.close();
                    setAuth('login');
                  })
                  .catch(notice)
              }
            />
          </div>
        </div>
      </aside>
      {sidebar && !narrow && !modalOpen && (
        <SidebarResize
          side="navigation"
          range={sidebarLayout.navigation}
          workspace={workspaceElement}
          change={changeNavigationWidth}
        />
      )}
      <main
        className="main"
        aria-label={t('Conversation workspace')}
        inert={modalOpen || (narrow && (sidebar || !!panel)) || undefined}
      >
        <WorkspaceHeader
          title={
            preview?.title ??
            (loadingConversation ? t('Conversation') : (thread?.title ?? t('New conversation')))
          }
          conversationId={thread?.id === threadId ? threadId : undefined}
          renameDisabled={busy || !!thread?.managementPending}
          cwd={project?.path}
          onChooseDirectory={!threadId ? openDirectoryPicker : undefined}
          sidebarOpen={sidebar}
          connection={connection}
          theme={theme}
          panel={panel}
          busy={busy}
          hasProject={contextReady && !directoryBlocked}
          onNavigation={openNavigation}
          onNewConversation={newThread}
          onSettings={() => setDialog('preferences')}
          onReload={reloadPage}
          onReconnect={reconnect}
          updateAvailable={updateAvailable}
          onToggleTheme={() =>
            changePreferences({ ...preferences, theme: theme === 'dark' ? 'light' : 'dark' })
          }
          onReview={canReview ? () => setDialog('review') : undefined}
          onStatus={() => setDialog('status')}
          onPanel={(kind) => {
            if (kind === 'diff' || (contextReady && !directoryBlocked))
              setPanel(panel === kind ? null : kind);
          }}
          onRename={async (id, name) => {
            const result = await post<Summary>('/threads/' + encodeURIComponent(id) + '/rename', {
              operationId: crypto.randomUUID(),
              name,
            });
            conversationUpdated(result);
          }}
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
          aria-busy={!!preview || undefined}
          tabIndex={0}
          {...timelineEvents}
        >
          <div className="conversation-inner">
            {loadingConversation && !preview ? (
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
                {canRetryUpdates && (
                  <button
                    onClick={() => {
                      setError('');
                      retryUpdates();
                    }}
                  >
                    {t('Retry loading')}
                  </button>
                )}
              </section>
            ) : !visibleMessages.length && !active ? (
              <section className="conversation-start" aria-label={t('New conversation')}>
                {projectId ? (
                  <div className="conversation-starters">
                    {starters.map(([label, text]) => (
                      <button key={label} type="button" onClick={() => changeDraft(text)}>
                        {t(label)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button className="primary" onClick={openDirectoryPicker}>
                    <Icon name="folder" />
                    {t('Choose a working directory')}
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
                {(thread || preview) && (
                  <Transcript
                    key={threadId}
                    messages={transcriptMessages}
                    turns={visibleTurns}
                    activeIds={activeTurnIds}
                    result={taskResult}
                    viewport={transcript}
                    projectId={preview?.projectId ?? contextProjectId}
                    pending={thread?.pending}
                    steering={thread?.steering}
                    loadEarlier={
                      (history ? history.olderCursor : thread?.olderCursor)
                        ? () => loadHistory('older')
                        : undefined
                    }
                    render={(m, finalReply, changes, timestamp, completion) => {
                      if (m.kind === 'question') {
                        const action = inlineQuestions.get(m.id);
                        if (action && ['pending', 'responding'].includes(action.status))
                          return (
                            <Approval
                              action={action}
                              submit={submitAction}
                              checkAnswer={checkFollowUpStatus}
                            />
                          );
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
                          onOpenImage={setPreviewedImage}
                          projectId={preview?.projectId ?? contextProjectId}
                          projectPath={transcriptProject?.path}
                          resolveFile={resolveFile}
                          onOpenFile={openLinkedFile}
                          key={m.id}
                          item={m}
                          actions={finalReply}
                          changes={changes}
                          timestamp={timestamp}
                          completion={completion}
                          onReview={thread ? reviewMessage : undefined}
                          onReply={thread && !thread.archived ? reply : undefined}
                          onFork={
                            thread && canBranch && (!active || m.turnId !== thread.turnId)
                              ? m.kind === 'assistant'
                                ? branchMessage
                                : undefined
                              : undefined
                          }
                          disabled={busy || forkBusy || thread?.managementPending}
                          streaming={
                            !!thread &&
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
                {pendingPreview && (
                  <MessageView
                    onOpenImage={setPreviewedImage}
                    resolveFile={resolveFile}
                    onOpenFile={openLinkedFile}
                    projectId={contextProjectId}
                    item={{
                      id: pendingPreview.id,
                      turnId: '',
                      kind: 'user',
                      text: pendingPreview.text ?? '',
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
                {activity && (!history || timelineLatest) && (
                  <div
                    className="task-activity"
                    data-state={activity.state}
                    role="status"
                    aria-label={t(activity.label)}
                    data-tooltip=""
                    tabIndex={0}
                  >
                    <i aria-hidden="true" />
                    <i aria-hidden="true" />
                    <i aria-hidden="true" />
                    <span className="visually-hidden">{t(activity.label)}</span>
                  </div>
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
                {history && liveRevision(thread) !== history.liveRevision
                  ? t('New activity')
                  : t('Earlier messages')}
              </span>
              <IconButton
                icon="latest"
                label={t('Back to latest messages')}
                onClick={returnToLatest}
              />
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
                  setFollowing(false);
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
              <span>{t('Follow-up acceptance unconfirmed')}</span>
              <button disabled={busy} onClick={() => void checkSteer()}>
                {t('Check follow-up receipt')}
              </button>
            </div>
          )}
          {!!pendingFollowUps.length && (
            <section className="steering-receipt" aria-label={t('Immediate follow-ups')}>
              {pendingFollowUps.map((entry) => (
                <p key={entry.id}>
                  {entry.state === 'unknown'
                    ? t('Follow-up acceptance unconfirmed')
                    : t('Sending follow-up')}{' '}
                  · {entry.text.slice(0, 200)}
                </p>
              ))}
              {pendingFollowUps.some(
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
              <span>{t('Queue receipt unconfirmed. Check before sending again.')}</span>
              <button
                disabled={busy || loadingConversation}
                onClick={() => void checkQueueReceipt()}
              >
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
              dispatchUnavailable={
                directoryBlocked
                  ? 'Project directory unavailable.'
                  : !contextReady
                    ? 'Wait for project context.'
                    : undefined
              }
              projectId={contextProjectId}
              key={threadId}
              threadId={threadId}
              state={thread.queue}
              onChange={applyQueue}
              onCheck={reconcile}
              turnId={canSteer ? thread?.turnId : undefined}
              onEditingChange={setQueueEditing}
              onStop={active && thread?.turnId ? stop : undefined}
            />
          )}

          {connectionError && (!loadingConversation || preview) && (
            <div className="error-banner" role="alert">
              <span>{t(connectionError)}</span>
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
              <IconButton
                icon="close"
                label={t('Dismiss error')}
                size={15}
                onClick={() => setError('')}
              />
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
                          : a.kind === 'file-reference'
                            ? a.path
                            : `${a.path}:${a.fromLine}–${a.toLine}`}
                      </span>
                      <IconButton
                        icon="close"
                        size={14}
                        label={t('Remove {name}', {
                          name: a.kind === 'uploaded-file' ? a.name : a.path,
                        })}
                        onClick={() => {
                          draftRevision.current++;
                          setAttachments((list) => list.filter((x) => x !== a));
                        }}
                      />
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
            <textarea
              onPaste={localAttachments.paste}
              aria-label={t('Message Codex')}
              aria-describedby="message-delivery-help"
              aria-keyshortcuts={
                keyShortcut + (threadId ? ' ArrowUp ArrowDown' : '') + (tabQueues ? ' Tab' : '')
              }
              ref={composer}
              value={draft}
              readOnly={!!thread?.archived || !!thread?.managementPending}
              onChange={(e) => changeDraft(e.target.value)}
              placeholder={
                thread?.archived
                  ? t('Restore this conversation to continue…')
                  : thread?.managementPending
                    ? t('Check conversation status to continue…')
                    : t('Ask Codex anything')
              }
              maxLength={50_000}
              onKeyDown={(e) => {
                const recall = recallComposerMessage(e, composerHistory.current, () =>
                  thread?.id === threadId && thread.projectId === projectId
                    ? reviewMessages
                    : (preview?.messages ?? []),
                );
                if (recall) {
                  e.preventDefault();
                  composerHistory.current = recall.history;
                  const input = e.currentTarget;
                  input.setSelectionRange(input.value.length, input.value.length);
                  if (recall.text !== input.value) changeDraft(recall.text, true);
                  return;
                }
                if (e.key === 'Escape' && draft.startsWith('/')) {
                  e.preventDefault();
                  changeDraft('');
                  return;
                }
                if (e.nativeEvent.isComposing || e.altKey) return;
                const modifier = e.ctrlKey || e.metaKey;
                if (e.key === 'Tab' && tabQueues && !modifier && !e.shiftKey && !e.repeat) {
                  e.preventDefault();
                  followUp('queue');
                  return;
                }
                if (e.key !== 'Enter') return;
                if (modifier && e.shiftKey && active) {
                  e.preventDefault();
                  if (!busy && !steerReceipt && !queueRequest) followUp(alternateDelivery);
                  return;
                }
                const sendKey =
                  modifier ||
                  (!phoneLayout &&
                    preferences.enter !== 'cmdAlways' &&
                    (preferences.enter !== 'cmdIfMultiline' || !draft.includes('\n')));
                if (!e.shiftKey && sendKey) {
                  e.preventDefault();
                  if (busy || steerReceipt || queueRequest) return;
                  if (hasFollowUps) followUp();
                  else if (!receipt) void send();
                }
              }}
            />
            <div className="composer-toolbar">
              <div className="composer-tools">
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
                  mode={mode}
                  changeMode={setMode}
                  configuration={codexDefaults}
                  models={models}
                  autoReviewReady={autoReviewReady}
                  saveConfiguration={saveComposerConfiguration}
                  planReady={planReady}
                  disabled={
                    busy || loadingConversation || !!thread?.archived || !!thread?.managementPending
                  }
                />
              </div>
              <div
                className="composer-dispatch-actions"
                role="group"
                aria-label={t('Message actions')}
                data-follow-up={hasFollowUps || undefined}
              >
                {hasFollowUps ? (
                  <IconButton
                    icon="queue"
                    size={17}
                    label={t('Queue message')}
                    className={deliveryMode === 'queue' ? 'delivery-primary' : undefined}
                    aria-keyshortcuts={
                      queueBlocked
                        ? undefined
                        : deliveryMode === 'queue'
                          ? keyShortcut
                          : tabQueues
                            ? 'Tab ' + alternateKeyShortcut
                            : alternateKeyShortcut
                    }
                    aria-description={queueDescription}
                    hint={
                      t('Queue for next turn') +
                      ' · ' +
                      (deliveryMode === 'queue' ? shortcut : tabQueues ? 'Tab' : alternateShortcut)
                    }
                    unavailable={queueReason ? t(queueReason) : undefined}
                    onClick={() => followUp('queue')}
                  />
                ) : (
                  <IconButton
                    className="send-button"
                    icon="arrow"
                    size={18}
                    label={t('Send message')}
                    aria-keyshortcuts={keyShortcut}
                    aria-describedby="message-delivery-help"
                    hint={t('Send message') + ' · ' + shortcut}
                    onClick={() => void send()}
                    disabled={deliveryBlocked || !!receipt}
                  />
                )}
                {active && (
                  <>
                    <IconButton
                      icon="steer"
                      size={17}
                      label={t('Add to current task')}
                      className={deliveryMode === 'steer' ? 'delivery-primary' : undefined}
                      aria-keyshortcuts={
                        addBlocked
                          ? undefined
                          : deliveryMode === 'steer'
                            ? keyShortcut
                            : alternateKeyShortcut
                      }
                      aria-description={addNowDescription}
                      hint={
                        t('Add to current task') +
                        ' · ' +
                        (deliveryMode === 'steer' ? shortcut : alternateShortcut)
                      }
                      unavailable={addNowReason ? addNowDescription : undefined}
                      onClick={() => followUp('steer')}
                    />
                    <IconButton
                      icon="stop"
                      className="stop-button"
                      label={t('Stop task')}
                      hint={t(
                        thread?.queue?.items.length && !thread.queue.paused
                          ? 'Stop task · Pause queue'
                          : 'Stop task',
                      )}
                      aria-description={t(
                        'Stop the current task and pause queued work. Completed file changes remain.',
                      )}
                      unavailable={stopReason ? t(stopReason) : undefined}
                      onClick={stop}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
          <span hidden id="message-delivery-help">
            {deliveryHelp}
          </span>
        </div>
      </main>
      {previewedImage && (
        <ImagePreviewDialog
          path={previewedImage}
          projectId={
            resolveProjectFile(previewedImage, projects)?.projectId ??
            (contextProjectId || undefined)
          }
          showHidden={showHiddenFiles}
          onScopeWarning={showFileScopeWarning}
          close={() => setPreviewedImage(undefined)}
        />
      )}
      {linkedFile && (
        <LinkedFilePreview
          key={linkedFile.projectId + ':' + linkedFile.path}
          file={linkedFile}
          showHidden={showHiddenFiles || hasHiddenPathSegment(linkedFile.path)}
          onScopeWarning={showFileScopeWarning}
          close={() => setLinkedFile(undefined)}
        />
      )}
      {dialog === 'preferences' && (
        <PreferencesDialog
          system={system}
          maintenanceBusy={maintenanceBusy}
          changeMaintenance={changeMaintenance}
          signInAfterTokenChange={(message) => {
            feed.current?.close();
            setDialog(undefined);
            setToken('');
            setError('');
            setLoginNotice(message);
            setAuth('login');
          }}
          value={preferences}
          configurationProject={contextProjectId}
          models={models}
          autoReviewReady={autoReviewReady}
          configurationChanged={refreshConfiguration}
          saveError={preferencesError}
          close={() => {
            setDialog(undefined);
          }}
          change={changePreferences}
          changeNotifications={(patch) =>
            changePreferences({ ...latestPreferences.current, ...patch })
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
          configuration={codexDefaults}
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
                'Copy history through this turn. Later turns and queued messages stay here. The branch shares project files and uses the effective Codex configuration.',
              )}
            </p>
            {recoveryFork && <p>{t('Copy the draft and attachments without sending.')}</p>}
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
      {panel && narrow && !sidebar && !modalOpen && (
        <div className="context-scrim" aria-hidden="true" onClick={closeContext} />
      )}
      {panel && !narrow && !modalOpen && (
        <SidebarResize
          side="context"
          range={sidebarLayout.context}
          workspace={workspaceElement}
          change={changeContextWidth}
        />
      )}
      {panel && (
        <aside
          ref={contextElement}
          id="sidebar-context"
          inert={modalOpen || (narrow && sidebar) || undefined}
          className="context-panel"
          aria-label={t('Project context')}
          role={narrow && !sidebar && !modalOpen ? 'dialog' : undefined}
          aria-modal={narrow && !sidebar && !modalOpen ? true : undefined}
        >
          <div className="panel-heading">
            <div className="panel-tabs" role="group" aria-label={t('Project views')}>
              <button
                className={panel === 'files' ? 'active' : ''}
                aria-pressed={panel === 'files'}
                onClick={() => setPanel('files')}
              >
                <Icon name="folder" size={15} />
                {t('Files')}
              </button>
              <button
                className={panel === 'diff' ? 'active' : ''}
                aria-pressed={panel === 'diff'}
                onClick={() => setPanel('diff')}
              >
                <Icon name="diff" size={15} />
                {t('Changes')}
                {thread?.diff && <i />}
              </button>
            </div>
            <IconButton
              className="context-close"
              icon="sidebar"
              label={t('Close panel')}
              size={17}
              onClick={dismissContext}
            />
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
                  openFile={openProjectFile}
                  focusPath={diffPath}
                  layout={diffLayout}
                  onLayoutChange={(layout) => {
                    setDiffLayout(layout);
                    save('codes.diff-layout', layout);
                  }}
                />
              ) : (
                <div className="panel-empty">
                  <Icon name="diff" size={30} />
                  <h3>{t('No changes to review')}</h3>
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
              projectArchived={project?.archived}
              directory={directory}
              filePath={filePath}
              narrow={narrow}
              showHidden={showHiddenFiles}
              onShowHiddenChange={(showHiddenFiles) =>
                changePreferences({ ...latestPreferences.current, showHiddenFiles })
              }
              onDirectory={browseDirectory}
              onFile={setFilePath}
              onScopeWarning={showFileScopeWarning}
              onAttach={attachProjectFile}
              onAttachReference={attachProjectReference}
              attachmentBlocked={attachmentBlocked}
            />
          )}
        </aside>
      )}
      {!!fileScopeWarning && (
        <div className="file-scope-toast" role="status">
          {t('Viewing a path outside the usual file scope.')}
        </div>
      )}
      {choosingDirectory && (
        <WorkingDirectoryDialog
          initialPath={project?.path ?? ''}
          close={() => setChoosingDirectory(false)}
          choose={directoryChosen}
        />
      )}
    </div>,
  );
}
createRoot(document.getElementById('root')!).render(<App />);
