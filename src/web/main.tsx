import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
} from '../shared/types';
import { ApiError, message, post, request } from './api';
import { Feed } from './feed';
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
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    file: (
      <>
        <path d="M14 3H6v18h12V7Z" />
        <path d="M14 3v5h5M9 12h6m-6 4h6" />
      </>
    ),
    folder: <path d="M3 7V5h7l2 2h9v13H3Z" />,
    review: (
      <>
        <path d="M8 3H4v18h4M16 3h4v18h-4M9 8h6m-3-3v6m-3 5h6" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    attach: <path d="m8 12 6-6a4 4 0 0 1 6 6l-8 8a6 6 0 0 1-8-8l8-8m-5 11 8-8" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    terminal: (
      <>
        <path d="m4 5 6 7-6 7m9 0h7" />
      </>
    ),
    logout: (
      <>
        <path d="M10 4H4v16h6m-1-8h12m-4-4 4 4-4 4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.file}
    </svg>
  );
}
function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        c<span>›</span>
      </span>
      codes<span className="brand-tag">WORKSPACE</span>
    </span>
  );
}
const MessageView = memo(function MessageView({
  item,
  streaming,
}: {
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
    <article className={`message ${item.kind}`} data-testid={`message-${item.kind}`}>
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
        <span className="badge">REVIEW REQUIRED</span>
      </div>
      <pre>{action.detail}</pre>
      {action.questions?.map((q) => (
        <label className="question" key={q.id}>
          {q.question}
          {q.options && (
            <div className="question-options">
              {q.options.map((option) => (
                <button
                  key={option.label}
                  className={answers[q.id] === option.label ? 'selected' : ''}
                  onClick={() => setAnswers({ ...answers, [q.id]: option.label })}
                  disabled={disabled}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <input
            type={q.secret ? 'password' : 'text'}
            autoComplete="off"
            aria-label={q.question}
            value={answers[q.id] ?? ''}
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            disabled={disabled}
            placeholder="Your answer"
          />
        </label>
      ))}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="approval-actions">
        {action.kind === 'questions' ? (
          <button className="primary" disabled={disabled} onClick={() => void answer({ answers })}>
            Submit answer
          </button>
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
  const [models, setModels] = useState<{ id: string; displayName: string }[]>([]);
  const [settings, setSettings] = useState<Settings>({ permission: 'read-only' });
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
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
    void request<typeof models>('/models', {}, controller.signal)
      .then(setModels)
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
        if (!list.some((x) => x.id === threadId)) setThreadId('');
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
  const select = (id: string) => {
    setThread(undefined);
    setThreadId(id);
    setSidebar(false);
    follow.current = true;
  };
  useEffect(() => {
    save('codes.thread', threadId);
    setDraft(saved(`codes.draft.${threadId || 'new'}`).slice(0, 50_000));
    setReceipt(threadId ? saved(`codes.operation.${threadId}`) : '');
    setAttachments([]);
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
      if (e.kind === 'state' && !(e.data as Partial<Thread>).pending) {
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
        if (e.kind === 'diff') return { ...t, diff: String(e.data) };
        return t;
      });
    };
    const stream = new Feed(
      threadId,
      (snapshot) => {
        deltas.clear();
        setThread(snapshot.thread);
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
  const newThread = () => {
    select('');
    setSettings({ permission: 'read-only', model: settings.model });
    setError('');
  };
  const send = async () => {
    if (busy || !draft.trim() || !projectId) return;
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
    (!!thread && ['running', 'waitingApproval', 'waitingInput', 'unknown'].includes(thread.state));
  const project = projects.find((x) => x.id === projectId);
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
      <main className="login-shell">
        <div className="login-orbit" />
        <section className="login-card">
          <Brand />
          <p className="eyebrow">YOUR SERVER. YOUR WORKSPACE.</p>
          <h1>
            A little closer
            <br />
            to your next idea.
          </h1>
          <p>
            Bring your Codex workspace to the browser.
            <br />
            Sign in with your server’s access token.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void post('/login', { token })
                .then(() => {
                  setToken('');
                  setError('');
                  return init();
                })
                .catch(notice)
                .finally(() => setBusy(false));
            }}
          >
            <label htmlFor="access-token">Workspace access token</label>
            <input
              id="access-token"
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
              placeholder="Enter your access token"
            />
            <button className="primary" disabled={busy || !token}>
              {auth === 'loading'
                ? 'Connect to workspace'
                : busy
                  ? 'Connecting…'
                  : 'Open workspace'}
              <Icon name="chevron" />
            </button>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
          </form>
          <small>
            Use the token in your server’s data directory.
            <br />
            Codex authentication stays on the host.
          </small>
        </section>
      </main>
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
        <div className="workspace-label conversation-label">
          CONVERSATIONS<span>{threads.length || ''}</span>
        </div>
        <nav aria-label="Conversations">
          {threads.map((t) => (
            <button
              key={t.id}
              className={`thread-link ${t.id === threadId ? 'active' : ''}`}
              disabled={busy}
              onClick={() => select(t.id)}
            >
              <span className={`status-dot ${t.state}`} />
              <span>{t.title}</span>
              {['waitingApproval', 'waitingInput'].includes(t.state) && (
                <span className="attention">!</span>
              )}
            </button>
          ))}
          {!threads.length && (
            <p className="muted empty-nav">
              Your conversations
              <br />
              will appear here.
            </p>
          )}
        </nav>
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
                    streaming={
                      m.kind === 'assistant' &&
                      m.turnId === thread.turnId &&
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
              value={draft}
              onChange={(e) => changeDraft(e.target.value)}
              placeholder={
                active
                  ? 'Write your next thought…'
                  : 'Ask Codex to explore, build, or fix something…'
              }
              maxLength={50_000}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  window.innerWidth > 700
                ) {
                  e.preventDefault();
                  if (!active && !receipt) void send();
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
                value={settings.model ?? ''}
                onChange={(e) => setSettings({ ...settings, model: e.target.value || undefined })}
                disabled={active}
              >
                <option value="">Default model</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <span className="toolbar-divider" />
              <select
                aria-label="Permissions"
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
              {active ? (
                <button
                  className="stop-button"
                  aria-label="Stop task"
                  disabled={busy || !thread?.turnId || thread?.state === 'unknown'}
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
                  disabled={busy || !draft.trim() || !projectId || !!receipt}
                >
                  <Icon name="arrow" size={18} />
                </button>
              )}
            </div>
          </div>
          <div className="composer-hint">
            <span>
              <i />
              {active
                ? 'Your task continues when this page is closed.'
                : 'Codex runs in your project on the host.'}
            </span>
            <span className="desktop-hint">
              ↵ Send <span>·</span> ⇧ ↵ New line
            </span>
          </div>
        </div>
      </div>
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
