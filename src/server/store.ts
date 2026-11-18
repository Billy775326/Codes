import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import type { Operation, Project, Settings, Summary } from '../shared/types.js';
import { AppError } from '../shared/errors.js';
import { QueueStore, queueSchema } from './queue-store.js';

export class Store {
  readonly db: DatabaseSync;
  readonly queue: QueueStore;
  constructor(directory: string) {
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
    this.queue = new QueueStore(this.db);
    this.queue.recover();
    this.db.exec(
      "UPDATE operations SET state='unknown' WHERE state IN ('dispatching','acknowledged'); UPDATE threads SET state='unknown' WHERE state IN ('running','waitingApproval','waitingInput');",
    );
  }
  projects(): Project[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY name').all() as unknown as Project[];
  }
  addProject(name: string, path: string): Project {
    const existing = this.projects().find((p) => p.path === path);
    if (existing) return existing;
    const project = { id: randomUUID(), name, path };
    this.db.prepare('INSERT INTO projects VALUES(?,?,?)').run(project.id, name, path);
    return project;
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
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      state: row.state,
      updatedAt: row.updated_at,
      archived: !!row.archived,
      forkedFromId: row.forked_from_id ?? undefined,
      queueCount: this.queue.count(row.id),
      managementPending: !!this.pendingManagement(row.id),
      executionPending: !!this.active(row.id) || !!this.steers(row.id).length,
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
  setMetadata(id: string, change: { title?: string; archived?: boolean }) {
    if (change.title !== undefined)
      this.db.prepare('UPDATE threads SET title=? WHERE id=?').run(change.title, id);
    if (change.archived !== undefined)
      this.db.prepare('UPDATE threads SET archived=? WHERE id=?').run(Number(change.archived), id);
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
  steers(threadId: string): (Operation & { text: string })[] {
    const rows = this.db
      .prepare(
        "SELECT id,substr(pending_text,1,2000) AS pending_text FROM operations WHERE thread_id=? AND kind='steer' AND state IN ('dispatching','acknowledged','unknown') ORDER BY created_at LIMIT 10",
      )
      .all(threadId) as any[];
    return rows.map((row) => ({ ...this.operation(row.id)!, text: row.pending_text ?? '' }));
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
