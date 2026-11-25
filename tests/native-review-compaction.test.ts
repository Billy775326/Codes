import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { Driver } from '../src/codex/driver';
import { Service } from '../src/server/service';
import { Store } from '../src/server/store';
import { nativeMessage } from '../src/server/transcript';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const work of cleanup.splice(0).reverse()) await work();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'codes-native-progress-'));
  const service = new Service(
    new Store(directory),
    new Driver('mock', { stateFile: join(directory, 'mock.json'), timeoutMs: 2000 }),
  );
  cleanup.push(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const project = await service.addProject(directory);
  return {
    service,
    project,
    thread: await service.create(project.id, { permission: 'read-only' }),
  };
}
async function until(check: () => boolean) {
  await expect.poll(check, { timeout: 4000, interval: 10 }).toBe(true);
}
it('uses the native reviewer for new threads and refreshes the reviewer for subsequent turns', async () => {
  const { service, project } = await fixture();
  const configuration = service.modelSettings.configuration;
  const before = await configuration.read(project.path, true);
  const auto = await configuration.save(project.path, {
    version: before.userVersion!,
    changes: { default_permissions: ':workspace', approvals_reviewer: 'auto_review' },
  });
  const thread = await service.create(project.id, { permission: 'read-only' });
  expect(thread.nativeSettings).toMatchObject({
    approvalsReviewer: 'auto_review',
    sandbox: 'workspaceWrite',
  });
  const spy = vi.spyOn(service.driver, 'call');
  await configuration.save(project.path, {
    version: auto.userVersion!,
    changes: { approvals_reviewer: 'user' },
  });
  await service.send(thread.id, randomUUID(), '[hold] Native reviewer selection', {
    permission: 'auto-review',
  });
  expect(spy.mock.calls.find(([method]) => method === 'thread/settings/update')?.[1]).toMatchObject(
    { approvalsReviewer: 'user' },
  );
  expect(spy.mock.calls.find(([method]) => method === 'turn/start')?.[1]).not.toHaveProperty(
    'approvalsReviewer',
  );
  await service.interrupt(thread.id);
});

it('surfaces native policy rejections without another configuration write', async () => {
  const { service, project } = await fixture();
  const configuration = service.modelSettings.configuration;
  const before = await configuration.read(project.path, true);
  const call = service.driver.call.bind(service.driver);
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation((method, params, timeout) =>
      method === 'config/batchWrite'
        ? Promise.reject(new Error('Rejected by managed policy'))
        : call(method, params, timeout),
    );
  await expect(
    configuration.save(project.path, {
      version: before.userVersion!,
      changes: { approvals_reviewer: 'auto_review' },
    }),
  ).rejects.toThrow('Rejected by managed policy');
  expect(spy.mock.calls.filter(([method]) => method === 'config/batchWrite')).toHaveLength(1);
  expect((await configuration.read(project.path, true)).userVersion).toBe(before.userVersion);
});

