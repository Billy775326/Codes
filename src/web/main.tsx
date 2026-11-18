import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  Action,
  Attachment,
  Envelope,
  FileContent,
  Message,
  Operation,
  Project,
  Settings,
  Summary,
  System,
  Thread,
  QueueState,
  QueuePayload,
  Model,
  ReviewTarget,
} from '../shared/types';
import { ApiError, message, post, request } from './api';
import { Feed } from './feed';
import { Brand, Icon } from './primitives';
import { Login } from './Login';
import { Conversations } from './Conversations';
import { QueuePanel } from './QueuePanel';
import {
  PreferencesDialog,
  ReviewDialog,
  StatusDialog,
  type Preferences,
} from './InteractionDialog';
import './interactions.css';
import './workflow.css';
import './style.css';

const labels: Record<string, string> = {
  idle: 'Ready',
  running: 'Working',
  waitingApproval: 'Needs approval',
  waitingInput: 'Needs your input',
  completed: 'Completed',
  interrupted: 'Stopped',
  failed: 'Failed',
  unknown: 'Check result',
};
const saved = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};
const save = (key: string, value: string) => {
  try {
    if (key.startsWith('codes.draft.') && value) {
      const drafts = Object.keys(localStorage).filter(
        (entry) => entry.startsWith('codes.draft.') && entry !== key,
      );
      while (drafts.length >= 20) localStorage.removeItem(drafts.shift()!);
    }
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* Private browsing can disable draft storage. */
  }
};
const MessageView = memo(function MessageView({
  item,
  streaming,
  onReply,
  onFork,
  disabled,
}: {
  onReply?: (item: Message) => void;
  onFork?: (item: Message) => void;
  disabled?: boolean;
  item: Message;
  streaming: boolean;
}) {
  if (item.kind === 'command' || item.kind === 'change')
    return (
      <details className="tool">
        <summary>
          <Icon name={item.kind === 'command' ? 'terminal' : 'review'} />
          {item.kind === 'command' ? 'Command' : 'File changes'}
          <span>{item.status}</span>
        </summary>
        <pre>{item.text}</pre>
      </details>
    );
  return (
    <article
      data-message-id={item.id}
      data-turn-id={item.turnId}
      className={`message ${item.kind}`}
      data-testid={`message-${item.kind}`}
    >
      <div className="message-avatar">{item.kind === 'user' ? 'Y' : <span>c›</span>}</div>
      <div className="message-body">
        <div className="message-label">
          {item.kind === 'user' ? 'You' : 'Codex'}
          {streaming && (
            <span className="thinking">
              Working<span>•••</span>
            </span>
          )}
        </div>
        <div className="prose">
          {streaming ? (
            <div className="stream-text">
              {item.text}
              <span className="caret" />
            </div>
          ) : (
            <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
          )}
        </div>
        {!streaming && item.turnId && (onReply || onFork) && (
          <div className="message-actions">
            {onReply && (
              <button disabled={disabled} onClick={() => onReply(item)}>
                <Icon name="reply" size={13} />
                Reply
              </button>
            )}
            {onFork && (
              <button disabled={disabled} onClick={() => onFork(item)}>
                <Icon name="branch" size={13} />
                Branch from here
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
function Approval({
  action,
  submit,
}: {
  action: Action;
  submit: (
    action: Action,
    input: { decision?: string; answers?: Record<string, string> },
  ) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const answer = async (input: { decision?: string; answers?: Record<string, string> }) => {
    setBusy(true);
    setError('');
    try {
      await submit(action, input);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || action.status !== 'pending';
  return (
    <section className="approval" aria-label={action.title}>
      <div className="approval-heading">
        <span className="approval-dot" />
        <strong>{action.title}</strong>
        <span className="badge">
          {action.kind === 'questions' ? 'ANSWER REQUIRED' : 'REVIEW REQUIRED'}
        </span>
      </div>
      {action.kind !== 'questions' && <pre>{action.detail}</pre>}
      {action.questions?.map((q, index) => (
        <fieldset className="question" key={q.id} disabled={disabled}>
          <legend>
            <small>
              {q.header || 'Question ' + (index + 1)} · {index + 1}/{action.questions!.length}
            </small>
            {q.question}
          </legend>
          {!!q.options?.length && (
            <div className="question-options" role="group" aria-label={'Options for ' + q.question}>
              {q.options.map((option) => (
                <button
                  type="button"
                  key={option.label}
                  aria-pressed={answers[q.id] === option.label}
                  className={answers[q.id] === option.label ? 'selected' : ''}
                  onClick={() => setAnswers({ ...answers, [q.id]: option.label })}
                  disabled={disabled}
                >
                  {option.label}
                  {option.description && <small>{option.description}</small>}
                </button>
              ))}
            </div>
          )}
          {(!q.options?.length || q.allowOther) && (
            <input
              type={q.secret ? 'password' : 'text'}
              autoComplete="off"
              aria-label={q.question}
              value={answers[q.id] ?? ''}
              maxLength={4000}
              onChange={(event) => setAnswers({ ...answers, [q.id]: event.target.value })}
              disabled={disabled}
              placeholder={q.options?.length ? 'Or write your own answer' : 'Your answer'}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.nativeEvent.isComposing &&
                  action.questions?.every((question) => answers[question.id]?.trim())
                ) {
                  event.preventDefault();
                  void answer({ answers });
                }
              }}
            />
          )}
        </fieldset>
      ))}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="approval-actions">
        {action.kind === 'questions' ? (
          <>
            <button
              className="primary"
              disabled={
                disabled ||
                !action.questions?.length ||
                action.questions.some((question) => !answers[question.id]?.trim())
              }
              onClick={() => void answer({ answers })}
            >
              Submit answer
            </button>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => {
                setBusy(true);
                void post('/threads/' + action.threadId + '/interrupt')
                  .catch((error) => setError(message(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Cancel task
            </button>
          </>
        ) : (
          action.decisions.map((decision) => (
            <button
              key={decision}
              className={decision === 'accept' ? 'primary' : 'secondary'}
              disabled={disabled}
              onClick={() => void answer({ decision })}
            >
              {decision === 'accept'
                ? 'Approve once'
                : decision === 'decline'
                  ? 'Decline'
                  : 'Cancel task'}
            </button>
          ))
        )}
        {action.status === 'responding' && <span>Waiting for Codex…</span>}
      </div>
    </section>
  );
}

function App() {
  const [auth, setAuth] = useState<'loading' | 'login' | 'ready'>('loading');
  const [token, setToken] = useState('');
  const [system, setSystem] = useState<System>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(saved('codes.project'));
  const [threads, setThreads] = useState<Summary[]>([]);
  const [threadId, setThreadId] = useState(saved('codes.thread'));
  const [thread, setThread] = useState<Thread>();
  const [models, setModels] = useState<Model[]>([]);
  const [modes, setModes] = useState<{ mode?: 'default' | 'plan'; name: string }[]>([]);
  const [dialog, setDialog] = useState<'preferences' | 'review' | 'status'>();
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try {
      const value = JSON.parse(saved('codes.preferences') || '{}');
      return {
        followUp: ['steer', 'interrupt'].includes(value.followUp) ? 'steer' : 'queue',
        enter: ['enter', 'cmdIfMultiline', 'cmdAlways'].includes(value.enter)
          ? value.enter
          : 'enter',
        review: value.review === 'detached' ? 'detached' : 'inline',
      };
    } catch {
      return { followUp: 'queue', enter: 'enter', review: 'inline' };
    }
  });
  const [steerReceipt, setSteerReceipt] = useState<{ operationId: string; text: string }>();
  const threadRef = useRef(threadId);
  threadRef.current = threadId;
  const modelControl = useRef<HTMLSelectElement>(null);
  const effortControl = useRef<HTMLSelectElement>(null);
  const permissionControl = useRef<HTMLSelectElement>(null);
  const [settings, setSettings] = useState<Settings>({ permission: 'read-only' });
  const [draft, setDraft] = useState('');
  const [queueRequest, setQueueRequest] = useState<{
    operationId: string;
    payload: QueuePayload;
  }>();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [forking, setForking] = useState<Message>();
  const [forkBusy, setForkBusy] = useState(false);
  const forkOperations = useRef(new Map<string, string>());
  const [forkError, setForkError] = useState('');
  const composer = useRef<HTMLTextAreaElement>(null);
  const queueRevision = useRef(0);
  const queueRevisionAtRender = queueRevision.current;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('Connecting');
  const [retry, setRetry] = useState(0);
  const [sidebar, setSidebar] = useState(false);
  const [panel, setPanel] = useState<'files' | 'diff' | null>(null);
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [directory, setDirectory] = useState('');
  const [files, setFiles] = useState<{ path: string; name: string; directory: boolean }[]>([]);
  const [file, setFile] = useState<FileContent>();
  const [range, setRange] = useState<[number, number]>([1, 1]);
  const [receipt, setReceipt] = useState('');
  const feed = useRef<Feed | undefined>(undefined);
  const transcript = useRef<HTMLDivElement>(null);
  const historyAnchor = useRef<{ height: number; top: number } | undefined>(undefined);
  const follow = useRef(true);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const notice = (e: unknown) => {
    setError(message(e));
    if (e instanceof ApiError && e.code === 'AUTH_REQUIRED') setAuth('login');
  };
  const init = async () => {
    try {
      const [system, projects] = await Promise.all([
        request<System>('/system'),
        request<Project[]>('/projects'),
      ]);
      setSystem(system);
      setProjects(projects);
      if (!projects.some((p) => p.id === projectId)) setProjectId(projects[0]?.id ?? '');
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
    return () => controller.abort();
  }, [auth]);
  useEffect(() => {
    setThreads([]);
    setThread(undefined);
    setDirectory('');
    setFile(undefined);
    setAttachments([]);
    save('codes.project', projectId);
    if (!projectId || auth !== 'ready' || !threadId) return;
    const controller = new AbortController();
    void request<Summary[]>(`/projects/${projectId}/threads`, {}, controller.signal)
      .then((list) => {
        setThreads(list);
      })
      .catch((e) => {
        if (!controller.signal.aborted) notice(e);
      });
    return () => controller.abort();
  }, [projectId, auth]);
  useEffect(() => {
    if (!projectId || threadId || auth !== 'ready') return;
    const stream = new Feed<{ threads: Summary[]; cursor: { seq: number; epoch: string } }>(
      projectId,
      (snapshot) => setThreads(snapshot.threads),
      (event) => {
        if (event.kind === 'summary') {
          const summary = event.data as Summary;
          if (summary.projectId === projectId)
            setThreads((list) =>
              [summary, ...list.filter((x) => x.id !== summary.id)].slice(0, 200),
            );
        } else if (event.kind === 'runtime') setSystem(event.data as System);
      },
      setConnection,
      'projects',
    );
    void stream.connect();
    const focus = () => {
      if (document.visibilityState === 'visible') void stream.connect();
    };
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('online', focus);
    return () => {
      stream.close();
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('online', focus);
    };
  }, [projectId, threadId, auth, retry]);
  const select = useCallback((id: string) => {
    setThread((current) => (current?.id === id ? current : undefined));
    setThreadId(id);
    setSidebar(false);
    follow.current = true;
  }, []);
  const conversationUpdated = useCallback((value: Summary) => {
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
    };
    setThreads((list) => [summary, ...list.filter((row) => row.id !== summary.id)].slice(0, 200));
    setThread((current) => (current?.id === summary.id ? { ...current, ...summary } : current));
  }, []);
  useEffect(() => {
    queueRevision.current++;
    save('codes.thread', threadId);
    setDraft(saved(`codes.draft.${threadId || 'new'}`).slice(0, 50_000));
    setReceipt(threadId ? saved(`codes.operation.${threadId}`) : '');
    try {
      const stored = saved('codes.queue-request.' + threadId);
      setQueueRequest(stored ? JSON.parse(stored) : undefined);
    } catch {
      setQueueRequest(undefined);
    }
    setAttachments([]);
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
      if (e.kind === 'runtime') {
        setSystem(e.data as System);
        return;
      }
      if (e.kind === 'summary') {
        const summary = e.data as Summary;
        if (summary.projectId === projectRef.current)
          setThreads((list) => [summary, ...list.filter((x) => x.id !== summary.id)].slice(0, 200));
        return;
      }
      if (e.threadId !== threadId) return;
      if (e.kind === 'text') {
        const d = e.data as { id: string; delta: string };
        deltas.set(d.id, (deltas.get(d.id) ?? '') + d.delta);
        flushTimer ??= setTimeout(flush, 32);
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
            ).slice(-240),
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
        deltas.clear();
        queueRevision.current++;
        setThread(snapshot.thread);
        // Project summaries may arrive while subscriptions switch. The selected
        // snapshot is also the authoritative summary for the navigation list.
        conversationUpdated(snapshot.thread);
        setSettings(snapshot.thread.settings);
      },
      event,
      setConnection,
    );
    feed.current = stream;
    void stream.connect();
    const focus = () => {
      if (document.visibilityState === 'visible') void stream.connect();
    };
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('online', focus);
    return () => {
      stream.close();
      clearTimeout(flushTimer);
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('online', focus);
    };
  }, [threadId, retry, auth]);
  useLayoutEffect(() => {
    if (historyAnchor.current && transcript.current) {
      transcript.current.scrollTop =
        historyAnchor.current.top + transcript.current.scrollHeight - historyAnchor.current.height;
      historyAnchor.current = undefined;
    }
  }, [thread?.messages]);
  useEffect(() => {
    if (follow.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [thread?.messages, thread?.actions, thread?.state]);
  useEffect(() => {
    if (!projectId || panel !== 'files') return;
    const controller = new AbortController();
    void request<typeof files>(
      `/projects/${projectId}/files?path=${encodeURIComponent(directory)}`,
      {},
      controller.signal,
    )
      .then(setFiles)
      .catch((e) => {
        if (!controller.signal.aborted) notice(e);
      });
    return () => controller.abort();
  }, [projectId, directory, panel]);
  const changeDraft = (value: string) => {
    setDraft(value);
    save(`codes.draft.${threadId || 'new'}`, value.slice(0, 50_000));
  };
  const reply = (item: Message) => {
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
    if (quote.length + draft.length > 50_000) {
      setError('Shorten the current draft before adding this quote.');
      return;
    }
    changeDraft(quote + draft);
    composer.current?.focus();
  };
  const enqueue = async () => {
    if (!threadId || busy || !draft.trim() || thread?.archived || thread?.managementPending) return;
    setBusy(true);
    setError('');
    const key = 'codes.queue-request.' + threadId;
    const payload = { text: draft, settings, attachments };
    let operationId = crypto.randomUUID();
    try {
      const previous = queueRequest ?? (saved(key) ? JSON.parse(saved(key)) : undefined);
      if (previous) {
        const record = previous;
        if (JSON.stringify(record.payload) !== JSON.stringify(payload))
          throw new Error('Check the pending queue receipt before changing this draft.');
        operationId = record.operationId;
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
      save('codes.draft.' + threadId, '');
      setDraft('');
      setAttachments([]);
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
      if (
        JSON.stringify({ text: draft, settings, attachments }) ===
        JSON.stringify(queueRequest.payload)
      ) {
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
      setForking(undefined);
      select(created.id);
      setSettings({ ...settings, permission: 'read-only' });
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
  const newThread = () => {
    select('');
    setSettings({ ...settings, permission: 'read-only' });
    setError('');
  };
  const send = async () => {
    if (draft.trimStart().startsWith('/')) {
      runCommand(draft.trim());
      return;
    }
    if (
      busy ||
      queueRequest ||
      !draft.trim() ||
      !projectId ||
      thread?.archived ||
      thread?.managementPending
    )
      return;
    setBusy(true);
    setError('');
    let id = threadId;
    let operationId = '';
    try {
      if (!id) {
        const created = await post<Thread>(`/projects/${projectId}/threads`, settings);
        id = created.id;
        save(`codes.draft.${id}`, draft);
        setThreads((list) => [created, ...list]);
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
      save(`codes.draft.${id}`, '');
      save('codes.draft.new', '');
      setDraft('');
      setAttachments([]);
      follow.current = true;
      if (operation.state === 'completed') {
        save(`codes.operation.${id}`, '');
        setReceipt('');
      }
      if (feed.current && threadId === id) void feed.current.connect();
    } catch (e) {
      notice(e);
      if (id && e instanceof ApiError && !e.uncertain) {
        save(`codes.operation.${id}`, '');
        setReceipt('');
      }
    } finally {
      setBusy(false);
    }
  };
  const reconcile = async () => {
    if (!threadId) return;
    setBusy(true);
    try {
      if (receipt) {
        try {
          await request<Operation>(`/operations/${receipt}`);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'NOT_FOUND') {
            save(`codes.operation.${threadId}`, '');
            setReceipt('');
            setError('This request was not recorded. Your draft is safe; you may send it again.');
            return;
          }
          throw e;
        }
      }
      const updated = await post<Thread>(`/threads/${threadId}/reconcile`);
      setThread(updated);
      if (!updated.pending) {
        save(`codes.operation.${threadId}`, '');
        setReceipt('');
      } else
        setError(
          'The CLI has not confirmed a terminal result. This conversation remains locked against duplicate sends.',
        );
    } catch (e) {
      notice(e);
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
  const addProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const project = await post<Project>('/projects', { path: newPath });
      setProjects((list) => (list.some((x) => x.id === project.id) ? list : [...list, project]));
      setThreadId('');
      setProjectId(project.id);
      setAdding(false);
      setNewPath('');
      setError('');
    } catch (e) {
      notice(e);
    } finally {
      setBusy(false);
    }
  };
  const openFile = async (path: string) => {
    try {
      const file = await request<FileContent>(
        `/projects/${projectId}/file?path=${encodeURIComponent(path)}`,
      );
      setFile(file);
      setRange([1, Math.min(file.lines, 50)]);
    } catch (e) {
      notice(e);
    }
  };
  const attach = () => {
    if (!file || attachments.length >= 4) return;
    setAttachments((list) => [
      ...list.filter((x) => x.path !== file.path),
      { path: file.path, sha: file.sha, fromLine: Math.min(...range), toLine: Math.max(...range) },
    ]);
  };
  const active =
    !!thread?.pending ||
    !!thread?.steering?.length ||
    (!!thread && ['running', 'waitingApproval', 'waitingInput', 'unknown'].includes(thread.state));
  const project = projects.find((x) => x.id === projectId);
  const canSteer =
    !!thread?.turnId &&
    thread.state === 'running' &&
    thread.pending?.state !== 'unknown' &&
    thread.pending?.kind !== 'review' &&
    !thread.archived &&
    !thread.managementPending;
  const selectedModel =
    models.find(
      (entry) =>
        entry.id === (settings.model || thread?.resolvedModel) ||
        entry.model === (settings.model || thread?.resolvedModel),
    ) ??
    (!settings.model && !thread?.resolvedModel
      ? models.find((entry) => entry.isDefault)
      : undefined);
  const commands = [
    { name: '/model', detail: 'Choose a model', run: () => modelControl.current?.focus() },
    {
      name: '/reasoning',
      detail: 'Set reasoning effort',
      run: () => effortControl.current?.focus(),
    },
    {
      name: '/plan',
      detail: 'Toggle Plan and Code mode',
      run: () => {
        if (active) throw new Error('Finish the current task before changing modes.');
        setSettings({ ...settings, mode: settings.mode === 'plan' ? 'default' : 'plan' });
      },
    },
    { name: '/review', detail: 'Start a native code review', run: () => setDialog('review') },
    { name: '/status', detail: 'Connection, model and usage', run: () => setDialog('status') },
    {
      name: '/approve',
      detail: 'Choose task permissions',
      run: () => permissionControl.current?.focus(),
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
    if (busy || !canSteer || !draft.trim() || steerReceipt || queueRequest) return;
    if (draft.trimStart().startsWith('/')) {
      runCommand(draft.trim());
      return;
    }
    const id = threadId;
    const text = draft;
    const record = { operationId: crypto.randomUUID(), text };
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
      save('codes.draft.' + id, '');
      if (threadRef.current === id) {
        setSteerReceipt(undefined);
        setDraft('');
        setAttachments([]);
      }
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
    setBusy(true);
    setError('');
    try {
      let result = await request<Operation>('/operations/' + steerReceipt.operationId);
      if (result.state === 'unknown' || result.state === 'dispatching') {
        const updated = await post<Thread>('/threads/' + threadId + '/reconcile');
        setThread(updated);
        result = await request<Operation>('/operations/' + steerReceipt.operationId);
        if (result.state === 'unknown' || result.state === 'dispatching')
          throw new Error('Follow-up acceptance is still unconfirmed. It will not be resent.');
      }
      if (result.state !== 'failed' && draft === steerReceipt.text) {
        changeDraft('');
        setAttachments([]);
      }
      save('codes.steer.' + threadId, '');
      setSteerReceipt(undefined);
      if (result.state === 'failed')
        setError(result.error || 'The follow-up was rejected. Your draft is safe.');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NOT_FOUND') {
        save('codes.steer.' + threadId, '');
        setSteerReceipt(undefined);
        setError('The follow-up was not recorded. Your draft is safe.');
      } else notice(error);
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
        !document.querySelector('[role="dialog"]') &&
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
  const loadOlder = async () => {
    if (!thread?.olderCursor) return;
    setBusy(true);
    try {
      const page = await request<{ messages: Message[]; olderCursor: string | null }>(
        `/threads/${threadId}/history?cursor=${encodeURIComponent(thread.olderCursor)}`,
      );
      follow.current = false;
      if (transcript.current)
        historyAnchor.current = {
          height: transcript.current.scrollHeight,
          top: transcript.current.scrollTop,
        };
      setThread(
        (t) =>
          t && {
            ...t,
            olderCursor: page.olderCursor,
            messages: [...page.messages, ...t.messages]
              .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
              .slice(0, 240),
          },
      );
    } catch (e) {
      notice(e);
    } finally {
      setBusy(false);
    }
  };
  if (auth !== 'ready')
    return (
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
            .catch(notice)
            .finally(() => setBusy(false));
        }}
      />
    );
  return (
    <div className={`app ${panel ? 'has-panel' : ''}`}>
      {sidebar && <div className="scrim" onClick={() => setSidebar(false)} />}
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setSidebar(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="workspace-label">
          WORKSPACE
          <button className="icon-button" aria-label="Add project" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} />
          </button>
        </div>
        <label className="project-select">
          <Icon name="folder" />
          <select
            aria-label="Project"
            disabled={busy}
            value={projectId}
            onChange={(e) => {
              setThreadId('');
              setProjectId(e.target.value);
            }}
          >
            {!projectId && <option value="">Choose a project</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="new-thread"
          aria-label="New conversation"
          disabled={busy}
          onClick={newThread}
        >
          <Icon name="plus" />
          New conversation<span>↵</span>
        </button>
        <Conversations
          projectId={projectId}
          selectedId={threadId}
          updates={threads}
          disabled={busy}
          onSelect={select}
          onUpdated={conversationUpdated}
        />
        <div className="sidebar-footer">
          <div className="host-symbol">
            <Icon name="terminal" size={17} />
          </div>
          <div>
            <strong>Self-hosted workspace</strong>
            <small>{system?.runtime === 'mock' ? 'Simulation runtime' : 'Codex CLI · Linux'}</small>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={() =>
              void post('/logout')
                .then(() => {
                  feed.current?.close();
                  setAuth('login');
                })
                .catch(notice)
            }
          >
            <Icon name="logout" size={16} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-only"
            aria-label="Open navigation"
            onClick={() => setSidebar(true)}
          >
            <Icon name="menu" />
          </button>
          <div className="breadcrumb">
            <Icon name="folder" size={16} />
            <span>{project?.name ?? 'Workspace'}</span>
            <span className="slash">/</span>
            <strong>{thread?.title ?? 'New conversation'}</strong>
          </div>
          <div className="top-actions">
            {system?.runtime === 'mock' && <span className="simulation">Simulation</span>}
            <button
              className={`connection ${connection === 'Connected' || connection === 'Ready' ? 'connected' : ''}`}
              onClick={() => setRetry((n) => n + 1)}
              title="Reconnect"
            >
              <i />
              {connection}
            </button>
            <span className="divider" />
            <button
              aria-label="Browse files"
              className={`icon-button ${panel === 'files' ? 'selected' : ''}`}
              onClick={() => setPanel(panel === 'files' ? null : 'files')}
            >
              <Icon name="file" />
            </button>
            <button
              aria-label="Review changes"
              className={`icon-button ${panel === 'diff' ? 'selected' : ''}`}
              onClick={() => setPanel(panel === 'diff' ? null : 'diff')}
            >
              <Icon name="review" />
            </button>
          </div>
        </header>
        {system?.runtime === 'mock' && (
          <div className="simulation-strip">
            <span>DEMO WORKSPACE</span>Responses are simulated. No models, commands, or file changes
            are executed.
          </div>
        )}
        {thread?.forkedFromId && (
          <div className="branch-origin">
            <Icon name="branch" size={14} />
            <span>Conversation branch</span>
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
              Open source conversation
            </button>
          </div>
        )}
        {(thread?.archived || thread?.managementPending) && (
          <div className="conversation-lock-banner" role="status">
            <span>
              <Icon name="archive" size={14} />
              {thread.managementPending
                ? 'A conversation change needs confirmation. Check its status before sending.'
                : 'This conversation is archived. Restore it to continue.'}
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
              {thread.managementPending ? 'Check status' : 'Restore conversation'}
            </button>
          </div>
        )}
        <div
          className="conversation"
          ref={transcript}
          onScroll={(e) => {
            const el = e.currentTarget;
            follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
        >
          <div className="conversation-inner">
            {!thread?.messages.length && !active ? (
              <section className="welcome">
                <div className="welcome-mark">
                  c<span>›</span>
                  <i />
                </div>
                <p className="eyebrow">A PLACE TO BUILD</p>
                <h1>What are we working on?</h1>
                <p>
                  Explore your code, shape an idea, or ship a focused change.
                  <br />
                  Your workspace is ready when you are.
                </p>
                <div className="suggestions">
                  {[
                    {
                      title: 'Explore this project',
                      text: 'Explain the architecture of this project and its main entry points.',
                      icon: 'folder',
                      detail: 'Find your way around the code',
                    },
                    {
                      title: 'Plan a change',
                      text: 'Review this project and help me plan a small, verifiable improvement.',
                      icon: 'review',
                      detail: 'Turn an idea into clear next steps',
                    },
                    {
                      title: system?.runtime === 'mock' ? 'Try an approval' : 'Review the code',
                      text:
                        system?.runtime === 'mock'
                          ? '[approve] Show an example command approval.'
                          : 'Review the current code for potential bugs and explain your findings.',
                      icon: 'terminal',
                      detail:
                        system?.runtime === 'mock'
                          ? 'Preview the review workflow'
                          : 'Look for issues that matter',
                    },
                  ].map((s) => (
                    <button key={s.title} onClick={() => changeDraft(s.text)}>
                      <Icon name={s.icon} />
                      <strong>{s.title}</strong>
                      <span>{s.detail}</span>
                      <span className="suggestion-arrow">↗</span>
                    </button>
                  ))}
                </div>
                {!projectId && (
                  <button className="primary add-first" onClick={() => setAdding(true)}>
                    <Icon name="plus" />
                    Add your first project
                  </button>
                )}
              </section>
            ) : (
              <>
                {thread?.olderCursor && (
                  <button
                    className="older"
                    disabled={busy || thread.messages.length >= 240}
                    onClick={() => void loadOlder()}
                  >
                    {thread.messages.length >= 240
                      ? 'Display limit reached · reopen to see latest'
                      : 'Load earlier messages'}
                  </button>
                )}
                {thread?.messages.map((m) => (
                  <MessageView
                    key={m.id}
                    item={m}
                    onReply={thread.archived ? undefined : reply}
                    onFork={
                      !active || m.turnId !== thread.turnId
                        ? m.kind === 'assistant'
                          ? (item) => {
                              setForking(item);
                              setForkError('');
                            }
                          : undefined
                        : undefined
                    }
                    disabled={busy || forkBusy || thread.managementPending}
                    streaming={
                      m.kind === 'assistant' &&
                      (m.turnId === thread.turnId ||
                        (thread.pending?.kind === 'review' &&
                          m.turnId === thread.pending.turnId)) &&
                      ['running', 'waitingApproval', 'waitingInput'].includes(thread.state)
                    }
                  />
                ))}
                {thread?.pending &&
                  !thread.messages.some((m) => m.clientId === thread.pending?.id) && (
                    <MessageView
                      item={{
                        id: thread.pending.id,
                        turnId: '',
                        kind: 'user',
                        text: thread.pending.text,
                      }}
                      streaming={false}
                    />
                  )}
                {thread?.actions
                  .filter((a) => a.status === 'pending' || a.status === 'responding')
                  .map((action) => (
                    <Approval key={action.id} action={action} submit={submitAction} />
                  ))}
                {thread?.plan && (
                  <section className="turn-plan" aria-label="Task plan">
                    <strong>Plan</strong>
                    {thread.plan.explanation && <p>{thread.plan.explanation}</p>}
                    <ol>
                      {thread.plan.steps.map((entry, index) => (
                        <li key={index}>
                          <small>
                            {entry.status === 'completed'
                              ? 'Done'
                              : entry.status === 'inProgress'
                                ? 'In progress'
                                : 'Pending'}
                          </small>
                          {entry.step}
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
                {thread && (
                  <div className={`turn-status ${thread.state}`}>
                    <span className={`status-dot ${thread.state}`} />
                    {labels[thread.state]}
                    {thread.state === 'unknown' && (
                      <span> · Execution outcome needs confirmation.</span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <div className="composer-area">
          {steerReceipt && (
            <div className="recovery">
              <span>An immediate follow-up needs confirmation.</span>
              <button disabled={busy} onClick={() => void checkSteer()}>
                Check follow-up receipt
              </button>
            </div>
          )}
          {!!thread?.steering?.length && (
            <section className="steering-receipt" aria-label="Immediate follow-ups">
              {thread.steering.map((entry) => (
                <p key={entry.id}>
                  {entry.state === 'unknown'
                    ? 'Check result'
                    : entry.state === 'acknowledged'
                      ? 'Added to current task'
                      : 'Sending follow-up'}{' '}
                  · {entry.text.slice(0, 200)}
                </p>
              ))}
              <button disabled={busy} onClick={() => void reconcile()}>
                Check follow-up results
              </button>
            </section>
          )}
          {queueRequest && (
            <div className="recovery">
              <span>A queue receipt needs confirmation. Check before sending another message.</span>
              <button disabled={busy} onClick={() => void checkQueueReceipt()}>
                Check queue receipt
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  changeDraft(queueRequest.payload.text);
                  setSettings(queueRequest.payload.settings);
                  setAttachments(queueRequest.payload.attachments);
                }}
              >
                Restore pending draft
              </button>
            </div>
          )}
          {thread?.queue && (
            <QueuePanel
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
            />
          )}

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          )}
          {(thread?.state === 'unknown' || (receipt && !thread?.pending)) && (
            <div className="recovery">
              <span>A request may still be running. Check before continuing.</span>
              <button disabled={busy} onClick={() => void reconcile()}>
                Check result
              </button>
            </div>
          )}
          {draft.startsWith('/') && !draft.includes('\n') && (
            <div className="slash-commands" role="group" aria-label="Commands">
              {commands
                .filter((entry) => entry.name.startsWith(draft.split(/\s+/)[0] ?? ''))
                .map((entry) => (
                  <button key={entry.name} onClick={() => runCommand(entry.name)}>
                    <strong>{entry.name}</strong>
                    <span>{entry.detail}</span>
                  </button>
                ))}
            </div>
          )}
          <div className={`composer ${active ? 'is-active' : ''}`}>
            {attachments.length > 0 && (
              <div className="attachments">
                {attachments.map((a) => (
                  <span key={a.path}>
                    <Icon name="file" size={13} />
                    {a.path}:{a.fromLine}–{a.toLine}
                    <button
                      aria-label={`Remove ${a.path}`}
                      onClick={() => setAttachments((list) => list.filter((x) => x !== a))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              aria-label="Message Codex"
              ref={composer}
              value={draft}
              readOnly={!!thread?.archived || !!thread?.managementPending}
              onChange={(e) => changeDraft(e.target.value)}
              placeholder={
                thread?.archived
                  ? 'Restore this conversation to continue…'
                  : thread?.managementPending
                    ? 'Check conversation status to continue…'
                    : active
                      ? 'Write your next thought…'
                      : 'Ask Codex to explore, build, or fix something…'
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
              <button
                className="icon-button"
                aria-label="Attach file context"
                onClick={() => setPanel('files')}
                disabled={!projectId}
              >
                <Icon name="attach" size={17} />
              </button>
              <select
                aria-label="Model"
                ref={modelControl}
                value={settings.model ?? ''}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    model: e.target.value || undefined,
                    effort: undefined,
                  })
                }
                disabled={active}
              >
                <option value="">Default model</option>
                {settings.model && !models.some((entry) => entry.id === settings.model) && (
                  <option value={settings.model}>{settings.model}</option>
                )}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <span className="toolbar-divider" />
              <select
                aria-label="Permissions"
                ref={permissionControl}
                value={settings.permission}
                onChange={(e) =>
                  setSettings({ ...settings, permission: e.target.value as Settings['permission'] })
                }
                disabled={active}
              >
                <option value="read-only">Read only</option>
                <option value="workspace-write">Workspace write</option>
              </select>
              <div className="toolbar-spacer" />
              <div className="composer-dispatch-actions">
                {(active || !!thread?.queue?.items.length) && (
                  <button
                    className="queue-send"
                    aria-label={
                      active && preferences.followUp === 'steer'
                        ? 'Send follow-up now'
                        : 'Queue message'
                    }
                    disabled={
                      busy ||
                      !!steerReceipt ||
                      !!queueRequest ||
                      (active && preferences.followUp === 'steer' && !canSteer) ||
                      !draft.trim() ||
                      !!thread?.archived ||
                      !!thread?.managementPending ||
                      (!!thread?.queue && thread.queue.items.length >= 10)
                    }
                    onClick={() => followUp()}
                  >
                    <Icon name="plus" size={14} />
                    {active && preferences.followUp === 'steer' ? 'Send now' : 'Queue'}
                  </button>
                )}
                {active ? (
                  <button
                    className="stop-button"
                    aria-label="Stop task"
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
                    Stop
                  </button>
                ) : (
                  <button
                    className="send-button"
                    aria-label="Send message"
                    onClick={() => void send()}
                    disabled={
                      busy ||
                      !draft.trim() ||
                      !projectId ||
                      !!receipt ||
                      !!queueRequest ||
                      !!steerReceipt ||
                      !!thread?.queue?.items.length ||
                      !!thread?.archived ||
                      !!thread?.managementPending
                    }
                  >
                    <Icon name="arrow" size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="interaction-controls">
            <select
              aria-label="Mode"
              value={settings.mode ?? 'default'}
              disabled={active || !modes.length}
              onChange={(event) =>
                setSettings({ ...settings, mode: event.target.value as Settings['mode'] })
              }
            >
              {modes
                .filter((entry) => entry.mode)
                .map((entry) => (
                  <option key={entry.mode} value={entry.mode}>
                    {entry.mode === 'plan' ? 'Plan' : 'Code'}
                  </option>
                ))}
            </select>
            <select
              ref={effortControl}
              aria-label="Reasoning effort"
              value={settings.effort ?? ''}
              disabled={active || !selectedModel}
              onChange={(event) =>
                setSettings({ ...settings, effort: event.target.value || undefined })
              }
            >
              <option value="">
                Model default{selectedModel ? ' · ' + selectedModel.defaultReasoningEffort : ''}
              </option>
              {settings.effort &&
                !selectedModel?.supportedReasoningEfforts.some(
                  (entry) => entry.reasoningEffort === settings.effort,
                ) && <option value={settings.effort}>{settings.effort} (unavailable)</option>}
              {selectedModel?.supportedReasoningEfforts.map((entry) => (
                <option
                  key={entry.reasoningEffort}
                  value={entry.reasoningEffort}
                  title={entry.description}
                >
                  {entry.reasoningEffort}
                </option>
              ))}
            </select>
            <button onClick={() => setDialog('review')} disabled={!projectId || busy}>
              Review code
            </button>
            <button onClick={() => setDialog('status')}>Session status</button>
            <button onClick={() => setDialog('preferences')}>Interaction settings</button>
          </div>
          <div className="composer-hint">
            <span>
              <i />
              {active
                ? 'Your task continues when this page is closed.'
                : 'Codex runs in your project on the host.'}
            </span>
            <span className="desktop-hint">
              {preferences.enter === 'enter' ? '↵ Send' : 'Ctrl/Cmd ↵ Send'} <span>·</span> ⇧ ↵ New
              line
            </span>
          </div>
        </div>
      </div>
      {dialog === 'preferences' && (
        <PreferencesDialog
          value={preferences}
          close={() => setDialog(undefined)}
          change={(value) => {
            setPreferences(value);
            save('codes.preferences', JSON.stringify(value));
          }}
        />
      )}
      {dialog === 'review' && (
        <ReviewDialog
          close={() => setDialog(undefined)}
          submit={startReview}
          delivery={preferences.review}
          inlineAvailable={
            !!threadId &&
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
          thread={thread}
          settings={settings}
          connection={connection}
          close={() => setDialog(undefined)}
        />
      )}
      {forking && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fork-title"
            onSubmit={(event) => {
              event.preventDefault();
              void fork();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !forkBusy) setForking(undefined);
              if (event.key === 'Tab') {
                const buttons = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    'button:not(:disabled)',
                  ),
                ];
                if (event.shiftKey && document.activeElement === buttons[0]) {
                  event.preventDefault();
                  buttons.at(-1)?.focus();
                } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
                  event.preventDefault();
                  buttons[0]?.focus();
                }
              }
            }}
          >
            <h2 id="fork-title">Branch from this turn?</h2>
            <p>
              Copy the conversation through this completed turn into a new conversation. Later turns
              and queued messages stay in the source conversation. Both conversations use the
              current project files; files are not copied or rolled back. The branch starts in Read
              only.
            </p>
            {forkError && (
              <p className="fork-error" role="alert">
                {forkError}
              </p>
            )}
            <div className="conversation-confirm-actions">
              <button
                type="button"
                className="secondary"
                autoFocus
                disabled={forkBusy}
                onClick={() => setForking(undefined)}
              >
                Cancel
              </button>
              <button className="primary" disabled={forkBusy}>
                {forkBusy ? 'Creating branch…' : 'Create branch'}
              </button>
            </div>
          </form>
        </div>
      )}
      {panel && (
        <aside className="context-panel">
          <div className="panel-heading">
            <div className="panel-tabs">
              <button
                className={panel === 'files' ? 'active' : ''}
                onClick={() => setPanel('files')}
              >
                Files
              </button>
              <button className={panel === 'diff' ? 'active' : ''} onClick={() => setPanel('diff')}>
                Changes{thread?.diff && <i />}
              </button>
            </div>
            <button className="icon-button" aria-label="Close panel" onClick={() => setPanel(null)}>
              <Icon name="close" size={16} />
            </button>
          </div>
          {panel === 'diff' ? (
            <div className="diff-panel">
              {thread?.diff ? (
                <pre>
                  {thread.diff.split('\n').map((line, i) => (
                    <span
                      key={i}
                      className={
                        line.startsWith('+') ? 'addition' : line.startsWith('-') ? 'deletion' : ''
                      }
                    >
                      {line}
                      {'\n'}
                    </span>
                  ))}
                </pre>
              ) : (
                <div className="panel-empty">
                  <Icon name="review" size={30} />
                  <h3>No changes to review</h3>
                  <p>
                    Changes from the current turn
                    <br />
                    will appear here.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="file-breadcrumb">
                <button
                  onClick={() => {
                    setDirectory('');
                    setFile(undefined);
                  }}
                >
                  {project?.name ?? 'Project'}
                </button>
                {directory && (
                  <>
                    <span>/</span>
                    <button
                      onClick={() => setDirectory(directory.split('/').slice(0, -1).join('/'))}
                    >
                      {directory}
                    </button>
                  </>
                )}
              </div>
              <div className="file-list">
                {files.map((f) => (
                  <button
                    className={file?.path === f.path ? 'active' : ''}
                    key={f.path}
                    onClick={() =>
                      f.directory
                        ? (setDirectory(f.path), setFile(undefined))
                        : void openFile(f.path)
                    }
                  >
                    <Icon name={f.directory ? 'folder' : 'file'} size={15} />
                    {f.name}
                    {f.directory && <Icon name="chevron" size={12} />}
                  </button>
                ))}
                {!files.length && <p className="muted">No visible files.</p>}
              </div>
              {file ? (
                <div className="file-preview">
                  <div className="file-title">
                    <Icon name="file" size={14} />
                    {file.path}
                    <span>READ ONLY</span>
                  </div>
                  <div className="file-lines">
                    {file.text.split('\n').map((line, i) => (
                      <button
                        key={i}
                        className={
                          i + 1 >= Math.min(...range) && i + 1 <= Math.max(...range)
                            ? 'highlighted'
                            : ''
                        }
                        onClick={(e) => setRange(e.shiftKey ? [range[0], i + 1] : [i + 1, i + 1])}
                      >
                        <span>{i + 1}</span>
                        <code>{line || ' '}</code>
                      </button>
                    ))}
                  </div>
                  <div className="selection-toolbar">
                    <span>
                      Lines {Math.min(...range)}–{Math.max(...range)}
                    </span>
                    <button
                      onClick={() => {
                        if (file)
                          setAttachments((list) => [
                            ...list.filter((entry) => entry.path !== file.path),
                            { path: file.path, sha: file.sha, fromLine: 1, toLine: file.lines },
                          ]);
                      }}
                      disabled={attachments.length >= 4}
                    >
                      Attach file
                    </button>
                    <button className="primary" onClick={attach} disabled={attachments.length >= 4}>
                      Attach selection
                    </button>
                  </div>
                  <small className="selection-hint">
                    Click a line, then Shift-click to select a range.
                  </small>
                </div>
              ) : (
                <div className="panel-empty">
                  <Icon name="file" size={28} />
                  <p>
                    Open a file to add context.
                    <br />
                    Files stay on your server.
                  </p>
                </div>
              )}
            </>
          )}
        </aside>
      )}
      {adding && (
        <div className="modal-backdrop" onClick={() => setAdding(false)}>
          <form
            className="modal"
            onSubmit={(e) => void addProject(e)}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>Add a project</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => setAdding(false)}
              >
                <Icon name="close" />
              </button>
            </div>
            <p>Choose an existing directory on the Linux host.</p>
            <label htmlFor="project-path">Absolute directory path</label>
            <input
              id="project-path"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="/home/you/projects/my-project"
              autoFocus
              required
            />
            <small>Codex uses this directory as its workspace.</small>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy || !newPath.trim()}>
              Add project
              <Icon name="plus" size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
