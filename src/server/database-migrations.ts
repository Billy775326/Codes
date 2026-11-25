import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../shared/errors.js';
import { legacyQueueReview, queueSchema } from './queue-store.js';
import { asyncQuestionSchema } from './async-questions.js';

export const databaseVersion = 6;

const base = `
      CREATE TABLE IF NOT EXISTS meta (version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL, settings TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, forked_from_id TEXT);
      CREATE INDEX IF NOT EXISTS thread_project_updated ON threads(project_id, updated_at);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id), kind TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, turn_id TEXT, error TEXT, pending_text TEXT, created_at INTEGER NOT NULL, result_id TEXT);
`;
const executionLease = `DROP INDEX IF EXISTS active_turn;
  CREATE UNIQUE INDEX active_turn ON operations(thread_id) WHERE kind IN ('send','review')
  AND state IN ('dispatching','acknowledged','unknown');`;
const metadata =
  `
CREATE TABLE IF NOT EXISTS project_archives (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE
    );
CREATE TABLE IF NOT EXISTS setting_profiles (
      scope TEXT PRIMARY KEY, revision INTEGER NOT NULL, settings TEXT NOT NULL);
      INSERT OR IGNORE INTO setting_profiles SELECT 'thread:'||id,0,settings FROM threads;
CREATE TABLE IF NOT EXISTS waiting_question_operations (
      operation_id TEXT PRIMARY KEY REFERENCES operations(id) ON DELETE CASCADE
    );
CREATE TABLE IF NOT EXISTS turn_usage (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL,
      total_tokens INTEGER NOT NULL,
      output_tokens INTEGER,
      PRIMARY KEY (thread_id, turn_id)
    );
CREATE TABLE IF NOT EXISTS uploaded_files (
      project_id TEXT NOT NULL REFERENCES projects(id),
      id TEXT NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );
` + asyncQuestionSchema;

export const requiredColumns = {
  meta: ['version'],
  projects: ['id', 'path', 'name'],
  threads: [
    'id',
    'project_id',
    'title',
    'state',
    'settings',
    'updated_at',
    'archived',
    'forked_from_id',
  ],
  operations: [
    'id',
    'thread_id',
    'kind',
    'digest',
    'state',
    'turn_id',
    'error',
    'pending_text',
    'created_at',
    'result_id',
  ],
  queued_messages: ['seq', 'id', 'thread_id', 'digest', 'payload', 'state', 'error', 'created_at'],
  queue_controls: ['thread_id', 'paused', 'reason'],
  project_archives: ['project_id'],
  setting_profiles: ['scope', 'revision', 'settings'],
  waiting_question_operations: ['operation_id'],
  turn_usage: ['thread_id', 'turn_id', 'total_tokens', 'output_tokens'],
  uploaded_files: ['project_id', 'id', 'content'],
  async_question_items: [
    'id',
    'thread_id',
    'item_id',
    'turn_id',
    'questions',
    'remaining',
    'closed',
    'reply_operation_id',
  ],
  async_question_replies: ['thread_id', 'item_id', 'question_id', 'title', 'answer'],
  async_question_ambiguity: ['thread_id', 'turn_id', 'signature'],
};

export function verifySchema(db: DatabaseSync) {
  const info = db.prepare('SELECT name FROM pragma_table_info(?)');
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const actual = new Set(info.all(table).map((column) => column.name));
    if (columns.some((name) => !actual.has(name)))
      throw new AppError(
        'DATABASE_SCHEMA',
        'The database metadata is incomplete. Restore a compatible backup.',
        500,
      );
  }
}

export function migrateDatabase(db: DatabaseSync, directory: string) {
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => row.name),
  );
  const versions = tables.has('meta') ? db.prepare('SELECT version FROM meta').all() : [];
  const version = versions[0]?.version;
  const fresh = tables.size === 0;
  if (
    !fresh &&
    (versions.length !== 1 ||
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 1 ||
      version > databaseVersion)
  )
    throw new AppError(
      'DATABASE_VERSION',
      'This database was created by an unsupported version.',
      500,
    );
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;');
  if (version === databaseVersion) {
    verifySchema(db);
    return;
  }
  if (!fresh) {
    const backup = join(
      directory,
      'codes.schema-v' + version + '-' + Date.now() + '-' + randomUUID() + '.sqlite',
    );
    closeSync(openSync(backup, 'wx', 0o600));
    db.prepare('VACUUM INTO ?').run(backup);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (fresh) db.exec(base);
    if (version === 1)
      db.exec('ALTER TABLE threads ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;');
    if (version === 1 || version === 2)
      db.exec(
        'ALTER TABLE threads ADD COLUMN forked_from_id TEXT; ALTER TABLE operations ADD COLUMN result_id TEXT;',
      );
    db.exec(queueSchema + executionLease + metadata);
    if (!fresh) {
      db.prepare(
        `
        INSERT INTO queue_controls(thread_id,paused,reason)
        SELECT DISTINCT thread_id,1,?
        FROM queued_messages WHERE state='queued'
        ON CONFLICT(thread_id) DO UPDATE SET paused=1,reason=excluded.reason
      `,
      ).run(legacyQueueReview);
    }
    verifySchema(db);
    if (fresh) db.prepare('INSERT INTO meta VALUES(?)').run(databaseVersion);
    else db.prepare('UPDATE meta SET version=?').run(databaseVersion);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
