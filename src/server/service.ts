import { directoryStatus, directoryError } from './project-context.js';
import { nativePermissions } from '../shared/permissions.js';
import { randomUUID, createHash } from 'node:crypto';
import { realpath, readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, basename, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Driver } from '../codex/driver.js';
import { Store } from './store.js';
import { Events } from './events.js';
import { MessageQueue } from './message-queue.js';
import { Images } from './images.js';
import { ModelSettings } from './model-settings.js';
import { nativeMessage as item, nativeTurn } from './transcript.js';
import { z } from 'zod';
import { AppError, record } from '../shared/errors.js';
import {
  limits,
  sameSettings,
  type Thread,
  type Settings,
  type Message,
  type Action,
  type Attachment,
  type FileContent,
  type State,
  type Summary,
  type QueuePayload,
  type ReviewTarget,
} from '../shared/types.js';

const text = (value: unknown, maximum: number = limits.item) =>
  typeof value === 'string' ? value.slice(0, maximum) : '';
const terminal = (status: unknown) =>
  ['completed', 'failed', 'interrupted'].includes(String(status));
function state(raw: any): State {
  if (raw?.type === 'active')
    return raw.activeFlags?.includes('waitingOnApproval')
      ? 'waitingApproval'
      : raw.activeFlags?.includes('waitingOnUserInput')
        ? 'waitingInput'
        : 'running';
  return raw?.type === 'systemError' ? 'failed' : raw?.type === 'notLoaded' ? 'unknown' : 'idle';
}

const nativeStatus = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notLoaded') }),
  z.object({ type: z.literal('idle') }),
  z.object({ type: z.literal('systemError') }),
  z.object({ type: z.literal('active'), activeFlags: z.array(z.string()) }),
]);

const nativeHistoryItemPageSize = 1;
const nativeHistoryItemLimit = 2000;

