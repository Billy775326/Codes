import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
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