it('keeps compaction inside its turn, survives snapshot reads and never releases the queue on item completion', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[hold] Original turn', thread.settings);
  const operation = service.store.active(thread.id)!.id;
  const turnId = thread.turnId!;
  const queued = randomUUID();
  await service.enqueue(thread.id, queued, {
    text: 'Later turn',
    settings: thread.settings,
    attachments: [],
  });
  const item = { id: 'compact-fixture', type: 'contextCompaction' };
  const emit = (method: string, turn = turnId, id = item.id) =>
    service.driver.emit('notification', {
      method,
      params: { threadId: thread.id, turnId: turn, item: { ...item, id } },
    });
  emit('item/started');
  emit('item/started');
  expect((await service.read(thread.id)).compaction).toEqual({ id: item.id, turnId });
  expect(thread.messages.filter((m) => m.id === item.id)).toHaveLength(1);
  emit('item/completed', 'stale-turn');
  emit('item/completed', turnId, 'stale-item');
  expect(thread.compaction?.id).toBe(item.id);
  emit('item/completed');
  emit('item/started'); // A replayed start cannot revive a completed item.
  expect(thread.compaction).toBeUndefined();
  expect(thread.state).toBe('running');
  expect(service.store.active(thread.id)?.id).toBe(operation);
  expect(service.store.queue.get(queued)?.state).toBe('queued');
  expect(thread.messages.find((m) => m.id === item.id)).toMatchObject({
    kind: 'compaction',
    status: 'completed',
    text: 'Context compacted.',
  });
  await service.interrupt(thread.id);
  expect(thread.state).toBe('interrupted');
  expect(service.store.queue.state(thread.id).paused).toBe(true);
});
it('clears live compaction on interruption, failed completion and runtime loss', async () => {
  const { service, thread } = await fixture();
  for (const outcome of ['interrupted', 'failed', 'offline']) {
    await service.send(thread.id, randomUUID(), '[hold] Compaction cleanup', thread.settings);
    const turnId = thread.turnId!;
    service.driver.emit('notification', {
      method: 'item/started',
      params: {
        threadId: thread.id,
        turnId,
        item: { id: randomUUID(), type: 'contextCompaction' },
      },
    });
    expect(thread.compaction).toBeDefined();
    if (outcome === 'offline') {
      await service.driver.stop();
      service.driver.emit('offline');
    } else if (outcome === 'interrupted') await service.interrupt(thread.id);
    else {
      await service.driver.call('turn/interrupt', { threadId: thread.id, turnId });
      await until(() => thread.state === 'interrupted');
      service.driver.emit('notification', {
        method: 'turn/completed',
        params: { threadId: thread.id, turn: { id: turnId, status: 'failed' } },
      });
    }
    expect(thread.compaction).toBeUndefined();
    expect(
      thread.messages
        .filter((message) => message.kind === 'compaction')
        .some((message) => message.status === 'inProgress'),
    ).toBe(false);
  }
});
it('does not fabricate success or running progress for timestamp-free historical compaction', () => {
  const raw = { type: 'contextCompaction', id: 'history-compaction' };
  expect(nativeMessage(raw, 'history-turn')).toMatchObject({
    kind: 'compaction',
    text: 'Context compaction',
  });
  expect(nativeMessage(raw, 'history-turn')?.status).toBeUndefined();
});
it('shows native reviewer decisions and rationale without granting or resolving approvals itself', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[hold] Review fixture', thread.settings);
  for (const status of ['inProgress', 'denied']) {
    service.driver.emit('notification', {
      method: 'item/autoApprovalReview/' + (status === 'inProgress' ? 'started' : 'completed'),
      params: {
        threadId: thread.id,
        turnId: thread.turnId,
        reviewId: 'review-fixture',
        review: { status, rationale: 'Synthetic rationale' },
        action: { secret: 'never-surface' },
      },
    });
  }
  expect(thread.messages.find((m) => m.id === 'auto-review:review-fixture')?.text).toBe(
    'Auto-review · Denied\nSynthetic rationale',
  );
  expect(JSON.stringify(thread.messages)).not.toContain('never-surface');
  expect(thread.state).toBe('running');
  expect(service.store.activeCount()).toBe(1);
  await service.interrupt(thread.id);
});
it('retains the Auto-review preset when reopening the persisted metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codes-review-storage-'));
  let store = new Store(directory);
  cleanup.push(async () => {
    store.db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const project = store.addProject('Fixture', directory);
  const id = randomUUID();
  store.saveThread(
    { id, projectId: project.id, title: 'Persisted review fixture', state: 'idle', updatedAt: 0 },
    { permission: 'auto-review' },
  );
  store.saveSettingsProfile(undefined, 0, { permission: 'auto-review' });
  store.db.close();
  store = new Store(directory);
  expect(store.settingsProfile(id).settings.permission).toBe('auto-review');
  expect(store.settingsProfile().settings.permission).toBe('auto-review');
  expect(store.thread(id)?.settings.permission).toBe('auto-review');
});
it('clears inner-review compaction only when the acknowledged outer review finishes', async () => {
  const { service, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  const outer = randomUUID(),
    inner = randomUUID(),
    operation = randomUUID();
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    if (method !== 'review/start') return call(method, params, timeout);
    service.driver.emit('notification', {
      method: 'turn/started',
      params: { threadId: thread.id, turn: { id: inner, status: 'inProgress', items: [] } },
    });
    service.driver.emit('notification', {
      method: 'item/started',
      params: {
        threadId: thread.id,
        turnId: inner,
        item: { id: 'review-compaction', type: 'contextCompaction' },
      },
    });
    return { turn: { id: outer, status: 'inProgress' } };
  });
  await service.review(thread.id, operation, { type: 'uncommittedChanges' }, thread.settings);
  expect(thread.compaction?.turnId).toBe(inner);
  service.driver.emit('notification', {
    method: 'turn/completed',
    params: { threadId: thread.id, turn: { id: 'stale-review', status: 'completed' } },
  });
  expect(thread.compaction?.turnId).toBe(inner);
  service.driver.emit('notification', {
    method: 'turn/completed',
    params: { threadId: thread.id, turn: { id: outer, status: 'completed' } },
  });
  expect(thread.compaction).toBeUndefined();
  expect(thread.state).toBe('completed');
  expect(service.store.operation(operation)?.state).toBe('completed');
});
