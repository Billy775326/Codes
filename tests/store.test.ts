import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/server/store';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'codes-store-'));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  const p = store.addProject('Example', '/example');
  store.saveThread(
    { id: 'a', projectId: p.id, title: 'Example', state: 'idle', updatedAt: Date.now() },
    { permission: 'read-only' },
  );
  store.saveThread(
    { id: 'b', projectId: p.id, title: 'Other', state: 'idle', updatedAt: Date.now() },
    { permission: 'read-only' },
  );
  return { store, directory };
}
it('returns the same receipt and refuses conflicting input or conversation reuse', () => {
  const { store } = fixture();
  try {
    store.begin('op', 'a', 'send', { text: 'hello' });
    store.update('op', 'acknowledged', 'turn');
    expect(store.begin('op', 'a', 'send', { text: 'hello' }).existing).toMatchObject({
      state: 'acknowledged',
      turnId: 'turn',
    });
    expect(() => store.begin('op', 'a', 'send', { text: 'changed' })).toThrow(/different input/);
    expect(() => store.begin('op', 'b', 'send', { text: 'hello' })).toThrow(/different input/);
  } finally {
    store.close();
  }
});
it('holds one active lease per conversation, including unknown outcomes', () => {
  const { store } = fixture();
  try {
    store.begin('first', 'a', 'send', {});
    store.update('first', 'unknown');
    expect(() => store.begin('second', 'a', 'send', {})).toThrow(/unfinished/);
    store.complete('a', 'turn');
    expect(() => store.begin('second', 'a', 'send', {})).not.toThrow();
  } finally {
    store.close();
  }
});
it('marks unfinished operations unknown after restart without clearing projects', () => {
  const { store, directory } = fixture();
  store.begin('op', 'a', 'send', {}, 'saved draft');
  store.close();
  const resumed = new Store(directory);
  try {
    expect(resumed.active('a')).toMatchObject({ id: 'op', state: 'unknown', text: 'saved draft' });
    expect(resumed.projects()).toHaveLength(1);
  } finally {
    resumed.close();
  }
});
it('refuses a future database schema without modifying it', () => {
  const { store, directory } = fixture();
  store.db.exec('UPDATE meta SET version=999');
  store.close();
  expect(() => new Store(directory)).toThrow(/unsupported version/);
});

it('backs up schema 1 before adding archive metadata and preserves pending receipts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codes-migration-'));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const old = new DatabaseSync(join(directory, 'codes.sqlite'));
  old.exec(`CREATE TABLE meta(version INTEGER NOT NULL); INSERT INTO meta VALUES(1);
    CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT UNIQUE NOT NULL);
    CREATE TABLE threads(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),title TEXT NOT NULL,state TEXT NOT NULL,updated_at INTEGER NOT NULL,settings TEXT NOT NULL);
    CREATE TABLE operations(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES threads(id),kind TEXT NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL,turn_id TEXT,error TEXT,pending_text TEXT,created_at INTEGER NOT NULL);
    INSERT INTO projects VALUES('p','Preserved','/example');
    INSERT INTO threads VALUES('t','p','Preserved title','running',1,'{"permission":"read-only"}');
    INSERT INTO operations VALUES('op','t','send','digest','dispatching',NULL,NULL,'saved draft',1);`);
  old.close();
  const migrated = new Store(directory);
  try {
    expect(migrated.thread('t')).toMatchObject({
      title: 'Preserved title',
      archived: false,
      state: 'unknown',
    });
    expect(migrated.active('t')).toMatchObject({ id: 'op', state: 'unknown', text: 'saved draft' });
    expect(migrated.db.prepare('SELECT version FROM meta').get()).toMatchObject({ version: 2 });
    const backupName = readdirSync(directory).find((name) => name.startsWith('codes.schema-v1-'))!;
    expect(statSync(join(directory, backupName)).mode & 0o777).toBe(0o600);
    const backup = new DatabaseSync(join(directory, backupName), { readOnly: true });
    try {
      expect(backup.prepare('SELECT version FROM meta').get()).toMatchObject({ version: 1 });
      expect(backup.prepare('SELECT title FROM threads').get()).toMatchObject({
        title: 'Preserved title',
      });
      expect(backup.prepare('SELECT state FROM operations').get()).toMatchObject({
        state: 'dispatching',
      });
    } finally {
      backup.close();
    }
    migrated.setMetadata('t', { archived: true, title: 'Archived title' });
  } finally {
    migrated.close();
  }
  const reopened = new Store(directory);
  try {
    expect(reopened.thread('t')).toMatchObject({
      archived: true,
      title: 'Archived title',
      executionPending: true,
    });
  } finally {
    reopened.close();
  }
});
