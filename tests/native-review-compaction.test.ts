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
it('uses native Auto-review in a workspace sandbox and explicitly restores the human reviewer', async () => {
  const { service, project } = await fixture();
  const spy = vi.spyOn(service.driver, 'call');
  const thread = await service.create(project.id, { permission: 'auto-review' });
  expect(spy.mock.calls.find(([method]) => method === 'thread/start')?.[1]).toMatchObject({
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
  });
  for (const permission of [
    'auto-review',
    'read-only',
    'workspace-write',
    'danger-full-access',
  ] as const) {
    await service.send(thread.id, randomUUID(), '[hold] Reviewer selection', { permission });
    const params = spy.mock.calls.filter(([method]) => method === 'turn/start').at(-1)![1] as any;
    expect(params.approvalsReviewer).toBe(permission === 'auto-review' ? 'auto_review' : 'user');
    expect(params.approvalPolicy).toBe(
      permission === 'danger-full-access' ? 'never' : 'on-request',
    );
    expect(params.sandboxPolicy.type).toBe(
      permission === 'auto-review' || permission === 'workspace-write'
        ? 'workspaceWrite'
        : permission === 'read-only'
          ? 'readOnly'
          : 'dangerFullAccess',
    );
    await service.interrupt(thread.id);
  }
});
it('preserves per-chat/default choices and already captured queue permissions', async () => {
  const { service, project, thread } = await fixture();
  service.saveDefaultSettings(0, { permission: 'auto-review' });
  const second = await service.create(project.id);
  expect(second.settings.permission).toBe('auto-review');
  expect(service.store.settingsProfile(thread.id).settings.permission).toBe('read-only');
  await service.send(second.id, randomUUID(), '[hold] Captured Auto-review', second.settings);
  const queued = randomUUID();
  await service.enqueue(second.id, queued, {
    text: 'Waiting Auto-review',
    settings: second.settings,
    attachments: [],
  });
  service.saveConversationSettings(second.id, 0, { permission: 'read-only' });
  expect(service.store.queue.get(queued)?.settings.permission).toBe('auto-review');
  expect(second.settings.permission).toBe('auto-review');
  expect(service.store.settingsProfile(second.id).settings.permission).toBe('read-only');
  await service.interrupt(second.id);
});
it('blocks managed-policy restrictions before native dispatch without silently selecting another permission', async () => {
  const { service, project, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation((method, params, timeout) =>
      method === 'configRequirements/read'
        ? Promise.resolve({ requirements: { allowedApprovalsReviewers: ['user'] } })
        : call(method, params, timeout),
    );
  expect(await service.modelSettings.permissions()).toEqual({ autoReview: false });
  await expect(service.create(project.id, { permission: 'auto-review' })).rejects.toMatchObject({
    code: 'AUTO_REVIEW_UNAVAILABLE',
  });
  await expect(
    service.send(thread.id, randomUUID(), 'Blocked', { permission: 'auto-review' }),
  ).rejects.toMatchObject({ code: 'AUTO_REVIEW_UNAVAILABLE' });
  expect(spy.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
  expect(service.store.activeCount()).toBe(0);
  spy.mockImplementation((method, params, timeout) =>
    method === 'configRequirements/read'
      ? Promise.resolve({ requirements: 'invalid' })
      : call(method, params, timeout),
  );
  await expect(service.modelSettings.permissions()).rejects.toMatchObject({
    code: 'PROTOCOL_ERROR',
  });
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
