import { chmod, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { AppError } from '../shared/errors.js';
import { databaseBackupLimitBytes } from '../shared/workspace-settings.js';
import { acquireDataDirectoryLock } from './data-directory-lock.js';
import {
  databaseVersion,
  migrateDatabase,
  requiredColumns,
  verifySchema,
} from './database-migrations.js';

export const pendingRestoreFile = 'restore-pending.sqlite';

function readOnlyUri(path: string) {
  const url = pathToFileURL(path);
  url.searchParams.set('immutable', '1');
  return url.href;
}

export async function validateRestoreFile(path: string) {
  const file = await stat(path);
  if (!file.isFile() || file.size <= 0 || file.size > databaseBackupLimitBytes)
    throw new AppError('RESTORE_LIMIT', 'Choose a SQLite backup up to 64 MiB.', 413);

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(readOnlyUri(path), { readOnly: true });
    db.exec('PRAGMA trusted_schema=OFF;');
    const tables = db
      .prepare(
        "SELECT name, type FROM pragma_table_list WHERE schema='main' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    if (
      tables.length !== Object.keys(requiredColumns).length ||
      tables.some(
        ({ name, type }) => type !== 'table' || !Object.hasOwn(requiredColumns, String(name)),
      )
    )
      throw new Error('Unexpected tables.');
    verifySchema(db);
    const versions = db.prepare('SELECT version FROM meta LIMIT 2').all();
    if (versions.length !== 1 || versions[0]?.version !== databaseVersion)
      throw new AppError(
        'RESTORE_VERSION',
        'This backup uses a different database schema version.',
      );
    if (
      db.prepare('PRAGMA quick_check(1)').get()?.quick_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').get()
    )
      throw new Error('Database integrity check failed.');
    return file;
  } catch (error) {
    if (error instanceof AppError && error.code === 'RESTORE_VERSION') throw error;
    throw new AppError('RESTORE_INVALID', 'This file is not a valid Codes database backup.');
  } finally {
    db?.close();
  }
}

function prepareDatabase(target: string, source: string, directory: string) {
  const db = new DatabaseSync(target);
  try {
    migrateDatabase(db, directory);
    db.exec('PRAGMA trusted_schema=OFF;');
    db.prepare('ATTACH DATABASE ? AS snapshot').run(readOnlyUri(source));
    db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
    // Copy data into tables and indexes created by this build instead of installing uploaded SQL.
    for (const [table, fields] of Object.entries(requiredColumns)) {
      if (table === 'meta') continue;
      const columns = fields.join(', ');
      db.exec(`INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM snapshot.${table}`);
    }
    db.exec('COMMIT; DETACH DATABASE snapshot; PRAGMA journal_mode=DELETE;');
  } finally {
    db.close();
  }
}

export async function restoreDatabase(directory: string) {
  const unlock = acquireDataDirectoryLock(directory);
  const source = join(directory, pendingRestoreFile);
  let work: string | undefined;
  try {
    try {
      await validateRestoreFile(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error('No database restore is prepared. Upload a backup in Codes first.');
      throw error;
    }
    work = await mkdtemp(join(directory, '.restore-'));
    const target = join(work, 'codes.sqlite');
    prepareDatabase(target, source, work);
    await chmod(target, 0o600);

    const active = join(directory, 'codes.sqlite');
    const previous = await mkdtemp(join(directory, 'before-restore-'));
    const previousPath = join(previous, 'codes.sqlite');
    const original = new DatabaseSync(active);
    try {
      await backup(original, previousPath);
      await chmod(previousPath, 0o600);
      // Remove any previous WAL from the active filename before the atomic replacement.
      if (original.prepare('PRAGMA journal_mode=DELETE').get()?.journal_mode !== 'delete')
        throw new Error('The existing database is still open.');
    } finally {
      original.close();
    }

    // Consume the pending name before replacing the active file. After a crash, the input
    // stays recoverable from the backup directory without being eligible for repeated restore.
    const appliedSource = join(previous, pendingRestoreFile);
    await rename(source, appliedSource);
    try {
      await rename(target, active);
    } catch (error) {
      await rename(appliedSource, source);
      throw error;
    }
    return previousPath;
  } finally {
    try {
      if (work) await rm(work, { recursive: true, force: true });
    } finally {
      unlock();
    }
  }
}
