import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { Operation, Project, Settings, Summary } from '../shared/types.js';
import { AppError } from '../shared/errors.js';

export class Store {
  readonly db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'codes.sqlite'));
    chmodSync(join(directory, 'codes.sqlite'), 0o600);
    if (
      this.db.prepare("SELECT name FROM sqlite_master WHERE name='meta'").get() &&
      (this.db.prepare('SELECT version FROM meta').get() as any)?.version !== 1
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
      INSERT INTO meta SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM meta);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL, settings TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id), kind TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, turn_id TEXT, error TEXT, pending_text TEXT, created_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS active_turn ON operations(thread_id) WHERE kind='send' AND state IN ('dispatching','acknowledged','unknown');`);
    if ((this.db.prepare('SELECT version FROM meta').get() as any).version !== 1)
      throw new AppError(
        'DATABASE_VERSION',
        'This database was created by an unsupported version.',
        500,
      );
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
        .prepare('SELECT * FROM threads WHERE project_id=? ORDER BY updated_at DESC LIMIT 200')
        .all(projectId) as any[]
    ).map(this.summary);
  }
  summary(row: any): Summary {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      state: row.state,
      updatedAt: row.updated_at,
    };
  }
  thread(id: string): (Summary & { settings: Settings }) | undefined {
    const row = this.db.prepare('SELECT * FROM threads WHERE id=?').get(id) as any;
    return row && { ...this.summary(row), settings: JSON.parse(row.settings) };
  }
  saveThread(thread: Summary, settings: Settings) {
    this.db
      .prepare(
        'INSERT INTO threads VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,state=excluded.state,updated_at=excluded.updated_at,settings=excluded.settings',
      )
      .run(
        thread.id,
        thread.projectId,
        thread.title,
        thread.state,
        thread.updatedAt,
        JSON.stringify(settings),
      );
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
      }
    );
  }
  active(threadId: string) {
    const row = this.db
      .prepare(
        "SELECT id,pending_text,state FROM operations WHERE thread_id=? AND kind='send' AND state IN ('dispatching','acknowledged','unknown') LIMIT 1",
      )
      .get(threadId) as any;
    return row && { id: row.id, text: row.pending_text, state: row.state };
  }
  activeCount() {
    return (
      this.db
        .prepare(
          "SELECT count(*) AS count FROM operations WHERE kind='send' AND state IN ('dispatching','acknowledged','unknown')",
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
        .prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?)')
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
        "UPDATE operations SET state='completed',turn_id=?,pending_text=NULL WHERE thread_id=? AND kind='send' AND (turn_id=? OR turn_id IS NULL) AND state IN ('dispatching','acknowledged','unknown')",
      )
      .run(turnId, threadId, turnId);
  }
  prune() {
    this.db
      .prepare("DELETE FROM operations WHERE state IN ('completed','failed') AND created_at < ?")
      .run(Date.now() - 30 * 86400_000);
  }
  close() {
    this.db.close();
  }
}
