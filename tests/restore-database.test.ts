import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { acquireDataDirectoryLock } from '../src/server/data-directory-lock';
import { pendingRestoreFile, restoreDatabase } from '../src/server/restore-database';
import { Store } from '../src/server/store';

it('restores a prepared snapshot offline and retains the previous database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codes-test-restore-'));
  try {
    const store = new Store(directory);
    const source = join(directory, pendingRestoreFile);
    const add = store.db.prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)');
    add.run('before', 'Snapshot project', '/fixture/project');
    await backup(store.db, source);
    add.run('new', 'Newer project', '/fixture/other');
    const release = acquireDataDirectoryLock(directory);
    try {
      await expect(restoreDatabase(directory)).rejects.toThrow(
        'The data directory is already in use.',
      );
    } finally {
      store.close();
      release();
    }
    const saved = await restoreDatabase(directory);
    const names = (path: string) => {
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        expect(db.prepare('PRAGMA quick_check').get()?.quick_check).toBe('ok');
        return db
          .prepare('SELECT name FROM projects ORDER BY name')
          .all()
          .map((row) => row.name);
      } finally {
        db.close();
      }
    };
    expect(names(saved)).toEqual(['Newer project', 'Snapshot project']);
    expect(names(join(directory, 'codes.sqlite'))).toEqual(['Snapshot project']);
    await expect(restoreDatabase(directory)).rejects.toThrow('No database restore is prepared.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
