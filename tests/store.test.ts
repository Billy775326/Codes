import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/server/store';

const cleanups: (() => void)[] = [];
it('persists independent settings and defaults without changing execution snapshots or schema 6', () => {
  const { store, directory } = fixture();
  const original = store.thread('a')!.settings;
  const selected = {
    permission: 'workspace-write' as const,
    model: 'chosen-model',
    effort: 'high',
    fast: true,
    mode: 'plan' as const,
  };
  const profile = store.saveSettingsProfile('a', 0, selected);
  const defaults = store.saveSettingsProfile(undefined, 0, {
    permission: 'danger-full-access',
    effort: 'low',
  });
  expect(store.settingsProfile('b').settings).toEqual(original);
  expect(store.thread('a')!.settings).toEqual(original);
  store.saveThread(store.thread('a')!, { permission: 'read-only', effort: 'medium' });
  expect(store.settingsProfile('a')).toEqual(profile);
  expect(() => store.saveSettingsProfile('a', 0, { permission: 'read-only' })).toThrow(
    /another window/,
  );
  expect(store.saveSettingsProfile('a', 0, selected)).toEqual(profile);
  store.close();
  const reopened = new Store(directory);
  try {
    expect(reopened.settingsProfile('a')).toEqual(profile);
    expect(reopened.settingsProfile()).toEqual(defaults);
    expect(reopened.settingsProfile('b').settings).toEqual(original);
    expect(reopened.db.prepare('SELECT version FROM meta').get()).toMatchObject({ version: 6 });
    expect(() => reopened.settingsProfile('missing')).toThrow(/not found/);
  } finally {
    reopened.close();
  }
});
it('keeps project archives across restart and preserves the original conversation metadata', () => {
  const { store, directory, project } = fixture();
  store.setMetadata('b', { archived: true });
  const active = store.thread('a');
  const archived = store.thread('b');
  store.setProjectArchived(project.id, true);
  store.close();
  const reopened = new Store(directory);
  try {
    expect(reopened.projects()).toEqual([{ ...project, archived: true }]);
    expect(reopened.thread('a')).toEqual(active);
    expect(reopened.thread('b')).toEqual(archived);
    reopened.setProjectArchived(project.id, false);
    expect(reopened.projects()).toEqual([project]);
    expect(reopened.thread('a')).toEqual(active);
    expect(reopened.thread('b')).toEqual(archived);
  } finally {
    reopened.close();
  }
});
it('holds schema 5 waiting messages for permission review without changing their payloads', () => {
  const { store, directory } = fixture();
  const payload = {
    text: 'Waiting before upgrade',
    settings: { permission: 'read-only' as const },
    attachments: [],
  };
  store.queue.add('queued-before-upgrade', 'a', payload);
  store.db.exec('UPDATE meta SET version=5');
  store.close();
  const reopened = new Store(directory);
  try {
    expect(reopened.queue.state('a')).toMatchObject({
      paused: true,
      reason: 'Review Codex permissions before resuming this legacy queue.',
      items: [{ id: 'queued-before-upgrade', ...payload }],
    });
    reopened.queue.pause('a');
    expect(reopened.queue.state('a').reason).toMatch(/legacy queue/);
    reopened.queue.resume('a');
    expect(reopened.queue.state('a')).toMatchObject({ paused: false, items: [payload] });
  } finally {
    reopened.close();
  }
});
it('seeds existing conversation settings once and rejects corrupt preference values', () => {
  const { store, directory } = fixture();
  store.db
    .prepare("UPDATE threads SET settings=? WHERE id='a'")
    .run(JSON.stringify({ permission: 'workspace-write', effort: 'high' }));
  store.db.exec('UPDATE meta SET version=4; DROP TABLE setting_profiles;');
  store.close();
  const reopened = new Store(directory);
  try {
    expect(reopened.settingsProfile('a').settings).toMatchObject({
      permission: 'workspace-write',
      effort: 'high',
    });
    reopened.db
      .prepare("UPDATE setting_profiles SET settings='not json' WHERE scope='thread:a'")
      .run();
    expect(() => reopened.settingsProfile('a')).toThrow(/Saved settings are invalid/);
  } finally {
    reopened.close();
  }
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
it('dequeues accepted deliveries from counts and capacity while retaining recovery records across restart', () => {
  const { store, directory } = fixture();
  const payload = {
    text: 'Queue fixture',
    settings: { permission: 'read-only' as const },
    attachments: [],
  };
  store.queue.add('accepted', 'a', payload);
  store.queue.set('accepted', 'sent');
  store.begin('accepted', 'a', 'send', {});
  store.update('accepted', 'acknowledged', 'native-turn');
  for (let i = 0; i < 10; i++) store.queue.add('waiting-' + i, 'a', payload);
  expect(store.queue.count('a')).toBe(10);
  expect(store.thread('a')?.queueCount).toBe(10);
  expect(store.queue.state('a').items.map((item) => item.id)).not.toContain('accepted');
  expect(store.queue.inFlight('a')).toMatchObject([{ id: 'accepted', state: 'sent' }]);
  expect(() => store.queue.add('overflow', 'a', payload)).toThrow(/queue is full/);
  store.queue.set('waiting-0', 'dispatching');
  store.queue.pause('a');
  store.close();
  const restarted = new Store(directory);
  try {
    expect(restarted.operation('accepted')?.state).toBe('unknown');
    expect(restarted.queue.get('accepted')?.state).toBe('sent');
    expect(restarted.queue.state('a')).toMatchObject({ paused: true, reason: 'Paused by you.' });
    expect(restarted.queue.state('a').items.map((item) => item.id)).not.toContain('accepted');
    expect(restarted.queue.get('waiting-0')?.state).toBe('unknown');
    expect(restarted.queue.count('a')).toBe(10);
  } finally {
    restarted.close();
  }
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
  return { store, directory, project: p };
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

it('rolls back a failed schema-4 migration and leaves the private pre-upgrade backup', () => {
  const { store, directory } = fixture();
  store.db.exec(`UPDATE meta SET version=4;
    DROP TABLE project_archives;
    DROP TABLE setting_profiles;
    CREATE TABLE setting_profiles (scope TEXT PRIMARY KEY);`);
  store.close();
  expect(() => new Store(directory)).toThrow();
  const old = new DatabaseSync(join(directory, 'codes.sqlite'), { readOnly: true });
  try {
    expect(old.prepare('SELECT version FROM meta').get()).toMatchObject({ version: 4 });
    expect(
      old.prepare("SELECT name FROM sqlite_master WHERE name='project_archives'").get(),
    ).toBeUndefined();
    expect(old.prepare("SELECT title FROM threads WHERE id='a'").get()).toBeDefined();
  } finally {
    old.close();
  }
  const backups = readdirSync(directory).filter((name) => name.startsWith('codes.schema-v4-'));
  expect(backups).toHaveLength(1);
  expect(statSync(join(directory, backups[0]!)).mode & 0o777).toBe(0o600);
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
    expect(migrated.db.prepare('SELECT version FROM meta').get()).toMatchObject({ version: 6 });
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

it('preserves delivery confirmation across restart and pauses uncertain dispatches instead of resending', () => {
  const { store, directory } = fixture();
  const payload = {
    text: 'Queued private fixture',
    settings: { permission: 'read-only' as const },
    attachments: [],
  };
  store.queue.add('queued', 'a', payload);
  store.queue.add('sent', 'a', payload);
  store.queue.set('sent', 'sent');
  store.queue.add('uncertain', 'a', payload);
  store.queue.set('uncertain', 'dispatching');
  store.close();
  const reopened = new Store(directory);
  try {
    expect(reopened.queue.state('a')).toMatchObject({ paused: true });
    expect(reopened.queue.get('queued')).toMatchObject({ state: 'queued', text: payload.text });
    expect(reopened.queue.get('sent')).toMatchObject({ state: 'sent' });
    expect(reopened.queue.get('uncertain')).toMatchObject({ state: 'unknown' });
    expect(reopened.queue.state('a').items.map((item) => item.id)).toEqual(['queued', 'uncertain']);
    expect(() => reopened.queue.cancel('sent', 'a')).toThrow(/may already be executing/);
  } finally {
    reopened.close();
  }
});
it('backs up schema 2 before adding queue tables and preserves archived conversations', () => {
  const { store, directory } = fixture();
  store.setMetadata('a', { archived: true });
  store.db.exec(
    'DROP TABLE queued_messages; DROP TABLE queue_controls; ALTER TABLE threads DROP COLUMN forked_from_id; ALTER TABLE operations DROP COLUMN result_id; UPDATE meta SET version=2;',
  );
  store.close();
  const upgraded = new Store(directory);
  try {
    expect(upgraded.thread('a')).toMatchObject({ archived: true, queueCount: 0 });
    const backup = readdirSync(directory).find((name) => name.startsWith('codes.schema-v2-'))!;
    const old = new DatabaseSync(join(directory, backup), { readOnly: true });
    try {
      expect(old.prepare('SELECT version FROM meta').get()).toMatchObject({ version: 2 });
      expect(old.prepare("SELECT archived FROM threads WHERE id='a'").get()).toMatchObject({
        archived: 1,
      });
    } finally {
      old.close();
    }
  } finally {
    upgraded.close();
  }
});

it('backs up schema 3 and preserves unknown task and steer receipts while adding the review lease', () => {
  const { store, directory } = fixture();
  store.begin('task', 'a', 'send', {}, 'Original task');
  store.begin('follow-up', 'a', 'steer', {}, 'Additional guidance');
  store.db.exec(
    "DROP INDEX active_turn; CREATE UNIQUE INDEX active_turn ON operations(thread_id) WHERE kind='send' AND state IN ('dispatching','acknowledged','unknown'); UPDATE meta SET version=3;",
  );
  store.close();
  const upgraded = new Store(directory);
  try {
    expect(upgraded.active('a')).toMatchObject({ id: 'task', state: 'unknown' });
    expect(upgraded.steers('a')).toMatchObject([
      { id: 'follow-up', state: 'unknown', text: 'Additional guidance' },
    ]);
    expect(() => upgraded.begin('review', 'a', 'review', {})).toThrow(/unfinished/);
    upgraded.complete('a', 'original-turn');
    expect(() => upgraded.begin('review', 'a', 'review', {})).not.toThrow();
    expect(() => upgraded.begin('new-task', 'a', 'send', {})).toThrow(/unfinished/);
    const name = readdirSync(directory).find((entry) => entry.startsWith('codes.schema-v3-'))!;
    const backup = new DatabaseSync(join(directory, name), { readOnly: true });
    try {
      expect(backup.prepare('SELECT version FROM meta').get()).toMatchObject({ version: 3 });
    } finally {
      backup.close();
    }
  } finally {
    upgraded.close();
  }
});

it('projects queue controls and unknown execution receipts without loading message bodies', () => {
  const { store } = fixture();
  try {
    const payload = {
      text: 'private queued input',
      settings: { permission: 'read-only' as const },
      attachments: [],
    };
    store.queue.add('q1', 'a', payload);
    store.queue.add('q2', 'a', payload);
    store.queue.pause('a');
    // Summary projection must not parse or expose the payload, even if it is unreadable.
    store.db.prepare("UPDATE queued_messages SET payload='unreadable' WHERE thread_id='a'").run();
    expect(store.thread('a')).toMatchObject({
      queueCount: 2,
      queuePaused: true,
      executionPending: false,
      executionUnknown: false,
    });
    store.queue.set('q1', 'failed');
    expect(store.thread('a')?.queueIssue).toBe('failed');
    store.queue.set('q2', 'unknown');
    expect(store.thread('a')?.queueIssue).toBe('unknown');
    store.queue.set('q1', 'cancelled');
    store.queue.set('q2', 'completed');
    expect(store.thread('a')).toMatchObject({
      queueCount: 0,
      queuePaused: true,
      queueIssue: undefined,
    });
    store.begin('run', 'a', 'send', {});
    store.update('run', 'acknowledged', 'turn');
    store.begin('steer', 'a', 'steer', {});
    store.update('steer', 'unknown', 'turn');
    expect(store.thread('a')).toMatchObject({ executionPending: true, executionUnknown: true });
    store.finishSteers('a', 'turn');
    expect(store.thread('a')).toMatchObject({ executionPending: true, executionUnknown: false });
    store.complete('a', 'turn');
    expect(store.thread('a')).toMatchObject({ executionPending: false, executionUnknown: false });
  } finally {
    store.close();
  }
});
