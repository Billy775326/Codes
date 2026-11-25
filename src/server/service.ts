import { WorkspaceConfiguration } from './workspace-settings.js';
import { directoryStatus, directoryError } from './project-context.js';
import { nativeExecutionSettings } from './native-configuration.js';
import { activeTurn, interactionActivity } from '../shared/conversation-activity.js';
import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Driver } from '../codex/driver.js';
import { Store } from './store.js';
import { Events } from './events.js';
import { MessageQueue } from './message-queue.js';
import { ConversationQueue } from './conversation-queue.js';
import { pauseQueueAfterTurn, settleQueuedOperations } from './queue-transitions.js';
import { ProjectFiles } from './project-files.js';
import { ProjectFileManagement } from './project-file-management.js';
import type { GlobalInstructions, ProjectInstructions } from '../shared/project-instructions.js';
import { Images } from './images.js';
import { ModelSettings } from './model-settings.js';
import { AsyncQuestions } from './async-questions.js';
import { NativeInteractions, type ActionResolution } from './native-interactions.js';
import { encodeQuestionReplies } from '../shared/question-replies.js';
import { nativeMessage as item, nativeTurn } from './transcript.js';
import { readConversationHistory } from './conversation-history.js';
import { ConversationReads } from './conversation-reads.js';
import { nativeThreadState as state, nativeStatus, terminal } from './native-thread-status.js';
import { z } from 'zod';
import { AppError, record } from '../shared/errors.js';
import {
  limits,
  type Thread,
  type TurnInfo,
  type Settings,
  type Message,
  type Attachment,
  type FileContent,
  type State,
  type Summary,
  type QueuePayload,
  type ReviewTarget,
} from '../shared/types.js';

const text = (value: unknown, maximum: number = limits.item) =>
  typeof value === 'string' ? value.slice(0, maximum) : '';