export class Service {
  readonly events = new Events();
  readonly images: Images;
  private cache = new Map<string, Thread>();
  private loaded = new Set<string>();
  private reads = new Map<string, Promise<Thread>>();
  private admission: Promise<void> = Promise.resolve();
  private managing = new Set<string>();
  readonly queue: MessageQueue;
  readonly modelSettings: ModelSettings;
  private sending = new Map<string, number>();
  private terminals = new Map<string, State>();
  private metadataRevision = 0;
  private metadataRevisions = new Map<string, number>();
  private actions = new Map<
    string,
    { action: Action; rpcId: string | number; epoch: string; permissions?: unknown }
  >();
  constructor(
    readonly store: Store,
    readonly driver: Driver,
  ) {
    this.images = new Images(store.directory);
    this.modelSettings = new ModelSettings(driver);
    this.queue = new MessageQueue(
      store.queue,
      async (id, messageId) => {
        const entry = store.queue.get(messageId)!;
        return this.send(id, messageId, entry.text, entry.settings, entry.attachments, true);
      },
      async (id) => {
        if (
          store.activeCount() >= limits.active ||
          this.sending.has(id) ||
          store.active(id) ||
          store.steers(id).length ||
          this.managing.has(id) ||
          store.pendingManagement(id)
        )
          return false;
        const thread = await this.read(id);
        if (thread.archived) {
          store.queue.pause(id, 'Restore the conversation before resuming the queue.');
          this.queue.notify(id);
          return false;
        }
        const { native } = await this.conversationOwner(id);
        const directory = await this.projectContext(thread.projectId);
        if (!directory.directory.available) {
          store.queue.pause(id, directory.directory.message!);
          this.queue.notify(id);
          return false;
        }
        if (native.status?.type === 'active') {
          store.queue.pause(
            id,
            'A native task is still active. Review its result before resuming.',
          );
          this.queue.notify(id);
          return false;
        }
        const page = await this.driver
          .call('thread/turns/list', {
            threadId: id,
            limit: 1,
            itemsView: 'notLoaded',
            sortDirection: 'desc',
          })
          .catch((error) => {
            if (
              error instanceof AppError &&
              error.code === 'CLI_ERROR' &&
              error.message.includes(
                'is not materialized yet; thread/turns/list is unavailable before first user message',
              )
            )
              return { data: [] };
            throw error;
          });
        if (!Array.isArray(page.data))
          throw new AppError('PROTOCOL_ERROR', 'Invalid native readiness metadata.', 502);
        if (page.data[0]?.status === 'inProgress') {
          store.queue.pause(id, 'The last native task has no confirmed result.');
          this.queue.notify(id);
          return false;
        }
        return store.activeCount() < limits.active;
      },
      (id, state) => {
        const thread = this.cache.get(id);
        if (thread) thread.queue = state;
        this.events.publish('queue', state, id);
        const summary = store.thread(id);
        if (summary) {
          if (thread) Object.assign(thread, summary);
          this.events.publish('summary', summary, id);
        }
      },
    );
    driver.on('notification', (event) => this.notification(event));
    driver.on('request', (event) => this.request(event));
    driver.on('offline', () => {
      this.loaded.clear();
      store.queue.pauseAll('The runtime stopped. Review outcomes before resuming.');
      for (const id of store.queue.pendingThreads()) this.queue.notify(id);
      for (const thread of this.cache.values()) {
        this.clearCompaction(thread, 'unknown');
        for (const steer of store.steers(thread.id)) store.update(steer.id, 'unknown');
        for (const action of thread.actions) action.status = 'expired';
        if (thread.pending) {
          thread.pending.state = 'unknown';
          store.update(thread.pending.id, 'unknown');
          thread.state = 'unknown';
        }
        this.boundary(thread);
        this.queue.notify(thread.id);
      }
      this.actions.clear();
      this.events.publish('runtime', driver.system());
    });
  }
  project(id: string) {
    const project = this.store.projects().find((x) => x.id === id);
    if (!project) throw new AppError('PROJECT_NOT_FOUND', 'Project not found.', 404);
    return project;
  }
  async projectContext(id: string) {
    const project = this.project(id);
    return { project, directory: await directoryStatus(project) };
  }
  async requireProject(id: string) {
    const context = await this.projectContext(id);
    if (!context.directory.available) throw directoryError(context.directory);
    return context.project;
  }
  async conversationContext(id: string) {
    const { saved } = await this.conversationOwner(id);
    return this.projectContext(saved.projectId);
  }
  async conversationFile(id: string, path: string) {
    const { saved } = await this.conversationOwner(id);
    return this.file(saved.projectId, path);
  }
  async conversationFiles(id: string, path: string) {
    const { saved } = await this.conversationOwner(id);
    return this.files(saved.projectId, path);
  }
  async addProject(path: string, name?: string) {
    try {
      const canonical = await realpath(path);
      if (!(await stat(canonical)).isDirectory())
        throw new AppError('INVALID_DIRECTORY', 'Choose an existing directory.');
      return this.store.addProject(name || basename(canonical), canonical);
    } catch (error) {
      if (record(error) && ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(error.code))
        throw new AppError('INVALID_DIRECTORY', 'Choose an existing, accessible directory.');
      throw error;
    }
  }
  private metadataChanged(id: string) {
    this.metadataRevisions.delete(id);
    this.metadataRevisions.set(id, ++this.metadataRevision);
    if (this.metadataRevisions.size > 512)
      this.metadataRevisions.delete(this.metadataRevisions.keys().next().value!);
  }
  private observeConversation(
    id: string,
    change: { title?: string; archived?: boolean },
    force = false,
  ) {
    const saved = this.store.thread(id);
    if (!saved) return;
    let settled = false;
    if (change.archived !== undefined) {
      const operation = this.store.pendingManagement(id);
      if (
        operation &&
        (operation.archived === change.archived || operation.epoch !== this.driver.epoch)
      ) {
        settled = true;
        this.store.update(
          operation.id,
          operation.archived === change.archived ? 'completed' : 'failed',
          undefined,
          operation.archived === change.archived
            ? undefined
            : 'The requested archive state was not applied before the CLI stopped.',
        );
      }
    }
    const changed =
      (change.title !== undefined && change.title !== saved.title) ||
      (change.archived !== undefined && change.archived !== saved.archived);
    if (!force && !changed && !settled) return saved;
    if (changed) this.metadataChanged(id);
    this.store.setMetadata(id, change);
    const updated = this.store.thread(id)!;
    const cached = this.cache.get(id);
    if (cached) Object.assign(cached, change, { managementPending: updated.managementPending });
    this.events.publish('summary', updated, id);
    this.events.publish('state', { ...change, managementPending: updated.managementPending }, id);
    return updated;
  }
  private observeStatus(id: string, raw: unknown) {
    const status = nativeStatus.safeParse(raw);
    const saved = this.store.thread(id);
    if (!status.success || !saved || saved.executionPending) return;
    const cached = this.cache.get(id);
    if (cached?.actions.some((a) => ['pending', 'responding'].includes(a.status))) return;
    const next =
      status.data.type === 'notLoaded'
        ? ['running', 'waitingInput', 'waitingApproval'].includes(saved.state)
          ? 'unknown'
          : saved.state
        : status.data.type === 'idle' && terminal(saved.state)
          ? saved.state
          : state(status.data);
    if (next === saved.state) return;
    this.metadataChanged(id);
    this.store.saveThread({ ...saved, state: next }, saved.settings);
    if (cached) cached.state = next;
    this.events.publish('summary', this.store.thread(id), id);
    this.events.publish('state', { state: next }, id);
  }
  async list(projectId: string) {
    await this.conversations(projectId, { limit: 30 });
    return this.store.summaries(projectId);
  }
  async conversations(
    projectId: string,
    options: { cursor?: string; search?: string; archived?: boolean; limit?: number } = {},
  ) {
    const project = this.project(projectId);
    const search = (options.search ?? '').trim().slice(0, 120);
    const archived = options.archived === true;
    const limit = Math.min(50, Math.max(1, options.limit ?? 30));
    let nativeCursor: string | undefined;
    if (options.cursor) {
      try {
        const c = JSON.parse(Buffer.from(options.cursor, 'base64url').toString());
        if (
          c.projectId !== projectId ||
          c.search !== search ||
          c.archived !== archived ||
          typeof c.nativeCursor !== 'string'
        )
          throw new Error();
        nativeCursor = c.nativeCursor;
      } catch {
        throw new AppError(
          'LIST_CURSOR',
          'This conversation page no longer matches the current filters.',
        );
      }
    }
    const encode = (cursor: string) =>
      Buffer.from(JSON.stringify({ projectId, search, archived, nativeCursor: cursor })).toString(
        'base64url',
      );
    const seen = new Set<string>();
    let scanned = 0;
    const deadline = Date.now() + 20_000;
    for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new AppError('LIST_TIMEOUT', 'Conversation browsing timed out. Try again.', 504);
      const readRevision = this.metadataRevision;
      const page = await this.driver.call(
        'thread/list',
        {
          cwd: project.path,
          cursor: nativeCursor,
          limit,
          archived,
          sourceKinds: ['cli', 'appServer', 'vscode'],
          modelProviders: [],
          sortKey: 'updated_at',
          sortDirection: 'desc',
        },
        remaining,
      );
      if (
        !Array.isArray(page.data) ||
        (page.nextCursor != null && typeof page.nextCursor !== 'string')
      )
        throw new AppError('PROTOCOL_ERROR', 'Invalid conversation page.', 502);
      const data: import('../shared/types.js').Summary[] = [];
      const ids = new Set<string>();
      for (const raw of page.data) {
        scanned++;
        if (!record(raw) || typeof raw.id !== 'string' || raw.cwd !== project.path) continue;
        const saved = this.store.thread(raw.id);
        const title = text(raw.name || raw.preview, 80) || saved?.title || 'Untitled conversation';
        if (!saved)
          this.store.saveThread(
            {
              id: raw.id,
              projectId,
              title,
              state: state(raw.status),
              updatedAt: Number(raw.updatedAt || 0) * 1000,
              archived,
              forkedFromId: typeof raw.forkedFromId === 'string' ? raw.forkedFromId : undefined,
            },
            { permission: 'read-only' },
          );
        else {
          if (saved.projectId !== projectId)
            throw new AppError(
              'PROJECT_OWNERSHIP',
              'The conversation belongs to another project.',
              403,
            );
          if ((this.metadataRevisions.get(raw.id) ?? 0) <= readRevision) {
            this.observeConversation(raw.id, { title, archived });
            this.observeStatus(raw.id, raw.status);
          }
        }
        const summary = this.store.thread(raw.id)!;
        if (
          !!summary.archived === archived &&
          (!search || summary.title.toLowerCase().includes(search.toLowerCase())) &&
          !ids.has(summary.id)
        ) {
          data.push({
            ...summary,
            updatedAt: Math.max(summary.updatedAt, Number(raw.updatedAt || 0) * 1000),
          });
          ids.add(summary.id);
        }
      }
      if (page.nextCursor && page.nextCursor === nativeCursor)
        throw new AppError('PROTOCOL_ERROR', 'The CLI repeated a conversation cursor.', 502);
      const nextCursor = page.nextCursor ? encode(page.nextCursor) : null;
      if (data.length || !nextCursor || pageNumber === 3) return { data, nextCursor, scanned };
      if (seen.has(page.nextCursor))
        throw new AppError('PROTOCOL_ERROR', 'The CLI repeated a conversation cursor.', 502);
      seen.add(page.nextCursor);
      nativeCursor = page.nextCursor;
    }
    throw new AppError('PROTOCOL_ERROR', 'Invalid conversation scan.', 502);
  }
  private async conversationOwner(id: string) {
    const saved = this.store.thread(id);
    if (!saved) throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
    const project = this.project(saved.projectId);
    const response = await this.driver.call('thread/read', { threadId: id, includeTurns: false });
    if (response.thread?.cwd !== project.path)
      throw new AppError(
        'PROJECT_OWNERSHIP',
        'This conversation no longer belongs to the project.',
        403,
      );
    return { saved, native: response.thread };
  }
  async rename(id: string, operationId: string, name: string) {
    const input = { name };
    const receipt = this.store.existing(operationId, id, 'rename', input);
    if (receipt) {
      if (receipt.state !== 'completed')
        throw new AppError(
          'MANAGEMENT_UNKNOWN',
          'The rename result is not confirmed. Refresh the conversation list.',
          409,
        );
      return this.store.thread(id)!;
    }
    if (this.managing.has(id) || this.store.pendingManagement(id))
      throw new AppError(
        'MANAGEMENT_BUSY',
        'Wait for the current conversation change to finish.',
        409,
      );
    this.managing.add(id);
    try {
      await this.conversationOwner(id);
      this.store.begin(operationId, id, 'rename', input);
      await this.driver.call('thread/name/set', { threadId: id, name });
      this.store.update(operationId, 'completed');
      return this.observeConversation(id, { title: name })!;
    } catch (error) {
      if (this.store.operation(operationId))
        this.store.update(
          operationId,
          error instanceof AppError && !error.uncertain ? 'failed' : 'unknown',
        );
      throw error;
    } finally {
      this.managing.delete(id);
    }
  }
  async archive(id: string, operationId: string, archived: boolean) {
    const input = { archived };
    const receipt = this.store.existing(operationId, id, 'archive', input);
    if (receipt) {
      if (receipt.state !== 'completed')
        throw new AppError(
          'MANAGEMENT_UNKNOWN',
          'The archive result is not confirmed. Refresh its status before continuing.',
          409,
        );
      return this.store.thread(id)!;
    }
    if (this.managing.has(id) || this.store.pendingManagement(id))
      throw new AppError(
        'MANAGEMENT_BUSY',
        'Check the pending conversation change before trying again.',
        409,
      );
    this.managing.add(id);
    try {
      const { saved, native } = await this.conversationOwner(id);
      if (
        this.store.active(id) ||
        this.store.steers(id).length ||
        this.store.queue.count(id) ||
        native.status?.type === 'active'
      )
        throw new AppError(
          'CONVERSATION_ACTIVE',
          'Stop the current task and confirm its result before archiving this conversation.',
          409,
        );
      if (!!saved.archived === archived) return saved;
      if (archived) {
        try {
          const page = await this.driver.call('thread/turns/list', {
            threadId: id,
            limit: 1,
            itemsView: 'notLoaded',
            sortDirection: 'desc',
          });
          if (!Array.isArray(page.data))
            throw new AppError('PROTOCOL_ERROR', 'Invalid active-turn metadata.', 502);
          if (page.data[0]?.status === 'inProgress')
            throw new AppError(
              'CONVERSATION_ACTIVE',
              'The native conversation still has an unfinished turn. Confirm its result before archiving.',
              409,
            );
        } catch (error) {
          if (!(
            error instanceof AppError &&
            error.code === 'CLI_ERROR' &&
            error.message.includes(
              'is not materialized yet; thread/turns/list is unavailable before first user message',
            )
          ))
            throw error;
        }
      }
      this.store.begin(
        operationId,
        id,
        'archive',
        input,
        JSON.stringify({ archived, epoch: this.driver.epoch }),
      );
      this.observeConversation(id, {}, true);
      await this.driver.call(archived ? 'thread/archive' : 'thread/unarchive', { threadId: id });
      this.store.update(operationId, 'completed');
      this.loaded.delete(id);
      return this.observeConversation(id, { archived })!;
    } catch (error) {
      const receipt = this.store.operation(operationId);
      if (receipt?.state === 'completed') return this.store.thread(id)!;
      if (receipt) {
        this.store.update(
          operationId,
          error instanceof AppError && !error.uncertain ? 'failed' : 'unknown',
        );
        this.observeConversation(id, {}, true);
      }
      throw error;
    } finally {
      this.managing.delete(id);
    }
  }
  async checkManagement(id: string) {
    const { saved } = await this.conversationOwner(id);
    const operation = this.store.pendingManagement(id);
    if (!operation) return saved;
    const project = this.project(saved.projectId);
    const deadline = Date.now() + 20_000;
    for (const archived of [true, false]) {
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0)
          throw new AppError(
            'MANAGEMENT_UNKNOWN',
            'The status check timed out. The conversation remains protected.',
            409,
          );
        const page = await this.driver.call(
          'thread/list',
          {
            cwd: project.path,
            archived,
            cursor,
            limit: 50,
            sourceKinds: ['cli', 'appServer', 'vscode'],
            modelProviders: [],
          },
          Math.min(remaining, 5000),
        );
        if (!Array.isArray(page.data))
          throw new AppError('PROTOCOL_ERROR', 'Invalid conversation status page.', 502);
        if (page.data.some((row: any) => row.id === id))
          return this.observeConversation(id, { archived })!;
        if (!page.nextCursor) break;
        if (seen.has(page.nextCursor))
          throw new AppError('PROTOCOL_ERROR', 'The CLI repeated a conversation cursor.', 502);
        seen.add(page.nextCursor);
        cursor = page.nextCursor;
      }
    }
    throw new AppError(
      'MANAGEMENT_UNKNOWN',
      'The status could not be located in this scan. Search both active and archived views; the conversation remains protected.',
      409,
    );
  }
  async create(projectId: string, settings: Settings = this.store.settingsProfile().settings) {
    const project = await this.requireProject(projectId);
    await this.modelSettings.checkPermissions(settings);
    const result = await this.driver.call('thread/start', {
      cwd: project.path,
      sandbox: settings.permission === 'auto-review' ? 'workspace-write' : settings.permission,
      approvalsReviewer: nativePermissions(settings.permission, project.path).approvalsReviewer,
      approvalPolicy: nativePermissions(settings.permission, project.path).approvalPolicy,
      ...(settings.model ? { model: settings.model } : {}),
    });
    if (
      !record(result.thread) ||
      typeof result.thread.id !== 'string' ||
      result.thread.cwd !== project.path
    )
      throw new AppError('PROTOCOL_ERROR', 'Invalid new conversation.', 502, true);
    const thread: Thread = {
      id: result.thread.id,
      projectId,
      title: 'Untitled conversation',
      state: 'idle',
      updatedAt: Date.now(),
      messages: [],
      actions: [],
      olderCursor: null,
      settings,
      diff: '',
      resolvedModel: typeof result.model === 'string' ? result.model : settings.model,
      queue: this.store.queue.state(result.thread.id),
    };
    this.store.saveThread(thread, settings);
    this.loaded.add(thread.id);
    await this.remember(thread);
    this.boundary(thread);
    return thread;
  }
  private remember(thread: Thread) {
    const work = this.admission.then(async () => {
      if (!this.cache.has(thread.id) && this.cache.size >= limits.idleThreads) {
        const candidate = [...this.cache.values()].find(
          (x) => !x.pending && !['running', 'waitingApproval', 'waitingInput'].includes(x.state),
        );
        if (candidate) {
          if (this.loaded.has(candidate.id)) {
            await this.driver.call('thread/unsubscribe', { threadId: candidate.id });
            this.loaded.delete(candidate.id);
          }
          this.cache.delete(candidate.id);
        } else throw new AppError('CAPACITY', 'Too many active conversations.', 429);
      }
      this.cache.set(thread.id, thread);
    });
    // Keep the queue usable after a failed admission; the caller still receives the failure.
    this.admission = work.catch(() => undefined);
    return work;
  }
  async read(id: string): Promise<Thread> {
    const existing = this.cache.get(id);
    if (existing) return existing;
    const pending = this.reads.get(id);
    if (pending) return pending;
    const reading = this.load(id);
    this.reads.set(id, reading);
    try {
      return await reading;
    } finally {
      this.reads.delete(id);
    }
  }
  saveConversationSettings(id: string, revision: number, settings: Settings) {
    const saved = this.store.thread(id);
    if (!saved) throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
    if (saved.archived || saved.managementPending || this.managing.has(id))
      throw new AppError(
        'MANAGEMENT_BUSY',
        'Restore or finish managing this conversation before changing its settings.',
        409,
      );
    const profile = this.store.saveSettingsProfile(id, revision, settings);
    const cached = this.cache.get(id);
    if (cached) cached.composerSettings = profile;
    this.events.publish('settings', profile, id);
    return profile;
  }
  saveDefaultSettings(revision: number, settings: Settings) {
    const profile = this.store.saveSettingsProfile(undefined, revision, settings);
    this.events.publish('defaults', profile);
    return profile;
  }
  private async load(id: string) {
    const saved = this.store.thread(id);
    if (!saved) throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
    this.project(saved.projectId);
    const page = await this.history(id);
    const pending = this.store.active(id);
    const metadata = this.store.thread(id)!;
    const thread: Thread = {
      ...metadata,
      state: metadata.executionPending ? 'unknown' : page.state,
      messages: page.messages,
      turns: page.turns,
      actions: [],
      olderCursor: page.olderCursor,
      newerCursor: page.newerCursor,
      settings: saved.settings,
      composerSettings: this.store.settingsProfile(id),
      diff: page.messages
        .filter((m) => m.kind === 'change' && m.turnId === page.turns.at(-1)?.id)
        .map((m) => m.text)
        .join('\n'),
      pending,
      steering: this.store.steers(id),
      turnId: page.turns.at(-1)?.id,
      queue: this.store.queue.state(id),
    };
    const compact = thread.messages.findLast(
      (message) =>
        message.kind === 'compaction' &&
        message.turnId === thread.turnId &&
        message.status === 'inProgress',
    );
    if (compact && thread.state === 'running')
      thread.compaction = { id: compact.id, turnId: compact.turnId };
    await this.remember(thread);
    // A history read can establish an imported conversation's terminal state.
    // Retain concurrent title/archive changes and publish only its small summary.
    const latest = this.store.thread(id)!;
    this.metadataChanged(id);
    this.store.saveThread({ ...latest, state: thread.state }, latest.settings);
    Object.assign(thread, this.store.thread(id));
    this.events.publish('summary', this.store.thread(id), id);
    return thread;
  }
  async history(id: string, continuation?: string) {
    const deadline = Date.now() + 25_000;
    const call = (method: string, params: unknown) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new AppError('HISTORY_TIMEOUT', 'History loading timed out. Try again.', 504);
      return this.driver.call(method, params, remaining);
    };
    const saved = this.store.thread(id);
    if (!saved) throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
    const project = this.project(saved.projectId);
    let cursor: string | undefined;
    let direction: 'older' | 'newer' = 'older';
    if (continuation) {
      try {
        const decoded = JSON.parse(Buffer.from(continuation, 'base64url').toString());
        if (decoded.id !== id || typeof decoded.cursor !== 'string') throw new Error();
        if (decoded.direction !== undefined && !['older', 'newer'].includes(decoded.direction))
          throw new Error();
        direction = decoded.direction ?? 'older';
        cursor = decoded.cursor || undefined;
      } catch {
        throw new AppError('HISTORY_CURSOR', 'Invalid history cursor.');
      }
    }
    const header = await call('thread/read', { threadId: id, includeTurns: false });
    if (header.thread?.cwd !== project.path)
      throw new AppError(
        'PROJECT_OWNERSHIP',
        'The conversation no longer belongs to this project.',
        403,
      );
    const hydrate = async (turns: any[]): Promise<Message[] | undefined> => {
      const messages: Message[] = [];
      let messageBytes = 0;
      for (const turn of turns) {
        if (typeof turn.id !== 'string')
          throw new AppError('PROTOCOL_ERROR', 'Invalid turn identity.', 502);
        let next: string | undefined;
        const seen = new Set<string>();
        do {
          const items = await call('thread/items/list', {
            threadId: id,
            turnId: turn.id,
            cursor: next,
            limit: nativeHistoryItemPageSize,
            sortDirection: 'asc',
          });
          if (!Array.isArray(items.data))
            throw new AppError('PROTOCOL_ERROR', 'Invalid item history.', 502);
          for (const entry of items.data) {
            const mapped = item(
              entry.item,
              turn.id,
              (path) => this.images.reference(saved.projectId, path),
              Number.isFinite(entry.completedAtMs) && entry.completedAtMs >= 0
                ? 'completed'
                : Number.isFinite(entry.startedAtMs) &&
                    entry.startedAtMs >= 0 &&
                    turn.status === 'inProgress'
                  ? 'inProgress'
                  : undefined,
            );
            if (!mapped) continue;
            messageBytes += Buffer.byteLength(mapped.text);
            // A smaller turn page may fit. Discard this attempted page rather than
            // truncating its items or returning a cursor that skips unread history.
            if (messages.length >= 240 || messageBytes > 2 * 1024 * 1024) return;
            messages.push(mapped);
          }
          next = items.nextCursor ?? undefined;
          if (
            next &&
            (seen.has(next) || seen.size >= nativeHistoryItemLimit / nativeHistoryItemPageSize)
          )
            throw new AppError(
              'HISTORY_LIMIT',
              'History pagination exceeded the supported limit.',
              502,
            );
          if (next) seen.add(next);
        } while (next);
      }
      return messages;
    };
    let pageLimit: number = limits.page;
    for (;;) {
      let page;
      try {
        page = await call('thread/turns/list', {
          threadId: id,
          cursor,
          limit: pageLimit,
          sortDirection: direction === 'newer' ? 'asc' : 'desc',
          itemsView: 'notLoaded',
        });
      } catch (error) {
        // CLI 0.167.0 creates threads lazily; only its specific empty-thread error is benign.
        if (
          !continuation &&
          error instanceof AppError &&
          error.code === 'CLI_ERROR' &&
          error.message.includes(
            'is not materialized yet; thread/turns/list is unavailable before first user message',
          )
        )
          return {
            messages: [] as Message[],
            olderCursor: null,
            newerCursor: null,
            hasNewer: false,
            state: 'idle' as State,
            turns: [] as any[],
          };
        throw error;
      }
      if (!Array.isArray(page.data))
        throw new AppError('PROTOCOL_ERROR', 'Invalid conversation history.', 502);
      for (const value of [page.nextCursor, page.backwardsCursor])
        if (value != null && typeof value !== 'string')
          throw new AppError('PROTOCOL_ERROR', 'Invalid history continuation.', 502);
      const turns = direction === 'newer' ? page.data.slice() : page.data.slice().reverse();
      const messages = await hydrate(turns);
      if (messages) {
        const latest = turns.at(-1);
        return {
          messages,
          olderCursor: this.historyCursor(
            id,
            direction === 'older' ? page.nextCursor : page.backwardsCursor,
            'older',
          ),
          // Keep a resumable forward edge even at the live end, so a reader can
          // catch up after the bounded live cache has moved beyond this page.
          newerCursor: this.historyCursor(
            id,
            direction === 'newer' ? (page.nextCursor ?? cursor) : page.backwardsCursor,
            'newer',
          ),
          hasNewer: direction === 'newer' ? !!page.nextCursor : !!cursor && !!page.backwardsCursor,
          state: (state(header.thread.status) === 'running'
            ? 'running'
            : terminal(latest?.status)
              ? latest.status
              : latest?.status === 'inProgress'
                ? 'unknown'
                : 'idle') as State,
          turns: turns.map(nativeTurn),
        };
      }
      if (pageLimit === 1 || turns.length <= 1)
        throw new AppError(
          'HISTORY_LIMIT',
          'This turn exceeds the display limit. Use the CLI to inspect this conversation.',
          413,
        );
      // Re-read from the same native cursor. The successful, smaller page supplies
      // its own next cursor, keeping older turns reachable without duplicates.
      pageLimit = Math.max(1, Math.min(Math.floor(pageLimit / 2), turns.length - 1));
    }
  }
  private historyCursor(id: string, cursor: unknown, direction: 'older' | 'newer') {
    return typeof cursor === 'string' && cursor
      ? Buffer.from(JSON.stringify({ id, cursor, direction })).toString('base64url')
      : null;
  }
  queueState(id: string) {
    if (!this.store.thread(id))
      throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
    return this.store.queue.state(id);
  }
  async enqueue(id: string, messageId: string, payload: QueuePayload) {
    const saved = this.store.thread(id);
    if (!saved) throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
    if (saved.archived || saved.managementPending || this.managing.has(id))
      throw new AppError(
        'MANAGEMENT_BUSY',
        'Restore or finish managing the conversation before queueing messages.',
        409,
      );
    if (Buffer.byteLength(payload.text) > 100_000)
      throw new AppError('INPUT_LIMIT', 'The queued text exceeds 100 KB.');
    if (this.store.active(id)?.state === 'unknown')
      this.store.queue.pause(id, 'An execution result is unknown. Check result before resuming.');
    if (this.store.operation(messageId) && !this.store.queue.get(messageId))
      throw new AppError(
        'OPERATION_CONFLICT',
        'This operation ID belongs to a different task.',
        409,
      );
    this.store.queue.add(messageId, id, payload);
    this.queue.notify(id);
    this.queue.wake(id);
    return this.queueState(id);
  }
  editQueued(id: string, messageId: string, text: string) {
    this.queueState(id);
    this.store.queue.edit(messageId, id, text);
    this.queue.notify(id);
    return this.queueState(id);
  }
  cancelQueued(id: string, messageId: string) {
    this.queueState(id);
    this.store.queue.cancel(messageId, id);
    this.queue.notify(id);
    this.queue.wake(id);
    return this.queueState(id);
  }
  async steerQueued(id: string, messageId: string, expectedTurnId: string) {
    const entry = this.store.queue.get(messageId);
    if (!entry || entry.threadId !== id)
      throw new AppError('NOT_FOUND', 'Queued message not found.', 404);
    const operation = this.store.operation(messageId);
    if (operation?.kind === 'steer') {
      await this.steer(id, messageId, expectedTurnId, entry.text, entry.attachments);
      return this.queueState(id);
    }
    if (entry.state !== 'queued')
      throw new AppError('QUEUE_STARTED', 'This message has already started.', 409);
    const thread = this.cache.get(id);
    if (!thread || !sameSettings(entry.settings, thread.settings))
      throw new AppError(
        'STEER_SETTINGS',
        'This queued message uses different task settings. Leave it queued for its own turn.',
        409,
      );
    await this.conversationOwner(id);
    await this.requireProject(thread.projectId);
    // Readiness awaits I/O; a completed turn may already have dispatched this entry.
    if (this.store.queue.get(messageId)?.state !== 'queued')
      throw new AppError('QUEUE_STARTED', 'This message has already started.', 409);
    this.store.queue.set(messageId, 'dispatching');
    this.queue.notify(id);
    try {
      const receipt = await this.steer(
        id,
        messageId,
        expectedTurnId,
        entry.text,
        entry.attachments,
      );
      const latest = this.store.queue.get(messageId);
      if (latest?.state === 'dispatching')
        this.store.queue.set(
          messageId,
          receipt.state === 'completed'
            ? 'completed'
            : receipt.state === 'unknown'
              ? 'unknown'
              : receipt.state === 'failed'
                ? 'failed'
                : 'sent',
          receipt.error,
        );
    } catch (error) {
      const receipt = this.store.operation(messageId);
      this.store.queue.set(
        messageId,
        receipt?.state === 'unknown' ? 'unknown' : 'failed',
        error instanceof Error ? error.message : 'Follow-up dispatch failed.',
      );
      this.store.queue.pause(id, 'A follow-up needs review before continuing.');
      throw error;
    } finally {
      this.queue.notify(id);
    }
    return this.queueState(id);
  }
  controlQueue(id: string, paused: boolean) {
    const state = this.queueState(id);
    if (!paused && state.items.some((row) => ['unknown', 'failed'].includes(row.state)))
      throw new AppError(
        'QUEUE_REVIEW',
        'Check unknown results and remove failed messages before resuming.',
        409,
      );
    if (paused) this.store.queue.pause(id);
    else this.store.queue.resume(id);
    this.queue.notify(id);
    if (!paused) this.queue.wake(id);
    return this.queueState(id);
  }
  async source(id: string) {
    const { saved, native } = await this.conversationOwner(id);
    const parentId = saved.forkedFromId || native.forkedFromId;
    if (typeof parentId !== 'string')
      throw new AppError('NOT_FOUND', 'This conversation has no native source.', 404);
    const parent = await this.driver.call(
      'thread/read',
      { threadId: parentId, includeTurns: false },
      5000,
    );
    if (parent.thread?.cwd !== this.project(saved.projectId).path)
      throw new AppError('PROJECT_OWNERSHIP', 'The source belongs to a different project.', 403);
    const existing = this.store.thread(parentId);
    if (existing && existing.projectId !== saved.projectId)
      throw new AppError('PROJECT_OWNERSHIP', 'The source belongs to a different project.', 403);
    if (!existing) {
      let archiveState: boolean | undefined;
      const deadline = Date.now() + 10_000;
      for (const archived of [false, true]) {
        let cursor: string | undefined;
        for (let page = 0; page < 4 && Date.now() < deadline; page++) {
          const result = await this.driver.call(
            'thread/list',
            {
              cwd: parent.thread.cwd,
              archived,
              cursor,
              limit: 50,
              modelProviders: [],
              sourceKinds: ['cli', 'appServer', 'vscode'],
              ...(parent.thread.name ? { searchTerm: parent.thread.name } : {}),
            },
            Math.min(5000, deadline - Date.now()),
          );
          if (!Array.isArray(result.data))
            throw new AppError('PROTOCOL_ERROR', 'Invalid native source metadata.', 502);
          if (result.data.some((row: any) => row.id === parentId)) {
            archiveState = archived;
            break;
          }
          if (!result.nextCursor || result.nextCursor === cursor) break;
          cursor = result.nextCursor;
        }
        if (archiveState !== undefined) break;
      }
      if (archiveState === undefined)
        throw new AppError(
          'SOURCE_NOT_LISTED',
          'The source archive state could not be verified in this scan. Refresh the conversation views or inspect it in the CLI.',
          409,
        );
      this.store.saveThread(
        {
          id: parentId,
          projectId: saved.projectId,
          title: text(parent.thread.name || parent.thread.preview, 80) || 'Untitled conversation',
          state: state(parent.thread.status),
          updatedAt: Number(parent.thread.updatedAt || 0) * 1000,
          archived: archiveState,
          forkedFromId:
            typeof parent.thread.forkedFromId === 'string' ? parent.thread.forkedFromId : undefined,
        },
        { permission: 'read-only' },
      );
    }
    return this.store.thread(parentId)!;
  }
  async fork(id: string, operationId: string, lastTurnId: string) {
    const input = { lastTurnId };
    const receipt = this.store.existing(operationId, id, 'fork', input);
    if (receipt) {
      if (receipt.resultId) return this.store.thread(receipt.resultId)!;
      if (receipt.state === 'failed')
        throw new AppError(
          'FORK_FAILED',
          receipt.error ?? 'The branch was not created. Choose a completed turn.',
          409,
        );
      throw new AppError(
        'FORK_UNKNOWN',
        'A branch may already exist. Refresh the list before creating another.',
        409,
        true,
      );
    }
    if (this.managing.has(id) || this.store.pendingManagement(id))
      throw new AppError('MANAGEMENT_BUSY', 'Finish the current conversation change first.', 409);
    this.managing.add(id);
    try {
      const { saved } = await this.conversationOwner(id);
      await this.requireProject(saved.projectId);
      this.store.begin(operationId, id, 'fork', input);
      const response = await this.driver.call('thread/fork', {
        threadId: id,
        lastTurnId,
        excludeTurns: true,
        cwd: this.project(saved.projectId).path,
        sandbox: 'read-only',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        ...(saved.settings.model ? { model: saved.settings.model } : {}),
      });
      if (
        typeof response.thread?.id !== 'string' ||
        response.thread.id === id ||
        response.thread.cwd !== this.project(saved.projectId).path
      )
        throw new AppError(
          'PROTOCOL_ERROR',
          'Invalid branch metadata. Refresh the list before trying again.',
          502,
          true,
        );
      const child: Summary = {
        id: response.thread.id,
        projectId: saved.projectId,
        title: text(response.thread.name || response.thread.preview, 80) || saved.title,
        state: 'idle',
        updatedAt: Number(response.thread.updatedAt || Date.now() / 1000) * 1000,
        archived: false,
        forkedFromId: id,
      };
      this.store.saveThread(child, {
        permission: 'read-only',
        ...(saved.settings.model ? { model: saved.settings.model } : {}),
      });
      this.store.result(operationId, child.id);
      this.store.update(operationId, 'completed');
      try {
        await this.driver.call('thread/unsubscribe', { threadId: child.id }, 5000);
      } catch {
        console.error('Unable to unsubscribe an unused conversation branch.');
      }
      this.events.publish('summary', this.store.thread(child.id), child.id);
      return this.store.thread(child.id)!;
    } catch (error) {
      if (this.store.operation(operationId))
        this.store.update(
          operationId,
          error instanceof AppError && !error.uncertain ? 'failed' : 'unknown',
          undefined,
          error instanceof AppError ? error.message : 'The branch result is not confirmed.',
        );
      throw error;
    } finally {
      this.managing.delete(id);
      this.queue.wake(id);
    }
  }
  private async input(projectId: string, prompt: string, attachments: Attachment[]) {
    let context = '';
    const images: { type: 'localImage'; path: string }[] = [];
    for (const attachment of attachments) {
      if (attachment.kind === 'image') {
        const image = await this.images.read(projectId, attachment.id);
        images.push({ type: 'localImage', path: image.path });
        continue;
      }
      const file = await this.file(projectId, attachment.path);
      if (file.sha !== attachment.sha)
        throw new AppError(
          'FILE_CHANGED',
          'An attached file changed. Open and attach it again.',
          409,
        );
      if (
        attachment.fromLine < 1 ||
        attachment.toLine < attachment.fromLine ||
        attachment.toLine > file.lines
      )
        throw new AppError('LINE_RANGE', 'Invalid file selection.');
      context += `\n\nFile context ${JSON.stringify({ path: file.path, fromLine: attachment.fromLine, toLine: attachment.toLine })}:\n${file.text
        .split('\n')
        .slice(attachment.fromLine - 1, attachment.toLine)
        .join('\n')}`;
    }
    if (Buffer.byteLength(prompt + context) > 100_000)
      throw new AppError('INPUT_LIMIT', 'The prompt and attached context exceed 100 KB.');
    if (!prompt.trim() && !context && !images.length)
      throw new AppError('INPUT_REQUIRED', 'Enter a message or attach an image.');
    return [
      ...(prompt || context ? [{ type: 'text', text: prompt + context, text_elements: [] }] : []),
      ...images,
    ];
  }
  async review(id: string, operationId: string, target: ReviewTarget, settings: Settings) {
    const title =
      target.type === 'baseBranch'
        ? 'changes against ' + target.branch
        : target.type === 'commit'
          ? 'commit ' + target.sha
          : target.type === 'custom'
            ? target.instructions
            : 'uncommitted changes';
    return this.send(
      id,
      operationId,
      'Review: ' + title,
      { ...settings, permission: 'read-only', mode: 'default' },
      [],
      false,
      target,
    );
  }
  async steer(
    id: string,
    operationId: string,
    expectedTurnId: string,
    prompt: string,
    attachments: Attachment[] = [],
  ) {
    const input = { expectedTurnId, prompt, attachments };
    const existing = this.store.existing(operationId, id, 'steer', input);
    if (existing) return existing;
    const thread = await this.read(id);
    await this.conversationOwner(id);
    await this.requireProject(thread.projectId);
    const nativeInput = await this.input(thread.projectId, prompt, attachments);
    if (nativeInput.some((entry) => entry.type === 'localImage'))
      await this.modelSettings.resolve(thread.settings, thread.resolvedModel, true);
    const active = this.store.active(id);
    // Check again after file I/O; never promote a stale follow-up into a new task.
    if (
      thread.archived ||
      thread.managementPending ||
      this.managing.has(id) ||
      this.store.pendingManagement(id) ||
      (active && this.store.operation(active.id)?.kind === 'review') ||
      thread.state !== 'running' ||
      thread.turnId !== expectedTurnId ||
      this.store.active(id)?.state === 'unknown'
    )
      throw new AppError(
        'STEER_UNAVAILABLE',
        'Only a running task can receive an immediate follow-up. Queue this message instead.',
        409,
      );
    if (this.store.steers(id).length >= 10)
      throw new AppError(
        'STEER_LIMIT',
        'Wait for pending follow-ups to finish before adding another.',
        429,
      );
    const receipt = this.store.begin(operationId, id, 'steer', input, prompt);
    if (receipt.existing) return receipt.existing;
    this.boundary(thread);
    try {
      const response = await this.driver.call('turn/steer', {
        threadId: id,
        expectedTurnId,
        clientUserMessageId: operationId,
        input: nativeInput,
      });
      if (response?.turnId !== expectedTurnId)
        throw new AppError(
          'PROTOCOL_ERROR',
          'The CLI did not confirm the intended turn.',
          502,
          true,
        );
      if (this.store.operation(operationId)?.state !== 'completed') {
        this.store.update(operationId, 'acknowledged', expectedTurnId);
        if (thread.turnId === expectedTurnId && terminal(thread.state))
          this.store.finishSteers(id, expectedTurnId);
      }
      this.boundary(thread);
      return this.store.operation(operationId)!;
    } catch (error) {
      const receipt = this.store.operation(operationId)!;
      if (receipt.state === 'completed') return receipt;
      this.store.update(
        operationId,
        error instanceof AppError && !error.uncertain ? 'failed' : 'unknown',
        undefined,
        error instanceof AppError ? error.message : 'The follow-up result is unknown.',
      );
      this.boundary(thread);
      throw error;
    }
  }
  async send(
    id: string,
    operationId: string,
    prompt: string,
    settings: Settings,
    attachments: Attachment[] = [],
    fromQueue = false,
    review?: ReviewTarget,
  ) {
    const kind = review ? 'review' : 'send';
    const existing = this.store.existing(operationId, id, kind, {
      prompt,
      settings,
      attachments,
      ...(review ? { review } : {}),
    });
    if (!fromQueue && !existing && this.store.queue.count(id))
      throw new AppError(
        'QUEUE_PENDING',
        'Add this message to the queue, or resolve the queued messages first.',
        409,
      );
    this.sending.set(id, (this.sending.get(id) ?? 0) + 1);
    try {
      return await this.dispatchSend(id, operationId, prompt, settings, attachments, review);
    } finally {
      const remaining = (this.sending.get(id) ?? 1) - 1;
      if (remaining) this.sending.set(id, remaining);
      else this.sending.delete(id);
      this.queue.wake(id);
    }
  }
  private async dispatchSend(
    id: string,
    operationId: string,
    prompt: string,
    settings: Settings,
    attachments: Attachment[] = [],
    review?: ReviewTarget,
  ) {
    const kind = review ? 'review' : 'send';
    const thread = await this.read(id);
    const project = this.project(thread.projectId);
    const input = { prompt, settings, attachments, ...(review ? { review } : {}) };
    const receipt = this.store.existing(operationId, id, kind, input);
    if (receipt) return receipt;
    if (this.store.thread(id)?.archived)
      throw new AppError(
        'CONVERSATION_ARCHIVED',
        'Restore this conversation before sending another task.',
        409,
      );
    if (this.managing.has(id) || this.store.pendingManagement(id))
      throw new AppError(
        'MANAGEMENT_BUSY',
        'The conversation metadata is still being changed. Check its status before sending.',
        409,
      );
    if (this.store.steers(id).length)
      throw new AppError(
        'STEER_PENDING',
        'Check pending follow-ups before starting a new task.',
        409,
      );
    if (this.store.active(id))
      throw new AppError(
        'EXECUTION_UNKNOWN',
        'This conversation already has an unfinished operation. Check its result first.',
        409,
      );
    await this.conversationOwner(id);
    await this.requireProject(project.id);
    const nativeInput = await this.input(project.id, prompt, attachments);
    const { existing } = this.store.begin(operationId, id, kind, input, prompt);
    if (existing) return existing;
    thread.pending = { id: operationId, text: prompt, state: 'dispatching', kind };
    let dispatched = false;
    try {
      // A concurrent history read may have evicted this object while it was idle.
      // Re-admit the now-leased thread before it can receive any execution events.
      await this.remember(thread);
      if (this.store.activeCount() > limits.active)
        throw new AppError(
          'CAPACITY',
          'Finish an active conversation before starting another.',
          429,
        );
      if (!this.loaded.has(id)) {
        const resumed = await this.driver.call('thread/resume', {
          threadId: id,
          excludeTurns: true,
          cwd: project.path,
        });
        thread.resolvedModel = typeof resumed.model === 'string' ? resumed.model : undefined;
        this.loaded.add(id);
      }
      const collaborationMode = await this.modelSettings.resolve(
        settings,
        thread.resolvedModel,
        nativeInput.some((entry) => entry.type === 'localImage'),
      );
      await this.modelSettings.checkPermissions(settings);
      const { sandboxPolicy, approvalPolicy, approvalsReviewer } = nativePermissions(
        settings.permission,
        project.path,
      );
      if (review) {
        const { native } = await this.conversationOwner(id);
        if (native.status?.type === 'active')
          throw new AppError(
            'CONVERSATION_ACTIVE',
            'Finish the active native task before reviewing.',
            409,
          );
        await this.driver.call('thread/settings/update', {
          threadId: id,
          cwd: project.path,
          sandboxPolicy,
          approvalPolicy,
          approvalsReviewer,
          collaborationMode,
          serviceTier: settings.fast ? 'priority' : 'default',
        });
      }
      thread.resolvedModel = collaborationMode.settings.model;
      thread.settings = settings;
      thread.title =
        thread.title === 'Untitled conversation'
          ? prompt.trim().slice(0, 64) ||
            attachments.find((entry) => entry.kind === 'image')?.name ||
            'Image conversation'
          : thread.title;
      thread.state = 'running';
      thread.updatedAt = Date.now();
      this.boundary(thread);
      dispatched = true;
      const result = await this.driver.call(
        review ? 'review/start' : 'turn/start',
        review
          ? {
              threadId: id,
              target: review,
              delivery: 'inline',
            }
          : {
              threadId: id,
              clientUserMessageId: operationId,
              cwd: project.path,
              input: nativeInput,
              sandboxPolicy,
              approvalPolicy,
              approvalsReviewer,
              collaborationMode,
              serviceTierForTurn: settings.fast ? 'priority' : 'default',
            },
      );
      if (typeof result.turn?.id !== 'string')
        throw new AppError('PROTOCOL_ERROR', 'The CLI did not return a turn identity.', 502, true);
      const stored = this.store.operation(operationId)!;
      if (stored.state !== 'completed') {
        this.store.update(operationId, 'acknowledged', result.turn.id);
        if (thread.pending) {
          thread.pending.state = 'acknowledged';
          thread.pending.turnId = result.turn.id;
        }
      }
      const completed = this.terminals.get(id + '/' + result.turn.id);
      if (completed) {
        this.store.complete(id, result.turn.id);
        delete thread.pending;
        thread.state = completed;
        thread.turnId = result.turn.id;
      } else if (!review || !thread.turnId || thread.state !== 'running')
        thread.turnId = result.turn.id;
      this.boundary(thread);
      return this.store.operation(operationId)!;
    } catch (error) {
      const terminalReceipt = this.store.operation(operationId);
      // A matching terminal event is stronger evidence than a late acknowledgement timeout.
      if (terminalReceipt?.state === 'completed') return terminalReceipt;
      const uncertain = dispatched && (!(error instanceof AppError) || error.uncertain);
      this.store.update(
        operationId,
        uncertain ? 'unknown' : 'failed',
        undefined,
        error instanceof AppError ? error.message : 'The request failed.',
      );
      if (uncertain) {
        thread.state = 'unknown';
        if (thread.pending) thread.pending.state = 'unknown';
      } else {
        delete thread.pending;
        thread.state = 'failed';
      }
      this.boundary(thread);
      throw error;
    }
  }
  async reconcile(id: string) {
    const thread = await this.read(id);
    const pending = this.store.active(id);
    if (!pending && !this.store.steers(id).length) {
      this.syncQueue(thread);
      this.queue.notify(id);
      return thread;
    }
    const history = await this.history(id);
    for (const steer of this.store.steers(id)) {
      const nativeItem = history.messages.find((entry) => entry.clientId === steer.id);
      const known = history.turns.find(
        (turn: any) => turn.id === (nativeItem?.turnId || steer.turnId),
      );
      if (known && terminal(known.status)) this.store.update(steer.id, 'completed', known.id);
    }
    const match =
      pending &&
      history.turns.find(
        (turn: any) =>
          turn.id === this.store.operation(pending.id)?.turnId ||
          history.messages.some(
            (message) => message.turnId === turn.id && message.clientId === pending.id,
          ),
      );
    if (match && terminal(match.status)) {
      this.store.complete(id, match.id);
      thread.state = match.status;
      thread.messages = history.messages;
      thread.turns = history.turns;
      thread.olderCursor = history.olderCursor;
      thread.newerCursor = history.newerCursor;
      thread.diff = history.messages
        .filter((m) => m.kind === 'change' && m.turnId === match.id)
        .map((m) => m.text)
        .join('\n');
      this.events.publish('diff', thread.diff, id);
      delete thread.pending;
      this.boundary(thread);
    }
    if (!pending && !this.store.steers(id).length) {
      thread.messages = history.messages;
      thread.turns = history.turns;
      thread.olderCursor = history.olderCursor;
      thread.newerCursor = history.newerCursor;
      thread.state = history.state;
    }
    this.boundary(thread);
    return thread;
  }
  async interrupt(id: string) {
    const thread = await this.read(id);
    if (!thread.turnId)
      throw new AppError(
        'TURN_UNKNOWN',
        'The active turn cannot be identified. Check its result first.',
        409,
      );
    const turnId = thread.turnId;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await this.driver.call('turn/interrupt', { threadId: id, turnId });
        return { requested: true };
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === 'CLI_ERROR' &&
          error.message === 'no active turn to interrupt'
        ) {
          if (!thread.pending && terminal(thread.state))
            return { requested: false, alreadyFinished: true };
          // CLI 0.167.0 can acknowledge turn/start before its runner is registered.
          // Cancellation of this same turn is safe to retry; task dispatch is never retried.
          if (attempt < 9 && thread.turnId === turnId) {
            await delay(100);
            continue;
          }
        }
        throw error;
      }
    }
    throw new AppError('INTERRUPT_UNCONFIRMED', 'Interruption was not acknowledged.', 409);
  }
  async answer(
    id: string,
    operationId: string,
    resolution: { decision?: string; answers?: Record<string, string> },
  ) {
    const receipt = this.store.existing(operationId, undefined, 'answer', { id, resolution });
    if (receipt) return receipt;
    const entry = this.actions.get(id);
    if (!entry || entry.epoch !== this.driver.epoch || entry.action.status !== 'pending') {
      throw new AppError('STALE_ACTION', 'This request was already answered or has expired.', 409);
    }
    const action = entry.action;
    let response: unknown;
    if (action.kind === 'questions') {
      if (resolution.decision === 'skip') {
        if (action.blocking !== false || Object.keys(resolution.answers ?? {}).length)
          throw new AppError('INVALID_ANSWER', 'Only an optional question can be skipped.');
        response = { answers: {} };
      } else {
        if (resolution.decision)
          throw new AppError(
            'INVALID_ANSWER',
            'Submit answers or explicitly skip an optional question.',
          );
        const answers: Record<string, { answers: string[] }> = {};
        if (
          Object.keys(resolution.answers ?? {}).some(
            (id) => !action.questions?.some((question) => question.id === id),
          )
        )
          throw new AppError('INVALID_ANSWER', 'The answer refers to a different question.');
        for (const question of action.questions ?? []) {
          const value = resolution.answers?.[question.id]?.trim();
          if (!value)
            throw new AppError('ANSWER_REQUIRED', 'Answer each question before submitting.');
          if (
            question.options?.length &&
            !question.allowOther &&
            !question.options.some((option) => option.label === value)
          )
            throw new AppError('INVALID_ANSWER', 'Choose one of the supplied options.');
          answers[question.id] = { answers: [value] };
        }
        response = { answers };
      }
    } else {
      if (!action.decisions.includes(resolution.decision ?? ''))
        throw new AppError('INVALID_DECISION', 'Choose an available decision.');
      response =
        action.kind === 'permissions'
          ? {
              permissions: resolution.decision === 'accept' ? entry.permissions : {},
              scope: 'turn',
            }
          : { decision: resolution.decision };
    }
    const { existing } = this.store.begin(operationId, action.threadId, 'answer', {
      id,
      resolution,
    });
    if (existing) return existing;
    action.status = 'responding';
    this.emitActions(action.threadId);
    try {
      await this.driver.answer(entry.rpcId, response);
      this.store.update(operationId, 'completed');
      return this.store.operation(operationId)!;
    } catch (error) {
      this.store.update(operationId, 'unknown');
      throw error;
    }
  }
  private syncQueue(thread: Thread) {
    for (const entry of this.store.queue.inFlight(thread.id)) {
      const op = this.store.operation(entry.id);
      if (op?.state === 'completed') {
        const successful = thread.state === 'completed';
        this.store.queue.set(
          entry.id,
          'completed',
          successful ? undefined : 'The task ended ' + thread.state + '.',
        );
        if (!successful)
          this.store.queue.pause(
            thread.id,
            'A task stopped or failed. Review the remaining messages before resuming.',
          );
      } else if (op?.state === 'unknown') {
        if (entry.state !== 'sent')
          this.store.queue.set(entry.id, 'unknown', 'Check result before continuing.');
        this.store.queue.pause(thread.id, 'An execution result is unknown.');
      } else if (op?.state === 'failed') {
        this.store.queue.set(entry.id, entry.state === 'sent' ? 'completed' : 'failed', op.error);
        this.store.queue.pause(thread.id, 'A queued task failed.');
      }
    }
    thread.queue = this.store.queue.state(thread.id);
  }
  private boundary(thread: Thread) {
    this.syncQueue(thread);
    thread.composerSettings = this.store.settingsProfile(thread.id);
    // Protect lifecycle state and first-prompt titles from older thread/list replies.
    this.metadataChanged(thread.id);
    this.store.saveThread(thread, thread.settings);
    const { id, title, state, updatedAt } = thread;
    thread.steering = this.store.steers(id);
    const summary = this.store.thread(id)!;
    Object.assign(thread, summary);
    this.events.publish('summary', summary, id);
    this.events.publish(
      'state',
      {
        state,
        title,
        updatedAt,
        turnId: thread.turnId,
        olderCursor: thread.olderCursor,
        newerCursor: thread.newerCursor,
        turns: thread.turns,
        pending: thread.pending ?? null,
        settings: thread.settings,
        steering: thread.steering,
        resolvedModel: thread.resolvedModel,
      },
      id,
    );
    this.emitActions(id);
    if (!thread.pending && !thread.steering?.length) {
      if (['failed', 'interrupted'].includes(thread.state) && this.store.queue.count(id))
        this.store.queue.pause(id, 'A task stopped or failed. Review the queue before resuming.');
      this.queue.wake(id);
      for (const waiting of this.store.queue.pendingThreads()) this.queue.wake(waiting);
    }
    this.queue.notify(id);
  }
  private emitActions(id: string) {
    this.events.publish(
      'actions',
      this.cache
        .get(id)
        ?.actions.filter((a) => a.status === 'pending' || a.status === 'responding') ?? [],
      id,
    );
  }
  private notification(event: any) {
    if (!record(event.params)) return;
    const p = event.params;
    if (event.method === 'thread/status/changed' && typeof p.threadId === 'string') {
      this.observeStatus(p.threadId, p.status);
      return;
    }
    if (
      event.method === 'thread/name/updated' &&
      typeof p.threadId === 'string' &&
      typeof p.threadName === 'string'
    ) {
      this.observeConversation(p.threadId, { title: text(p.threadName, 80) });
      return;
    }
    if (
      (event.method === 'thread/archived' || event.method === 'thread/unarchived') &&
      typeof p.threadId === 'string'
    ) {
      this.loaded.delete(p.threadId);
      this.observeConversation(p.threadId, { archived: event.method === 'thread/archived' });
      return;
    }
    if (event.method === 'thread/closed') {
      this.loaded.delete(p.threadId);
      const closed = this.cache.get(p.threadId);
      if (closed) this.clearCompaction(closed, 'unknown');
      if (closed?.pending) {
        this.store.update(closed.pending.id, 'unknown');
        closed.pending.state = 'unknown';
        closed.state = 'unknown';
        for (const action of closed.actions) action.status = 'expired';
        for (const [id, entry] of this.actions)
          if (entry.action.threadId === closed.id) this.actions.delete(id);
        this.boundary(closed);
      }
      return;
    }
    const thread = this.cache.get(p.threadId);
    if (!thread) return;
    if (
      event.method === 'item/autoApprovalReview/started' ||
      event.method === 'item/autoApprovalReview/completed'
    ) {
      const parsed = z
        .object({
          turnId: z.string(),
          reviewId: z.string().max(200),
          review: z.object({
            status: z.enum(['inProgress', 'approved', 'denied', 'timedOut', 'aborted']),
            rationale: z.string().nullable(),
          }),
        })
        .safeParse(p);
      if (
        !parsed.success ||
        p.turnId !== thread.turnId ||
        !['running', 'waitingApproval', 'waitingInput'].includes(thread.state)
      )
        return;
      const labels = {
        inProgress: 'Reviewing',
        approved: 'Approved',
        denied: 'Denied',
        timedOut: 'Timed out',
        aborted: 'Aborted',
      };
      const review = parsed.data.review;
      const message: Message = {
        id: 'auto-review:' + parsed.data.reviewId,
        turnId: p.turnId,
        kind: 'notice',
        status: review.status,
        text:
          'Auto-review · ' +
          labels[review.status] +
          (review.rationale ? '\n' + text(review.rationale, 2000) : ''),
      };
      const index = thread.messages.findIndex((entry) => entry.id === message.id);
      if (index >= 0) thread.messages[index] = message;
      else thread.messages.push(message);
      thread.messages = thread.messages.slice(-300);
      this.events.publish('item', message, thread.id);
      return;
    }
    if (event.method === 'thread/tokenUsage/updated') {
      const usage = z
        .object({
          last: z.object({ totalTokens: z.number().int().nonnegative() }),
          total: z.object({ totalTokens: z.number().int().nonnegative() }),
          modelContextWindow: z.number().int().positive().nullish(),
        })
        .safeParse(p.tokenUsage);
      if (usage.success && typeof p.turnId === 'string') {
        thread.usage = {
          turnId: p.turnId,
          contextTokens: usage.data.last.totalTokens,
          totalTokens: usage.data.total.totalTokens,
          contextWindow: usage.data.modelContextWindow ?? undefined,
        };
        this.events.publish('state', { usage: thread.usage }, thread.id);
      }
      return;
    }
    if (event.method === 'turn/plan/updated') {
      const plan = z
        .object({
          explanation: z.string().max(8000).nullish(),
          plan: z
            .array(
              z.object({
                step: z.string().max(2000),
                status: z.enum(['pending', 'inProgress', 'completed']),
              }),
            )
            .max(100),
        })
        .safeParse(p);
      if (plan.success && p.turnId === thread.turnId) {
        thread.plan = { explanation: plan.data.explanation ?? undefined, steps: plan.data.plan };
        this.events.publish('state', { plan: thread.plan }, thread.id);
      }
      return;
    }
    if (event.method === 'serverRequest/resolved') {
      for (const entry of this.actions.values())
        if (entry.action.threadId === thread.id && entry.rpcId === p.requestId) {
          entry.action.status = 'answered';
          this.actions.delete(entry.action.id);
        }
      this.emitActions(thread.id);
      if (['waitingInput', 'waitingApproval'].includes(thread.state)) {
        const remaining = thread.actions.filter(
          (a) => a.status === 'pending' || a.status === 'responding',
        );
        thread.state = remaining.some((a) => a.kind !== 'questions')
          ? 'waitingApproval'
          : remaining.length
            ? 'waitingInput'
            : 'running';
        this.boundary(thread);
      }
      return;
    }
    if (
      event.method === 'item/agentMessage/delta' ||
      event.method === 'item/plan/delta' ||
      event.method === 'item/commandExecution/outputDelta'
    ) {
      const message = thread.messages.find((x) => x.id === p.itemId);
      if (message && typeof p.delta === 'string') {
        const remaining = limits.item - message.text.length;
        const delta = p.delta.slice(0, Math.max(0, remaining));
        message.text += delta;
        if (delta) this.events.publish('text', { id: message.id, delta }, thread.id);
        if (p.delta.length > Math.max(0, remaining) && !message.truncated) {
          message.truncated = true;
          this.events.publish('item', message, thread.id);
        }
      }
      return;
    }
    if (event.method === 'item/started' || event.method === 'item/completed') {
      this.applyItem(
        thread,
        p.item,
        p.turnId,
        event.method === 'item/started' ? 'inProgress' : 'completed',
      );
      return;
    }
    if (event.method === 'turn/diff/updated') {
      if (p.turnId !== thread.turnId) return;
      thread.diff = text(p.diff);
      thread.diffTruncated = typeof p.diff === 'string' && p.diff.length > limits.item;
      this.events.publish('diff', thread.diff, thread.id);
      this.events.publish('state', { diffTruncated: thread.diffTruncated }, thread.id);
      return;
    }
    if (event.method === 'turn/started' || event.method === 'turn/completed') {
      if (!record(p.turn) || typeof p.turn.id !== 'string') return;
      const info = nativeTurn(p.turn);
      const previous = thread.turns?.find((turn) => turn.id === info.id);
      thread.turns = [
        ...(thread.turns ?? []).filter((turn) => turn.id !== info.id),
        { ...previous, ...info },
      ].slice(-300);
      if (event.method === 'turn/completed' && terminal(p.turn.status)) {
        this.terminals.set(thread.id + '/' + p.turn.id, p.turn.status);
        while (this.terminals.size > 100)
          this.terminals.delete(this.terminals.keys().next().value!);
      }
      const pendingOperation = this.store.active(thread.id);
      const review = pendingOperation && this.store.operation(pendingOperation.id);
      for (const raw of Array.isArray(p.turn.items) ? p.turn.items : [])
        this.applyItem(thread, raw, p.turn.id);
      if (event.method === 'turn/started') {
        this.clearCompaction(thread, 'unknown');
        thread.turnId = p.turn.id;
        thread.state = 'running';
        thread.diff = '';
        thread.diffTruncated = false;
        delete thread.plan;
        this.events.publish('state', { plan: null, diffTruncated: false }, thread.id);
        this.events.publish('diff', '', thread.id);
      } else if (
        thread.turnId === p.turn.id ||
        !thread.turnId ||
        (review?.kind === 'review' && review.turnId === p.turn.id)
      ) {
        // Inline review emits an inner runner's start followed by the acknowledged
        // outer review turn's completion. Only that exact receipt can close it.
        thread.turnId = p.turn.id;
        thread.state = terminal(p.turn.status) ? p.turn.status : 'unknown';
        const pending = this.store.active(thread.id);
        if (
          pending &&
          terminal(p.turn.status) &&
          (this.store.operation(pending.id)?.turnId === p.turn.id ||
            thread.messages.some((m) => m.turnId === p.turn.id && m.clientId === pending.id))
        ) {
          this.store.complete(thread.id, p.turn.id);
          delete thread.pending;
        }
        if (terminal(p.turn.status)) this.store.finishSteers(thread.id, p.turn.id);
        for (const entry of this.actions.values())
          if (entry.action.turnId === p.turn.id) {
            entry.action.status = 'expired';
            this.actions.delete(entry.action.id);
          }
      }
      if (terminal(p.turn.status) && thread.turnId === p.turn.id) {
        this.clearCompaction(
          thread,
          p.turn.status === 'interrupted'
            ? 'interrupted'
            : p.turn.status === 'failed'
              ? 'failed'
              : 'unknown',
        );
      }
      thread.updatedAt = Date.now();
      this.boundary(thread);
    }
  }
  private clearCompaction(thread: Thread, status: 'interrupted' | 'failed' | 'unknown') {
    if (!thread.compaction) return;
    const message = thread.messages.find((entry) => entry.id === thread.compaction!.id);
    if (message?.kind === 'compaction' && message.status === 'inProgress') {
      message.status = status;
      message.text =
        status === 'interrupted'
          ? 'Context compaction interrupted.'
          : status === 'failed'
            ? 'Context compaction did not finish.'
            : 'Context compaction outcome unknown.';
      this.events.publish('item', message, thread.id);
    }
    delete thread.compaction;
    this.events.publish('state', { compaction: null }, thread.id);
  }
  private applyItem(
    thread: Thread,
    raw: any,
    turnId: string,
    lifecycle?: 'inProgress' | 'completed',
  ) {
    if (raw?.type === 'contextCompaction') {
      if (
        lifecycle === 'inProgress' &&
        thread.messages.some(
          (entry) =>
            entry.id === raw.id && entry.kind === 'compaction' && entry.status === 'completed',
        )
      )
        return;
      // A delayed item from an earlier turn cannot change the current task's progress.
      if (
        turnId !== thread.turnId ||
        !['running', 'waitingApproval', 'waitingInput'].includes(thread.state)
      )
        return;
      if (lifecycle === 'inProgress' && typeof raw.id === 'string')
        thread.compaction = { id: raw.id, turnId };
      else if (lifecycle === 'completed' && thread.compaction?.id === raw.id)
        delete thread.compaction;
      this.events.publish('state', { compaction: thread.compaction ?? null }, thread.id);
    }
    const message = item(
      raw,
      turnId,
      (path) => this.images.reference(thread.projectId, path),
      lifecycle,
    );
    if (!message) return;
    const index = thread.messages.findIndex((x) => x.id === message.id);
    if (message.kind === 'compaction' && !lifecycle && index >= 0) return;
    if (index >= 0) thread.messages[index] = message;
    else thread.messages.push(message);
    if (thread.messages.length > 300) thread.messages.splice(0, thread.messages.length - 300);
    if (thread.messages.length >= 240) {
      // Live windows can outgrow the native cursor captured when the thread was
      // opened. Rediscover the current native edge before paging farther back.
      const cursor = Buffer.from(
        JSON.stringify({ id: thread.id, cursor: '', direction: 'older' }),
      ).toString('base64url');
      if (thread.olderCursor !== cursor) {
        thread.olderCursor = cursor;
        this.events.publish('state', { olderCursor: cursor }, thread.id);
      }
    }
    if (
      message.clientId &&
      thread.pending?.id === message.clientId &&
      !['completed', 'failed'].includes(this.store.operation(message.clientId)?.state ?? '')
    )
      this.store.update(message.clientId, 'acknowledged', turnId);
    if (message.clientId && this.store.operation(message.clientId)?.kind === 'steer') {
      const receipt = this.store.operation(message.clientId)!;
      if (receipt.threadId === thread.id && !['completed', 'failed'].includes(receipt.state)) {
        this.store.update(message.clientId, 'acknowledged', turnId);
        this.boundary(thread);
      }
    }
    this.events.publish('item', message, thread.id);
  }
  private request(event: any) {
    const p = event.params;
    const kinds: Record<string, Action['kind']> = {
      'item/commandExecution/requestApproval': 'command',
      'item/fileChange/requestApproval': 'file',
      'item/tool/requestUserInput': 'questions',
      'item/permissions/requestApproval': 'permissions',
    };
    const kind = kinds[event.method];
    const thread = this.cache.get(p?.threadId);
    if (
      !kind ||
      !thread ||
      (kind === 'questions' && p.turnId !== thread.turnId) ||
      this.actions.size >= 32 ||
      !['string', 'number'].includes(typeof event.id)
    ) {
      void this.driver
        .reject(event.id)
        ?.catch(() => console.error('Unable to reject an unsupported CLI interaction.'));
      return;
    }
    const action: Action = {
      id: randomUUID(),
      threadId: thread.id,
      turnId: text(p.turnId),
      kind,
      title:
        kind === 'questions'
          ? 'Your input is needed'
          : kind === 'permissions'
            ? 'Additional permissions requested'
            : kind === 'file'
              ? 'File change approval'
              : 'Command approval',
      detail: text(
        p.command || p.reason || p.cwd || 'Review this request before continuing.',
        8192,
      ),
      decisions: kind === 'permissions' ? ['accept', 'decline'] : ['accept', 'decline', 'cancel'],
      status: 'pending',
      blocking: kind === 'questions' ? p.isBlocking !== false : undefined,
      files: kind === 'file' ? thread.messages.find((m) => m.id === p.itemId)?.files : undefined,
      truncated:
        kind === 'file' ? thread.messages.find((m) => m.id === p.itemId)?.truncated : undefined,
    };
    action.detail =
      [
        p.command && `Command: ${text(p.command, 8192)}`,
        p.cwd && `Directory: ${text(p.cwd, 2048)}`,
        p.reason && `Reason: ${text(p.reason, 4096)}`,
        kind === 'permissions' &&
          `Requested permissions (this turn only):\n${JSON.stringify(p.permissions ?? {}, null, 2)}`,
        kind === 'file' &&
          (action.files?.length
            ? 'Review the proposed patch below.'
            : thread.messages.find((m) => m.id === p.itemId)?.text ||
              'The CLI did not provide a patch for this approval. Inspect the workspace before approving.'),
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 16384) || action.detail;
    if (kind === 'questions')
      action.questions = (Array.isArray(p.questions) ? p.questions : [])
        .filter((q: any) => typeof q.id === 'string' && typeof q.question === 'string')
        .map((q: any) => ({
          id: q.id,
          question: text(q.question, 4000),
          secret: q.isSecret === true,
          header: text(q.header, 80),
          allowOther: q.isOther === true,
          options: Array.isArray(q.options)
            ? q.options
                .filter((x: any) => typeof x.label === 'string')
                .slice(0, 10)
                .map((x: any) => ({
                  label: text(x.label, 200),
                  description: text(x.description, 1000),
                }))
            : undefined,
        }));
    if (
      kind === 'questions' &&
      (!action.questions?.length ||
        action.questions.length > 8 ||
        new Set(action.questions.map((q) => q.id)).size !== action.questions.length)
    ) {
      void this.driver
        .reject(event.id)
        ?.catch(() => console.error('Unable to reject invalid CLI questions.'));
      return;
    }
    this.actions.set(action.id, {
      action,
      rpcId: event.id,
      epoch: this.driver.epoch,
      permissions: p.permissions,
    });
    thread.actions = thread.actions.filter(
      (a) => a.status === 'pending' || a.status === 'responding',
    );
    thread.actions.push(action);
    thread.state = thread.actions.some((a) => a.kind !== 'questions')
      ? 'waitingApproval'
      : 'waitingInput';
    this.boundary(thread);
  }
  async file(projectId: string, path: string): Promise<FileContent> {
    const absolute = await this.safePath(projectId, path);
    const info = await stat(absolute).catch((error) => this.fileError(projectId, error));
    if (!info.isFile() || info.size > limits.file)
      throw new AppError('FILE_LIMIT', 'Choose a text file smaller than 256 KB.');
    const bytes = await readFile(absolute).catch((error) => this.fileError(projectId, error));
    if (bytes.length > limits.file)
      throw new AppError('FILE_LIMIT', 'This file grew beyond the 256 KB limit.');
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new AppError('BINARY_FILE', 'Only UTF-8 text files are supported.');
    }
    if (content.includes('\0')) throw new AppError('BINARY_FILE', 'Only text files are supported.');
    return {
      path,
      text: content,
      sha: createHash('sha256').update(bytes).digest('hex'),
      lines: content.split('\n').length,
    };
  }
  async files(projectId: string, path = '') {
    const absolute = await this.safePath(projectId, path);
    return (
      await readdir(absolute, { withFileTypes: true }).catch((error) =>
        this.fileError(projectId, error),
      )
    )
      .filter((x) => !x.name.startsWith('.'))
      .slice(0, 200)
      .map((x) => ({
        name: x.name,
        path: path ? `${path}/${x.name}` : x.name,
        directory: x.isDirectory(),
      }))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  }
  private async fileError(projectId: string, error: unknown): Promise<never> {
    await this.requireProject(projectId);
    if (record(error) && ['ENOENT', 'ENOTDIR'].includes(error.code))
      throw new AppError(
        'FILE_NOT_FOUND',
        'The selected file or directory no longer exists. Refresh Files.',
        404,
      );
    if (record(error) && ['EACCES', 'EPERM'].includes(error.code))
      throw new AppError('FILE_ACCESS', 'The selected file or directory cannot be accessed.', 403);
    throw error;
  }
  private async safePath(projectId: string, path: string) {
    if (
      isAbsolute(path) ||
      path.split(/[\\/]/).some((part) => part === '..' || part.startsWith('.'))
    )
      throw new AppError('PATH_DENIED', 'This path is outside the file browser scope.', 403);
    const project = await this.requireProject(projectId);
    const canonical = await realpath(resolve(project.path, path)).catch((error) =>
      this.fileError(projectId, error),
    );
    const rel = relative(project.path, canonical);
    if (rel.startsWith('..') || isAbsolute(rel))
      throw new AppError('PATH_DENIED', 'This path is outside the project.', 403);
    return canonical;
  }
  async close() {
    this.events.close();
    await this.admission;
    const queued = this.queue.close();
    await this.driver.stop();
    await queued;
    this.store.close();
  }
}
