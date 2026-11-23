import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Operation,
  Project,
  Settings,
  SettingsProfile,
  Summary,
  TurnInfo,
  TurnUsage,
} from '../shared/types.js';
import { limits, sameSettings } from '../shared/types.js';
import { parseQuestionReplies } from '../shared/question-replies.js';
import { settingsSchema, settingsProfileSchema } from '../shared/settings.js';
import { AppError } from '../shared/errors.js';
import { QueueStore, queueSchema } from './queue-store.js';

const retainedTurnUsage = 1000;
const projectArchiveStatus =
  'EXISTS (SELECT 1 FROM project_archives a WHERE a.project_id=p.id) AS archived';

type ProjectRow = Omit<Project, 'archived'> & { archived: number };

export class Store {
  readonly db: DatabaseSync;
  readonly queue: QueueStore;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'codes.sqlite'));
    chmodSync(join(directory, 'codes.sqlite'), 0o600);
    if (
      this.db.prepare("SELECT name FROM sqlite_master WHERE name='meta'").get() &&
      ![1, 2, 3, 4].includes((this.db.prepare('SELECT version FROM meta').get() as any)?.version)
    ) {
      this.db.close();
      throw new AppError(
        'DATABASE_VERSION',
        'This database was created by an unsupported version.',
        500,
      );
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS meta (version INTEGER NOT NULL);
      INSERT INTO meta SELECT 4 WHERE NOT EXISTS (SELECT 1 FROM meta);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL, settings TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, forked_from_id TEXT);
      CREATE INDEX IF NOT EXISTS thread_project_updated ON threads(project_id, updated_at);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id), kind TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, turn_id TEXT, error TEXT, pending_text TEXT, created_at INTEGER NOT NULL, result_id TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS active_turn ON operations(thread_id) WHERE kind IN ('send','review') AND state IN ('dispatching','acknowledged','unknown');`);
    const version = (this.db.prepare('SELECT version FROM meta').get() as any).version;
    if (version < 4) {
      const backup = join(
        directory,
        'codes.schema-v' + version + '-' + Date.now() + '-' + randomUUID() + '.sqlite',
      );
      try {
        closeSync(openSync(backup, 'wx', 0o600));
        this.db.prepare('VACUUM INTO ?').run(backup);
      } catch (error) {
        this.db.close();
        throw error;
      }
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (version === 1)
          this.db.exec('ALTER TABLE threads ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;');
        if (version < 3)
          this.db.exec(
            'ALTER TABLE threads ADD COLUMN forked_from_id TEXT; ALTER TABLE operations ADD COLUMN result_id TEXT;',
          );
        this.db.exec(
          queueSchema +
            `DROP INDEX IF EXISTS active_turn;
          CREATE UNIQUE INDEX active_turn ON operations(thread_id) WHERE kind IN ('send','review') AND state IN ('dispatching','acknowledged','unknown');
          UPDATE meta SET version=4; COMMIT;`,
        );
      } catch (error) {
        this.db.exec('ROLLBACK');
        this.db.close();
        throw error;
      }
    } else this.db.exec(queueSchema);
    this.db.exec(`CREATE TABLE IF NOT EXISTS project_archives (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE
    );`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS setting_profiles (
      scope TEXT PRIMARY KEY, revision INTEGER NOT NULL, settings TEXT NOT NULL);
      INSERT OR IGNORE INTO setting_profiles SELECT 'thread:'||id,0,settings FROM threads;`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS waiting_question_operations (
      operation_id TEXT PRIMARY KEY REFERENCES operations(id) ON DELETE CASCADE
    );`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS turn_usage (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL,
      total_tokens INTEGER NOT NULL,
      output_tokens INTEGER,
      PRIMARY KEY (thread_id, turn_id)
    );`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS uploaded_files (
      project_id TEXT NOT NULL REFERENCES projects(id),
      id TEXT NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );`);
    this.queue = new QueueStore(this.db);
    this.queue.recover();
    this.db.exec(
      "UPDATE operations SET state='unknown' WHERE state IN ('dispatching','acknowledged'); UPDATE threads SET state='unknown' WHERE state IN ('running','waitingApproval','waitingInput');",
    );
  }
  projects(): Project[] {
    return this.readProjects(`SELECT p.*, ${projectArchiveStatus} FROM projects p ORDER BY p.name`);
  }
  projectsWithActivity(): Project[] {
    return this.readProjects(`SELECT p.*, ${projectArchiveStatus}, coalesce(
      (SELECT max(t.updated_at) FROM threads t WHERE t.project_id=p.id), 0
    ) AS latestConversationAt FROM projects p ORDER BY p.name`);
  }
  private readProjects(sql: string): Project[] {
    const rows = this.db.prepare(sql).all() as unknown as ProjectRow[];
    return rows.map(({ archived, ...project }) =>
      archived ? { ...project, archived: true } : project,
    );
  }
  latestConversationAt(projectId: string) {
    const row = this.db
      .prepare('SELECT max(updated_at) AS updatedAt FROM threads WHERE project_id=?')
      .get(projectId) as { updatedAt: number | null };
    return row.updatedAt ?? undefined;
  }
  saveUploadedFile(projectId: string, content: string) {
    const id = createHash('sha256').update(content).digest('hex');
    const result = this.db
      .prepare(
        `INSERT INTO uploaded_files (project_id,id,content)
        SELECT ?,?,? WHERE (SELECT count(*) FROM uploaded_files) < ?
        ON CONFLICT(project_id,id) DO NOTHING`,
      )
      .run(projectId, id, content, limits.uploadedFiles);
    if (!result.changes && this.uploadedFile(projectId, id) === undefined)
      throw new AppError('FILE_STORAGE_FULL', 'Uploaded file storage is full.', 413);
    return id;
  }
  uploadedFile(projectId: string, id: string) {
    const row = this.db
      .prepare('SELECT content FROM uploaded_files WHERE project_id=? AND id=?')
      .get(projectId, id) as { content: string } | undefined;
    return row?.content;
  }
  settingsProfile(id?: string): SettingsProfile {
    if (id && !this.thread(id))
      throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
    const row = this.db
      .prepare('SELECT revision,settings FROM setting_profiles WHERE scope=?')
      .get(id ? 'thread:' + id : 'defaults') as { revision: number; settings: string } | undefined;
    if (!row)
      return {
        revision: 0,
        settings: id ? this.thread(id)!.settings : { permission: 'read-only' },
      };
    try {
      return settingsProfileSchema.parse({
        revision: row.revision,
        settings: JSON.parse(row.settings),
      });
    } catch {
      throw new AppError(
        'SETTINGS_STORAGE',
        'Saved settings are invalid. Restore the configuration before changing it.',
        500,
      );
    }
  }
  saveSettingsProfile(
    id: string | undefined,
    revision: number,
    settings: Settings,
  ): SettingsProfile {
    const next = settingsSchema.parse(settings);
    const current = this.settingsProfile(id);
    if (sameSettings(current.settings, next)) return current;
    if (revision !== current.revision)
      throw new AppError(
        'SETTINGS_CONFLICT',
        'Settings changed in another window. Reload them before saving again.',
        409,
      );
    const row = this.db
      .prepare(
        `INSERT INTO setting_profiles VALUES(?,?,?)
      ON CONFLICT(scope) DO UPDATE SET revision=setting_profiles.revision+1,settings=excluded.settings
      WHERE setting_profiles.revision=? RETURNING revision`,
      )
      .get(id ? 'thread:' + id : 'defaults', revision + 1, JSON.stringify(next), revision) as
      { revision: number } | undefined;
    if (!row)
      throw new AppError(
        'SETTINGS_CONFLICT',
        'Settings changed in another window. Reload them before saving again.',
        409,
      );
    return { revision: row.revision, settings: next };
  }
  addProject(name: string, path: string): Project {
    const existing = this.projects().find((p) => p.path === path);
    if (existing) return existing;
    const project = { id: randomUUID(), name, path };
    this.db.prepare('INSERT INTO projects VALUES(?,?,?)').run(project.id, name, path);
    return project;
  }
  renameProject(id: string, name: string) {
    this.db.prepare('UPDATE projects SET name=? WHERE id=?').run(name, id);
  }
  setProjectArchived(id: string, archived: boolean) {
    const sql = archived
      ? 'INSERT INTO project_archives(project_id) VALUES(?) ON CONFLICT DO NOTHING'
      : 'DELETE FROM project_archives WHERE project_id=?';
    this.db.prepare(sql).run(id);
  }
  summaries(projectId: string): Summary[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM threads WHERE project_id=? AND archived=0 ORDER BY updated_at DESC LIMIT 200',
        )
        .all(projectId) as any[]
    ).map((row) => this.summary(row));
  }
  summary(row: any): Summary {
    const execution = this.db
      .prepare(
        `
      SELECT count(*) AS count, coalesce(max(state='unknown'),0) AS unknown_result
      FROM operations WHERE thread_id=? AND kind IN ('send','review','steer')
        AND state IN ('dispatching','acknowledged','unknown')
    `,
      )
      .get(row.id) as { count: number; unknown_result: number };
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      state: row.state,
      updatedAt: row.updated_at,
      archived: !!row.archived,
      forkedFromId: row.forked_from_id ?? undefined,
      ...this.queue.summary(row.id),
      executionUnknown: !!execution.unknown_result,
      managementPending: !!this.pendingManagement(row.id),
      executionPending: execution.count > 0,
    };
  }
  thread(id: string): (Summary & { settings: Settings }) | undefined {
    const row = this.db.prepare('SELECT * FROM threads WHERE id=?').get(id) as any;
    return row && { ...this.summary(row), settings: JSON.parse(row.settings) };
  }
  saveThread(thread: Summary, settings: Settings) {
    this.db
      .prepare(
        'INSERT INTO threads(id,project_id,title,state,updated_at,settings,archived,forked_from_id) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,state=excluded.state,updated_at=excluded.updated_at,settings=excluded.settings,archived=excluded.archived,forked_from_id=COALESCE(excluded.forked_from_id,threads.forked_from_id)',
      )
      .run(
        thread.id,
        thread.projectId,
        thread.title,
        thread.state,
        thread.updatedAt,
        JSON.stringify(settings),
        Number(thread.archived ?? false),
        thread.forkedFromId ?? null,
      );
    this.db
      .prepare('INSERT OR IGNORE INTO setting_profiles VALUES(?,0,?)')
      .run('thread:' + thread.id, JSON.stringify(settings));
  }
  pendingManagement(
    threadId: string,
  ): { id: string; archived: boolean; epoch: string } | undefined {
    const row = this.db
      .prepare(
        "SELECT id,pending_text FROM operations WHERE thread_id=? AND kind='archive' AND state IN ('dispatching','acknowledged','unknown') ORDER BY created_at DESC LIMIT 1",
      )
      .get(threadId) as any;
    if (!row) return;
    const value = JSON.parse(row.pending_text);
    return { id: row.id, archived: value.archived, epoch: value.epoch };
  }
  setMetadata(id: string, change: { title?: string; archived?: boolean; updatedAt?: number }) {
    if (change.title !== undefined)
      this.db.prepare('UPDATE threads SET title=? WHERE id=?').run(change.title, id);
    if (change.archived !== undefined)
      this.db.prepare('UPDATE threads SET archived=? WHERE id=?').run(Number(change.archived), id);
    if (change.updatedAt !== undefined)
      this.db
        .prepare('UPDATE threads SET updated_at=max(updated_at,?) WHERE id=?')
        .run(change.updatedAt, id);
  }
  operation(id: string): Operation | undefined {
    const row = this.db.prepare('SELECT * FROM operations WHERE id=?').get(id) as any;
    return (
      row && {
        id: row.id,
        threadId: row.thread_id,
        kind: row.kind,
        state: row.state,
        turnId: row.turn_id ?? undefined,
        error: row.error ?? undefined,
        resultId: row.result_id ?? undefined,
      }
    );
  }
  saveTurnUsage(threadId: string, turnId: string, usage: TurnUsage) {
    this.db
      .prepare(
        `INSERT INTO turn_usage VALUES (?, ?, ?, ?)
      ON CONFLICT(thread_id, turn_id) DO UPDATE SET
        total_tokens=excluded.total_tokens,
        output_tokens=coalesce(excluded.output_tokens, output_tokens)`,
      )
      .run(threadId, turnId, usage.totalTokens, usage.outputTokens ?? null);
    this.db
      .prepare(
        `DELETE FROM turn_usage WHERE rowid IN (
      SELECT rowid FROM turn_usage WHERE thread_id=? ORDER BY rowid DESC LIMIT -1 OFFSET ?
    )`,
      )
      .run(threadId, retainedTurnUsage);
  }
  attachTurnUsage(threadId: string, turns: TurnInfo[]) {
    if (!turns.length) return turns;
    const rows = this.db
      .prepare(
        `SELECT turn_id, total_tokens, output_tokens FROM turn_usage
      WHERE thread_id=? AND turn_id IN (${turns.map(() => '?').join(',')})`,
      )
      .all(threadId, ...turns.map((turn) => turn.id)) as {
      turn_id: string;
      total_tokens: number;
      output_tokens: number | null;
    }[];
    const usage = new Map(
      rows.map((row) => [
        row.turn_id,
        {
          totalTokens: row.total_tokens,
          outputTokens: row.output_tokens ?? undefined,
        },
      ]),
    );
    return turns.map((turn) =>
      usage.has(turn.id) ? { ...turn, usage: usage.get(turn.id) } : turn,
    );
  }
  markWaitingQuestion(operationId: string, waiting: boolean) {
    this.db
      .prepare(
        waiting
          ? 'INSERT OR IGNORE INTO waiting_question_operations VALUES (?)'
          : 'DELETE FROM waiting_question_operations WHERE operation_id=?',
      )
      .run(operationId);
  }
  hasExpiredQuestion(threadId: string) {
    return !!this.db
      .prepare(
        `SELECT 1 FROM waiting_question_operations q
      JOIN operations o ON o.id=q.operation_id
      WHERE o.thread_id=? AND o.state='unknown' LIMIT 1`,
      )
      .get(threadId);
  }
  active(threadId: string) {
    const row = this.db
      .prepare(
        "SELECT id,pending_text,state,kind,turn_id FROM operations WHERE thread_id=? AND kind IN ('send','review') AND state IN ('dispatching','acknowledged','unknown') LIMIT 1",
      )
      .get(threadId) as any;
    return (
      row && {
        id: row.id,
        text: row.pending_text,
        state: row.state,
        kind: row.kind,
        turnId: row.turn_id ?? undefined,
      }
    );
  }
  steers(threadId: string) {
    const rows = this.db
      .prepare(
        "SELECT id,pending_text FROM operations WHERE thread_id=? AND kind='steer' AND state IN ('dispatching','acknowledged','unknown') ORDER BY created_at LIMIT 10",
      )
      .all(threadId) as any[];
    return rows.map((row) => {
      const text: string = row.pending_text ?? '';
      const questionReply = !!parseQuestionReplies(text);
      return {
        ...this.operation(row.id)!,
        text: questionReply ? '' : text.slice(0, 2000),
        questionReply,
      };
    });
  }
  finishSteers(threadId: string, turnId: string) {
    this.db
      .prepare(
        "UPDATE operations SET state='completed',pending_text=NULL WHERE thread_id=? AND kind='steer' AND turn_id=? AND state IN ('acknowledged','unknown')",
      )
      .run(threadId, turnId);
  }
  activeCount() {
    return (
      this.db
        .prepare(
          "SELECT count(*) AS count FROM operations WHERE kind IN ('send','review') AND state IN ('dispatching','acknowledged','unknown')",
        )
        .get() as any
    ).count as number;
  }
  existing(
    id: string,
    threadId: string | undefined,
    kind: string,
    input: unknown,
  ): Operation | undefined {
    const row = this.db.prepare('SELECT * FROM operations WHERE id=?').get(id) as any;
    if (!row) return;
    if (
      (threadId && row.thread_id !== threadId) ||
      row.kind !== kind ||
      row.digest !== createHash('sha256').update(JSON.stringify(input)).digest('hex')
    )
      throw new AppError(
        'OPERATION_CONFLICT',
        'This operation ID was already used for different input.',
        409,
      );
    return this.operation(id);
  }
  begin(
    id: string,
    threadId: string,
    kind: string,
    input: unknown,
    text?: string,
  ): { existing?: Operation } {
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const existing = this.existing(id, threadId, kind, input);
    if (existing) return { existing };
    try {
      this.db
        .prepare(
          'INSERT INTO operations(id,thread_id,kind,digest,state,turn_id,error,pending_text,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(id, threadId, kind, digest, 'dispatching', null, null, text ?? null, Date.now());
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE'))
        throw new AppError(
          'EXECUTION_UNKNOWN',
          'This conversation already has an unfinished operation. Check its result first.',
          409,
        );
      throw error;
    }
    return {};
  }
  update(id: string, state: Operation['state'], turnId?: string, error?: string) {
    this.db
      .prepare('UPDATE operations SET state=?, turn_id=COALESCE(?,turn_id), error=? WHERE id=?')
      .run(state, turnId ?? null, error ?? null, id);
  }
  complete(threadId: string, turnId: string) {
    this.db
      .prepare(
        "UPDATE operations SET state='completed',turn_id=?,pending_text=NULL WHERE thread_id=? AND kind IN ('send','review') AND (turn_id=? OR turn_id IS NULL) AND state IN ('dispatching','acknowledged','unknown')",
      )
      .run(turnId, threadId, turnId);
  }
  result(id: string, resultId: string) {
    this.db.prepare('UPDATE operations SET result_id=? WHERE id=?').run(resultId, id);
  }
  prune() {
    this.queue.prune();
    this.db
      .prepare("DELETE FROM operations WHERE state IN ('completed','failed') AND created_at < ?")
      .run(Date.now() - 30 * 86400_000);
  }
  close() {
    this.db.close();
  }
}