export class Service {
  readonly events = new Events();
  readonly images: Images;
  private cache = new Map<string, Thread>();
  private loaded = new Set<string>();
  private readonly appliedNativeConfig = new WeakMap<Thread, string>();
  private readonly reads = new ConversationReads();
  private admission: Promise<void> = Promise.resolve();
  private managing = new Set<string>();
  readonly queue: MessageQueue;
  private readonly conversationQueue: ConversationQueue;
  readonly modelSettings: ModelSettings;
  private readonly asyncQuestions: AsyncQuestions;
  private sending = new Map<string, number>();
  private maintenance?: { expiresAt: number; timer: ReturnType<typeof setTimeout> };
  private usageBaseline = new WeakMap<Thread, { turnId: string; total: number; output?: number }>();
  private terminals = new Map<string, State>();
  private metadataRevision = 0;
  private metadataRevisions = new Map<string, number>();
  private readonly interactions: NativeInteractions;
  private readonly projectFiles: ProjectFiles;
  readonly fileManagement: ProjectFileManagement;
  readonly workspaceSettings: WorkspaceConfiguration;
  constructor(
    readonly store: Store,
    readonly driver: Driver,
    private readonly defaultProjectPath?: string,
  ) {
    this.workspaceSettings = new WorkspaceConfiguration(store.directory);
    this.projectFiles = new ProjectFiles(
      store,
      (id) => this.project(id),
      (id) => this.requireProject(id),
    );
    this.fileManagement = new ProjectFileManagement(
      store.directory,
      (id) => this.requireProject(id),
      (id) => this.project(id),
    );
    this.images = new Images(store.directory);
    this.asyncQuestions = new AsyncQuestions(store.db);
    this.interactions = new NativeInteractions(store, driver, {
      publish: (id) => {
        this.publishSummary(this.store.thread(id)!);
        this.emitActions(id);
      },
      emit: (id) => this.emitActions(id),
      boundary: (thread) => this.boundary(thread),
    });
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
        if (thread.writerConflict) {
          store.queue.pauseForReview(
            id,
            'Another Codex client owns this conversation. Check availability, then resume explicitly.',
          );
          this.queue.notify(id);
          return false;
        }
        if (thread.archived) {
          store.queue.pauseForReview(id, 'Restore the conversation before resuming the queue.');
          this.queue.notify(id);
          return false;
        }
        const { native } = await this.conversationOwner(id);
        const directory = await this.projectContext(thread.projectId);
        if (!directory.directory.available) {
          store.queue.pauseForReview(id, directory.directory.message!);
          this.queue.notify(id);
          return false;
        }
        if (native.status?.type === 'active') {
          store.queue.pauseForReview(
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
          store.queue.pauseForReview(id, 'The last native task has no confirmed result.');
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
          this.publishSummary(summary);
        }
      },
      () => !!this.maintenance,
    );
    this.conversationQueue = new ConversationQueue(store, this.queue, {
      isManaging: (id) => this.managing.has(id),
      requireAdmission: () => this.requireTaskAdmission(),
      checkSteering: async (id) => {
        const thread = this.cache.get(id);
        if (!thread)
          throw new AppError('CONVERSATION_ACTIVE', 'Open the active conversation first.', 409);
        await this.conversationOwner(id);
        await this.requireProject(thread.projectId);
      },
      steer: (id, operationId, turnId, prompt, attachments) =>
        this.steer(id, operationId, turnId, prompt, attachments),
    });
    driver.on('notification', (event) => this.notification(event));
    driver.on('request', (event) =>
      this.interactions.request(event, this.cache.get(event.params?.threadId)),
    );
    driver.on('offline', () => {
      this.loaded.clear();
      store.queue.pauseAll('The runtime stopped. Review outcomes before resuming.');
      for (const id of store.queue.pendingThreads()) this.queue.notify(id);
      for (const thread of this.cache.values()) {
        this.clearCompaction(thread, 'unknown');
        for (const steer of store.steers(thread.id)) store.update(steer.id, 'unknown');
        this.interactions.expireThread(thread);
        if (thread.pending) {
          thread.pending.state = 'unknown';
          store.update(thread.pending.id, 'unknown');
          thread.state = 'unknown';
        }
        this.boundary(thread);
        this.queue.notify(thread.id);
      }
      this.interactions.clear();
      this.events.publish('runtime', this.system());
    });
  }
  system() {
    const maintenance = this.maintenance;
    return {
      ...this.driver.system(),
      projectDirectoryFallback: this.defaultProjectPath,
      defaultProjectPath:
        this.workspaceSettings.snapshot().settings.defaultProjectDirectory ||
        this.defaultProjectPath,
      maintenance: maintenance
        ? {
            expiresAt: maintenance.expiresAt,
            ready:
              !this.sending.size &&
              !this.managing.size &&
              !this.interactions.size &&
              !this.store.db
                .prepare(
                  `SELECT 1 FROM operations
                WHERE state IN ('dispatching','acknowledged','unknown') LIMIT 1`,
                )
                .get() &&
              !this.store.db
                .prepare(
                  `SELECT 1 FROM queued_messages
                WHERE state IN ('dispatching','sent') LIMIT 1`,
                )
                .get(),
          }
        : undefined,
    };
  }
  async saveWorkspaceSettings(input: unknown) {
    const saved = await this.workspaceSettings.save(input);
    this.events.publish('runtime', this.system());
    return saved;
  }
  startMaintenance() {
    if (this.maintenance)
      throw new AppError('MAINTENANCE_ACTIVE', 'Maintenance is already active.', 409);
    const duration = 5 * 60_000;
    const timer = setTimeout(() => this.cancelMaintenance(), duration);
    timer.unref();
    this.maintenance = { expiresAt: Date.now() + duration, timer };
    const status = this.system();
    this.events.publish('runtime', status);
    return status;
  }
  cancelMaintenance() {
    if (this.maintenance) {
      clearTimeout(this.maintenance.timer);
      this.maintenance = undefined;
      this.events.publish('runtime', this.system());
      for (const id of this.store.queue.pendingThreads()) this.queue.wake(id);
    }
    return this.system();
  }
  private requireTaskAdmission() {
    if (this.maintenance)
      throw new AppError('MAINTENANCE_ACTIVE', 'Maintenance is active. New tasks are paused.', 503);
  }
  project(id: string) {
    const project = this.store.projects().find((x) => x.id === id);
    if (!project) throw new AppError('PROJECT_NOT_FOUND', 'Project not found.', 404);
    return project;
  }
  renameProject(id: string, name: string, expectedName: string) {
    const project = this.project(id);
    if (project.name === name) return project;
    if (project.name !== expectedName)
      throw new AppError(
        'PROJECT_NAME_CONFLICT',
        'This project was renamed in another window. Refresh and try again.',
        409,
      );
    this.store.renameProject(id, name);
    const updated = { ...project, name };
    this.events.publish('project', updated);
    return updated;
  }
  archiveProject(id: string, archived: boolean) {
    const project = this.project(id);
    const update = { id, archived };
    if (!!project.archived !== archived) {
      this.store.setProjectArchived(id, archived);
      this.events.publish('project-archive', update);
    }
    return update;
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
  projectInstructions(id: string) {
    return this.projectFiles.projectInstructions(id);
  }
  saveProjectInstructions(id: string, update: ProjectInstructions) {
    return this.projectFiles.saveProjectInstructions(id, update);
  }
  globalInstructions(update?: GlobalInstructions) {
    return this.projectFiles.globalInstructions(update);
  }
  async conversationContext(id: string) {
    const { saved } = await this.conversationOwner(id);
    return this.projectContext(saved.projectId);
  }
  async conversationFile(id: string, path: string, showHidden = false) {
    const { saved } = await this.conversationOwner(id);
    return this.file(saved.projectId, path, showHidden);
  }
  async conversationFiles(id: string, path: string, showHidden = false) {
    const { saved } = await this.conversationOwner(id);
    return this.files(saved.projectId, path, showHidden);
  }
  browseDirectory(projectId: string | undefined, path: string, showHidden: boolean) {
    return this.projectFiles.browseDirectory(projectId, path, showHidden);
  }
  browseLocation(projectId: string | undefined, path: string, showHidden: boolean) {
    return this.projectFiles.browseLocation(projectId, path, showHidden);
  }
  browseFile(projectId: string | undefined, path: string, showHidden: boolean) {
    return this.projectFiles.browseFile(projectId, path, showHidden);
  }
  browseImage(projectId: string | undefined, path: string, showHidden: boolean) {
    return this.projectFiles.browseImage(projectId, path, showHidden);
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
    change: { title?: string; archived?: boolean; updatedAt?: number },
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
      (change.archived !== undefined && change.archived !== saved.archived) ||
      (change.updatedAt !== undefined && change.updatedAt > saved.updatedAt);
    if (!force && !changed && !settled) return this.withSidebarActivity(saved);
    if (changed) this.metadataChanged(id);
    this.store.setMetadata(id, change);
    const updated = this.store.thread(id)!;
    const cached = this.cache.get(id);
    if (cached)
      Object.assign(cached, change, {
        updatedAt: updated.updatedAt,
        managementPending: updated.managementPending,
      });
    const summary = this.publishSummary(updated);
    this.events.publish(
      'state',
      {
        ...change,
        updatedAt: updated.updatedAt,
        managementPending: updated.managementPending,
      },
      id,
    );
    return summary;
  }
  private observeStatus(id: string, raw: unknown) {
    const status = nativeStatus.safeParse(raw);
    const saved = this.store.thread(id);
    if (!status.success || !saved || saved.executionPending) return;
    const cached = this.cache.get(id);
    if (cached?.actions.some((a) => ['pending', 'responding'].includes(a.status))) return;
    const next =
      status.data.type === 'notLoaded'
        ? activeTurn(saved.state)
          ? 'unknown'
          : saved.state
        : status.data.type === 'idle' && terminal(saved.state)
          ? saved.state
          : state(status.data);
    if (next === saved.state) return;
    this.metadataChanged(id);
    this.store.saveThread({ ...saved, state: next }, saved.settings);
    if (cached) cached.state = next;
    this.publishSummary(this.store.thread(id)!);
    this.events.publish('state', { state: next }, id);
  }
  withSidebarActivity<T extends Summary>(summary: T): T {
    const thread = this.cache.get(summary.id);
    const actions = thread?.actions ?? [];
    const questions = summary.archived ? [] : this.asyncQuestions.openInteractions(summary.id);
    const sidebarActivity = interactionActivity(
      summary.state,
      [...actions, ...questions],
      !!thread?.compaction,
    );
    return {
      ...summary,
      sidebarActivity,
      expiredQuestion: summary.executionUnknown
        ? (thread?.expiredQuestion ?? this.store.hasExpiredQuestion(summary.id))
        : undefined,
    };
  }
  private publishSummary<T extends Summary>(summary: T): T {
    const updated = this.withSidebarActivity(summary);
    this.events.publish('summary', updated, updated.id);
    return updated;
  }
  summaries(projectId: string) {
    return this.store.summaries(projectId).map((summary) => this.withSidebarActivity(summary));
  }
  async list(projectId: string) {
    await this.conversations(projectId, { limit: 30 });
    return this.summaries(projectId);
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
        const updatedAt =
          typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
            ? Math.max(0, raw.updatedAt * 1000)
            : 0;
        if (!saved)
          this.store.saveThread(
            {
              id: raw.id,
              projectId,
              title,
              state: state(raw.status),
              updatedAt,
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
            this.observeConversation(raw.id, { title, archived, updatedAt });
            this.observeStatus(raw.id, raw.status);
          }
        }
        const summary = this.store.thread(raw.id)!;
        if (
          !!summary.archived === archived &&
          (!search || summary.title.toLowerCase().includes(search.toLowerCase())) &&
          !ids.has(summary.id)
        ) {
          data.push(this.withSidebarActivity(summary));
          ids.add(summary.id);
        }
      }
      if (page.nextCursor && page.nextCursor === nativeCursor)
        throw new AppError('PROTOCOL_ERROR', 'The CLI repeated a conversation cursor.', 502);
      const nextCursor = page.nextCursor ? encode(page.nextCursor) : null;
      if (data.length || !nextCursor || pageNumber === 3)
        return {
          data,
          nextCursor,
          scanned,
          latestConversationAt: this.store.latestConversationAt(projectId),
        };
      if (seen.has(page.nextCursor))
        throw new AppError('PROTOCOL_ERROR', 'The CLI repeated a conversation cursor.', 502);
      seen.add(page.nextCursor);
      nativeCursor = page.nextCursor;
    }
    throw new AppError('PROTOCOL_ERROR', 'Invalid conversation scan.', 502);
  }
  private async conversationOwner(id: string, timeoutMs?: number) {
    const saved = this.store.thread(id);
    if (!saved) throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
    const project = this.project(saved.projectId);
    const response = await this.driver.call(
      'thread/read',
      { threadId: id, includeTurns: false },
      timeoutMs,
    );
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
  async create(projectId: string, settings: Settings = {}) {
    const project = await this.requireProject(projectId);
    const native = await this.modelSettings.configuration.read(project.path);
    const result = await this.driver.call('thread/start', {
      cwd: project.path,
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
      resolvedModel: nativeExecutionSettings(result).model,
      nativeSettings: nativeExecutionSettings(result),
      queue: this.store.queue.state(result.thread.id),
    };
    this.store.saveThread(thread, settings);
    this.loaded.add(thread.id);
    this.appliedNativeConfig.set(thread, native.key);
    await this.remember(thread);
    this.boundary(thread);
    return thread;
  }
  private remember(thread: Thread) {
    const work = this.admission.then(async () => {
      if (!this.cache.has(thread.id) && this.cache.size >= limits.idleThreads) {
        const candidate = [...this.cache.values()].find((x) => !x.pending && !activeTurn(x.state));
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
  async read(id: string, signal?: AbortSignal): Promise<Thread> {
    signal?.throwIfAborted();
    const existing = this.cache.get(id);
    if (existing) return existing;
    return this.reads.run(
      'snapshot:' + id,
      signal ? 'snapshot' : 'operation',
      signal,
      (readSignal) => this.load(id, readSignal),
    );
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
  private async load(id: string, signal: AbortSignal) {
    const saved = this.store.thread(id);
    if (!saved) throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
    this.project(saved.projectId);
    const page = await this.readHistory(id, undefined, signal);
    signal.throwIfAborted();
    const pending = this.store.active(id);
    const metadata = this.store.thread(id)!;
    const thread: Thread = {
      ...metadata,
      expiredQuestion: this.store.hasExpiredQuestion(id),
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
    this.publishSummary(this.store.thread(id)!);
    return thread;
  }
  history(id: string, continuation?: string, signal?: AbortSignal) {
    return this.reads.run(
      'history:' + JSON.stringify([id, continuation]),
      signal ? 'history' : 'operation',
      signal,
      (readSignal) => this.readHistory(id, continuation, readSignal),
    );
  }
  private async readHistory(id: string, continuation: string | undefined, signal: AbortSignal) {
    const saved = this.store.thread(id);
    if (!saved) throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
    const project = this.project(saved.projectId);
    const { interruptedTurns, ...page } = await readConversationHistory(
      this.driver,
      id,
      project.path,
      continuation,
      signal,
      (path) => this.images.reference(saved.projectId, path),
    );
    signal.throwIfAborted();
    let questionChanged = this.asyncQuestions.observeHistory(id, page.messages);
    for (const turnId of interruptedTurns)
      if (this.asyncQuestions.expireTurn(id, turnId)) questionChanged = true;
    if (questionChanged) this.publishQuestions(id);
    return { ...page, turns: this.store.attachTurnUsage(id, page.turns) };
  }
  queueState(id: string) {
    return this.conversationQueue.queueState(id);
  }
  enqueue(id: string, messageId: string, payload: QueuePayload) {
    return this.conversationQueue.enqueue(id, messageId, payload);
  }
  editQueued(id: string, messageId: string, text: string, removeFileReferences = false) {
    return this.conversationQueue.editQueued(id, messageId, text, removeFileReferences);
  }
  cancelQueued(id: string, messageId: string) {
    return this.conversationQueue.cancelQueued(id, messageId);
  }
  steerQueued(id: string, messageId: string, expectedTurnId: string) {
    return this.conversationQueue.steerQueued(id, messageId, expectedTurnId);
  }
  controlQueue(id: string, paused: boolean) {
    return this.conversationQueue.controlQueue(id, paused);
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
  async branchPoint(id: string) {
    await this.driver.requireFeature('branch', 'Conversation branching');
    await this.conversationOwner(id, 10000);
    const page = await this.driver.call(
      'thread/turns/list',
      {
        threadId: id,
        limit: 12,
        itemsView: 'notLoaded',
        sortDirection: 'desc',
      },
      10000,
    );
    if (
      !Array.isArray(page.data) ||
      page.data.length > 12 ||
      !page.data.every(
        (entry: unknown) =>
          record(entry) && typeof entry.id === 'string' && typeof entry.status === 'string',
      )
    )
      throw new AppError('PROTOCOL_ERROR', 'Invalid native turn metadata.', 502);
    const turn = page.data.find(
      (turn: any) => typeof turn.id === 'string' && terminal(turn.status),
    );
    if (!turn)
      throw new AppError(
        'NO_BRANCH_POINT',
        'No completed turn was found in the recent history. Load an earlier completed turn to branch from.',
        409,
      );
    return { lastTurnId: turn.id };
  }
  async retryWriter(id: string) {
    if (
      this.managing.has(id) ||
      this.store.pendingManagement(id) ||
      this.store.active(id) ||
      this.store.steers(id).length
    )
      throw new AppError(
        'EXECUTION_UNKNOWN',
        'Finish or verify the existing operation before checking ownership.',
        409,
      );
    this.managing.add(id);
    try {
      const thread = await this.read(id);
      const { saved } = await this.conversationOwner(id, 10000);
      await this.requireProject(saved.projectId);
      if (!this.loaded.has(id)) {
        const resumed = await this.driver.call(
          'thread/resume',
          {
            threadId: id,
            excludeTurns: true,
            cwd: this.project(saved.projectId).path,
          },
          10000,
        );
        if (resumed.thread?.id !== id || resumed.thread?.cwd !== this.project(saved.projectId).path)
          throw new AppError('PROTOCOL_ERROR', 'Invalid native resume metadata.', 502);
        this.loaded.add(id);
        thread.state = state(resumed.thread.status);
        thread.resolvedModel = typeof resumed.model === 'string' ? resumed.model : undefined;
      }
      thread.writerConflict = false;
      this.boundary(thread);
      return thread;
    } catch (error) {
      if (error instanceof AppError && error.code === 'THREAD_WRITER_BUSY') {
        const thread = this.cache.get(id);
        if (thread) {
          thread.writerConflict = true;
          this.boundary(thread);
        }
      }
      throw error;
    } finally {
      this.managing.delete(id);
    }
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
    await this.driver.requireFeature('branch', 'Conversation branching');
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
      this.store.saveThread(child, {});
      this.store.result(operationId, child.id);
      this.store.update(operationId, 'completed');
      try {
        await this.driver.call('thread/unsubscribe', { threadId: child.id }, 5000);
      } catch {
        console.error('Unable to unsubscribe an unused conversation branch.');
      }
      this.publishSummary(this.store.thread(child.id)!);
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
      if (attachment.kind === 'uploaded-file') {
        const content = this.store.uploadedFile(projectId, attachment.id);
        if (content === undefined)
          throw new AppError(
            'FILE_NOT_FOUND',
            'The uploaded file is unavailable. Attach it again.',
            404,
          );
        context += `\n\nUploaded file context ${JSON.stringify({ name: attachment.name })}:\n${content}`;
        continue;
      }
      if (attachment.kind === 'file-reference') {
        await this.fileManagement.verifyReference(projectId, attachment);
        context += `\n\nUser-selected project file reference (read from the project directory as needed): ${JSON.stringify({ path: attachment.path })}`;
        continue;
      }
      const file = await this.file(projectId, attachment.path, attachment.showHidden);
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
    await this.driver.requireFeature('review', 'Native code review');
    const title =
      target.type === 'baseBranch'
        ? 'changes against ' + target.branch
        : target.type === 'commit'
          ? 'commit ' + target.sha
          : target.type === 'custom'
            ? target.instructions
            : 'uncommitted changes';
    return this.send(id, operationId, 'Review: ' + title, settings, [], false, target);
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
      await this.modelSettings.checkImages(thread.resolvedModel ?? thread.settings.model);
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
    this.requireTaskAdmission();
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
      const uncertain = !(error instanceof AppError) || error.uncertain;
      this.store.update(
        operationId,
        uncertain ? 'unknown' : 'failed',
        undefined,
        error instanceof AppError ? error.message : 'The follow-up result is unknown.',
      );
      if (uncertain) this.store.queue.pauseForReview(id, 'An execution result is unknown.');
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
    if (!existing) this.requireTaskAdmission();
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
    const previousState = thread.state;
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
        thread.nativeSettings = nativeExecutionSettings(resumed);
        this.loaded.add(id);
        this.appliedNativeConfig.delete(thread);
      }
      thread.writerConflict = false;
      const native = await this.modelSettings.configuration.read(project.path);
      if (review || this.appliedNativeConfig.get(thread) !== native.key) {
        const owner = await this.conversationOwner(id);
        if (owner.native.status?.type === 'active')
          throw new AppError('CONVERSATION_ACTIVE', 'Finish the active native task first.', 409);
      }
      if (this.appliedNativeConfig.get(thread) !== native.key) {
        thread.nativeSettings = await this.modelSettings.configuration.synchronizeThread(
          id,
          project.path,
          native.key,
        );
        if ((await this.modelSettings.configuration.read(project.path)).key !== native.key)
          throw new AppError(
            'SETTINGS_CONFLICT',
            'Codex configuration changed. Review it before retrying.',
            409,
          );
        thread.resolvedModel = thread.nativeSettings.model;
        this.appliedNativeConfig.set(thread, native.key);
      }
      const collaborationMode = review
        ? undefined
        : (
            await this.modelSettings.resolve(
              settings,
              project.path,
              nativeInput.some((entry) => entry.type === 'localImage'),
              thread.resolvedModel,
              native,
            )
          ).collaborationMode;
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
              collaborationMode,
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
        this.store.queue.pauseForReview(id, 'An execution result is unknown.');
        if (thread.pending) thread.pending.state = 'unknown';
      } else {
        delete thread.pending;
        thread.state =
          error instanceof AppError && error.code === 'THREAD_WRITER_BUSY'
            ? previousState
            : 'failed';
        if (error instanceof AppError && error.code === 'THREAD_WRITER_BUSY')
          thread.writerConflict = true;
        else pauseQueueAfterTurn(this.store, id, thread.state);
      }
      this.boundary(thread);
      throw error;
    }
  }
  async reconcile(id: string) {
    const thread = await this.read(id);
    const pending = this.store.active(id);
    if (!pending && !this.store.steers(id).length) {
      settleQueuedOperations(this.store, thread);
      this.queue.notify(id);
      return thread;
    }
    const history = await this.history(id);
    for (const steer of this.store.steers(id)) {
      const nativeItem = history.messages.find(
        (entry) =>
          entry.clientId === steer.id &&
          (entry.kind === 'user' || (steer.questionReply && !!entry.answeredQuestions?.length)),
      );
      const known = history.turns.find(
        (turn: any) => turn.id === (nativeItem?.turnId || steer.turnId),
      );
      if (known && terminal(known.status)) this.store.update(steer.id, 'completed', known.id);
      // An exact native user item proves acceptance before the enclosing turn finishes.
      else if (steer.state !== 'acknowledged' && nativeItem?.turnId)
        this.store.update(steer.id, 'acknowledged', nativeItem.turnId);
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
      pauseQueueAfterTurn(this.store, id, match.status);
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
          // A native acknowledgement can precede runner registration.
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
  async answer(id: string, operationId: string, resolution: ActionResolution) {
    if (id.startsWith('async-')) return this.answerAsync(id, operationId, resolution);
    return this.interactions.answer(id, operationId, resolution);
  }
  private async answerAsync(id: string, operationId: string, resolution: ActionResolution) {
    const action = this.asyncQuestions.action(id);
    if (!action || this.store.thread(action.threadId)?.archived)
      throw new AppError('STALE_ACTION', 'This question is unavailable.', 409);
    const threadId = action.threadId;
    if (resolution.decision === 'skip') {
      const receipt = this.store.existing(operationId, threadId, 'async-skip', { id, resolution });
      if (receipt) return receipt;
      if (action.status !== 'pending' || Object.keys(resolution.answers ?? {}).length)
        throw new AppError('STALE_ACTION', 'This question is already being handled.', 409);
      this.store.db.exec('BEGIN IMMEDIATE');
      try {
        this.store.begin(operationId, threadId, 'async-skip', { id, resolution });
        this.asyncQuestions.skip(action.id);
        this.store.update(operationId, 'completed');
        this.store.db.exec('COMMIT');
      } catch (error) {
        this.store.db.exec('ROLLBACK');
        throw error;
      }
      this.publishQuestions(threadId);
      return this.store.operation(operationId)!;
    }
    if (action.status !== 'pending')
      throw new AppError('STALE_ACTION', 'This question is already being handled.', 409);
    const thread = await this.read(threadId);
    // Native history can contain an answer submitted by another client since our last event.
    await this.history(threadId);
    const current = this.asyncQuestions.action(id);
    if (!current || current.status !== 'pending' || this.store.thread(threadId)?.archived)
      throw new AppError('STALE_ACTION', 'This question is already being handled.', 409);
    if (this.store.operation(operationId))
      throw new AppError('OPERATION_CONFLICT', 'This answer operation already exists.', 409);
    const received = Object.entries(resolution.answers ?? {});
    const answers = Object.fromEntries(
      received.map(([key, answer]) => [current.legacyQuestion?.questionIds[key] ?? key, answer]),
    );
    const questions = current.questions ?? [];
    if (
      resolution.decision ||
      received.length !== questions.length ||
      Object.keys(answers).length !== questions.length ||
      questions.some((question) => !answers[question.id]?.trim())
    )
      throw new AppError('ANSWER_REQUIRED', 'Answer each remaining question before submitting.');
    const replies = questions.map((question) => ({
      questionItemId: question.id,
      question: question.question,
      answer: answers[question.id]!.trim(),
    }));
    const prompt = encodeQuestionReplies(replies);
    if (prompt.length > 50_000)
      throw new AppError('INVALID_ANSWER', 'Shorten the combined answers before submitting.');
    if (['waitingInput', 'waitingApproval', 'unknown'].includes(thread.state))
      throw new AppError(
        'ANSWER_WAIT',
        'Resolve the current task request or check its result before answering.',
        409,
      );
    this.asyncQuestions.beginReply(current.id, operationId);
    this.publishQuestions(threadId);
    try {
      const receipt =
        thread.state === 'running' && thread.turnId
          ? await this.steer(threadId, operationId, thread.turnId, prompt)
          : await this.send(threadId, operationId, prompt, {});
      if (receipt.state === 'acknowledged' || receipt.state === 'completed')
        this.asyncQuestions.confirmReply(threadId, replies);
      return receipt;
    } finally {
      this.asyncQuestions.finishReply(current.id);
      this.publishQuestions(threadId);
    }
  }
  private boundary(thread: Thread) {
    thread.expiredQuestion =
      !thread.actions.some(
        (a) => a.kind === 'questions' && (a.status === 'pending' || a.status === 'responding'),
      ) && this.store.hasExpiredQuestion(thread.id);
    settleQueuedOperations(this.store, thread);
    thread.composerSettings = this.store.settingsProfile(thread.id);
    // Protect lifecycle state and first-prompt titles from older thread/list replies.
    this.metadataChanged(thread.id);
    this.store.saveThread(thread, thread.settings);
    const { id, title, state, updatedAt } = thread;
    thread.steering = this.store.steers(id);
    const summary = this.store.thread(id)!;
    Object.assign(thread, summary);
    this.publishSummary(summary);
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
        nativeSettings: thread.nativeSettings,
        writerConflict: thread.writerConflict ?? false,
        expiredQuestion: thread.expiredQuestion,
      },
      id,
    );
    this.emitActions(id);
    if (!thread.pending && !thread.steering?.length) {
      this.queue.wake(id);
      for (const waiting of this.store.queue.pendingThreads()) this.queue.wake(waiting);
    }
    this.queue.notify(id);
  }
  conversationActions(id: string) {
    const native =
      this.cache
        .get(id)
        ?.actions.filter(
          (a) => a.kind === 'questions' || a.status === 'pending' || a.status === 'responding',
        ) ?? [];
    return [...native, ...this.asyncQuestions.actions(id)];
  }
  private emitActions(id: string) {
    this.events.publish('actions', this.conversationActions(id), id);
  }
  private publishQuestions(id: string) {
    const summary = this.store.thread(id);
    if (!summary) return;
    this.publishSummary(summary);
    this.emitActions(id);
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
        this.store.queue.pauseForReview(closed.id, 'An execution result is unknown.');
        this.interactions.expireThread(closed);
        this.boundary(closed);
      }
      return;
    }
    const thread = this.cache.get(p.threadId);
    if (!thread) return;
    if (event.method === 'thread/settings/updated') {
      thread.nativeSettings = nativeExecutionSettings(p.threadSettings);
      this.events.publish('state', { nativeSettings: thread.nativeSettings }, thread.id);
      return;
    }
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
      if (!parsed.success || p.turnId !== thread.turnId || !activeTurn(thread.state)) return;
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
          last: z.object({
            totalTokens: z.number().int().nonnegative(),
            outputTokens: z.number().int().nonnegative().optional(),
          }),
          total: z.object({
            totalTokens: z.number().int().nonnegative(),
            outputTokens: z.number().int().nonnegative().optional(),
          }),
          modelContextWindow: z.number().int().positive().nullish(),
        })
        .safeParse(p.tokenUsage);
      if (usage.success && typeof p.turnId === 'string' && p.turnId === thread.turnId) {
        const { last, total, modelContextWindow } = usage.data;
        if (last.totalTokens > total.totalTokens) return;
        let baseline = this.usageBaseline.get(thread);
        if (!baseline || baseline.turnId !== p.turnId) {
          baseline = {
            turnId: p.turnId,
            total: total.totalTokens - last.totalTokens,
            output:
              total.outputTokens !== undefined &&
              last.outputTokens !== undefined &&
              last.outputTokens <= total.outputTokens
                ? total.outputTokens - last.outputTokens
                : undefined,
          };
          this.usageBaseline.set(thread, baseline);
        }
        const previous = thread.usage;
        if (previous && previous.turnId === p.turnId && total.totalTokens < previous.totalTokens)
          return;
        thread.usage = {
          turnId: p.turnId,
          contextTokens: last.totalTokens,
          totalTokens: total.totalTokens,
          contextWindow: modelContextWindow ?? undefined,
          turnTotalTokens: total.totalTokens - baseline.total,
          turnOutputTokens:
            total.outputTokens !== undefined &&
            baseline.output !== undefined &&
            total.outputTokens >= baseline.output
              ? total.outputTokens - baseline.output
              : undefined,
        };
        const finished = thread.turns?.find(
          (turn) => turn.id === p.turnId && terminal(turn.status),
        );
        if (finished) this.recordTurnUsage(thread, finished);
        this.events.publish(
          'state',
          {
            usage: thread.usage,
            ...(finished ? { turns: thread.turns } : {}),
          },
          thread.id,
        );
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
      this.interactions.resolve(thread, p.requestId);
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
      if (event.method === 'turn/completed' && terminal(info.status))
        this.recordTurnUsage(thread, info);
      const previous = thread.turns?.find((turn) => turn.id === info.id);
      const terminalKey = thread.id + '/' + p.turn.id;
      const newTerminal = !terminal(previous?.status) && !this.terminals.has(terminalKey);
      thread.turns = [
        ...(thread.turns ?? []).filter((turn) => turn.id !== info.id),
        { ...previous, ...info },
      ].slice(-300);
      if (event.method === 'turn/completed' && terminal(p.turn.status)) {
        this.terminals.set(terminalKey, p.turn.status);
        while (this.terminals.size > 100)
          this.terminals.delete(this.terminals.keys().next().value!);
      }
      const pendingOperation = this.store.active(thread.id);
      const review = pendingOperation && this.store.operation(pendingOperation.id);
      for (const raw of Array.isArray(p.turn.items) ? p.turn.items : [])
        this.applyItem(thread, raw, p.turn.id);
      if (p.turn.status === 'failed' || p.turn.status === 'interrupted')
        this.asyncQuestions.expireTurn(thread.id, p.turn.id);
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
        if (newTerminal) pauseQueueAfterTurn(this.store, thread.id, thread.state);
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
        this.interactions.expireTurn(p.turn.id);
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
  private recordTurnUsage(thread: Thread, turn: TurnInfo) {
    const usage = thread.usage;
    if (!usage || usage.turnId !== turn.id || usage.turnTotalTokens === undefined) return;
    turn.usage = {
      totalTokens: usage.turnTotalTokens,
      outputTokens: usage.turnOutputTokens ?? turn.usage?.outputTokens,
    };
    this.store.saveTurnUsage(thread.id, turn.id, turn.usage);
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
      if (turnId !== thread.turnId || !activeTurn(thread.state)) return;
      const previousCompaction = thread.compaction?.id;
      if (lifecycle === 'inProgress' && typeof raw.id === 'string')
        thread.compaction = { id: raw.id, turnId };
      else if (lifecycle === 'completed' && thread.compaction?.id === raw.id)
        delete thread.compaction;
      this.events.publish('state', { compaction: thread.compaction ?? null }, thread.id);
      if (previousCompaction !== thread.compaction?.id)
        this.publishSummary(this.store.thread(thread.id)!);
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
    if (lifecycle !== 'inProgress' && this.asyncQuestions.observe(thread.id, message))
      this.publishQuestions(thread.id);
  }
  uploadFile(projectId: string, bytes: Buffer, name: string) {
    return this.projectFiles.uploadFile(projectId, bytes, name);
  }
  file(projectId: string, path: string, showHidden = false) {
    return this.projectFiles.file(projectId, path, showHidden);
  }
  files(projectId: string, path = '', showHidden = false) {
    return this.projectFiles.files(projectId, path, showHidden);
  }
  projectImage(projectId: string, path: string, showHidden = false) {
    return this.projectFiles.projectImage(projectId, path, showHidden);
  }
  workspaceImage(path: string) {
    return this.projectFiles.workspaceImage(path);
  }
  async close() {
    clearTimeout(this.maintenance?.timer);
    this.events.close();
    const reads = this.reads.close();
    await this.admission;
    const queued = this.queue.close();
    await this.driver.stop();
    await Promise.all([queued, reads]);
    this.store.close();
  }
}
