import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { Driver } from '../src/codex/driver';
import { Service } from '../src/server/service';
import { Store } from '../src/server/store';
import { AppError } from '../src/shared/errors';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const work of cleanup.splice(0).reverse()) await work();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'codes-ide-'));
  const service = new Service(
    new Store(directory),
    new Driver('mock', { stateFile: join(directory, 'mock.json'), timeoutMs: 2000 }),
  );
  cleanup.push(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const project = await service.addProject(directory);
  const thread = await service.create(project.id, { permission: 'read-only' });
  return { service, thread, project, directory };
}
async function until(check: () => boolean) {
  const end = Date.now() + 6000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
it('uses native Plan instructions and ignores legacy reasoning overrides', async () => {
  const { service, thread } = await fixture();
  const spy = vi.spyOn(service.driver, 'call');
  const settings = {
    permission: 'read-only',
    model: 'simulated-model',
    mode: 'plan',
    effort: 'high',
  } as const;
  await service.send(thread.id, randomUUID(), 'Propose a plan', settings);
  await until(() => thread.state === 'completed');
  const start = spy.mock.calls.find(([method]) => method === 'turn/start')![1] as any;
  expect(start.collaborationMode).toEqual({
    mode: 'plan',
    settings: { model: 'simulated-model', reasoning_effort: null, developer_instructions: null },
  });
  expect(start.input[0].text).toBe('Propose a plan');
  expect(thread.plan?.steps[0]).toMatchObject({ status: 'completed' });
  await service.send(thread.id, randomUUID(), 'Implement after approval', {
    ...settings,
    mode: 'default',
  });
  expect(
    (spy.mock.calls.filter(([method]) => method === 'turn/start').at(-1)![1] as any)
      .collaborationMode.mode,
  ).toBe('default');
  expect(thread.plan).toBeUndefined();
  await service.interrupt(thread.id);
});
it('preserves model identifiers supplied by native configuration', async () => {
  const { service, project } = await fixture();
  const config = service.modelSettings.configuration;
  const before = await config.read(project.path, true);
  await config.save(project.path, {
    version: before.userVersion!,
    changes: { model: 'custom-exact-name' },
  });
  const { collaborationMode } = await service.modelSettings.resolve(
    { model: 'retired' },
    project.path,
  );
  expect(collaborationMode.settings.model).toBe('custom-exact-name');
});

it('rejects unavailable native review and branching before reserving an operation', async () => {
  const { service, thread } = await fixture();
  vi.spyOn(service.driver, 'supports').mockImplementation(
    (feature) => feature !== 'review' && feature !== 'branch',
  );
  const review = randomUUID();
  const fork = randomUUID();
  await expect(
    service.review(thread.id, review, { type: 'uncommittedChanges' }, thread.settings),
  ).rejects.toMatchObject({ code: 'CLI_FEATURE_UNAVAILABLE' });
  await expect(service.fork(thread.id, fork, 'fixture-turn')).rejects.toMatchObject({
    code: 'CLI_FEATURE_UNAVAILABLE',
  });
  expect(service.store.operation(review)).toBeUndefined();
  expect(service.store.operation(fork)).toBeUndefined();
});

it('dispatches once when unchanged native configuration arrives in a different field order', async () => {
  const { service, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  let reads = 0;
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    const result = await call(method, params, timeout);
    if (method === 'config/read') {
      result.config = { model: 'configured-model', model_reasoning_effort: 'medium' };
      if (++reads % 2 === 0)
        result.config = Object.fromEntries(Object.entries(result.config).reverse());
    }
    return result;
  });
  const operation = randomUUID();
  await service.send(thread.id, operation, 'Unchanged native configuration', {});
  await until(() => thread.state === 'completed');
  expect(service.store.operation(operation)?.state).toBe('completed');
  expect(
    (await service.history(thread.id)).messages.filter((item) => item.clientId === operation),
  ).toHaveLength(1);
});

it('refuses dispatch when native configuration really changes during synchronization', async () => {
  const { service, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  let changed = false;
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    const result = await call(method, params, timeout);
    if (method === 'thread/settings/update') changed = true;
    if (method === 'config/read') {
      result.config.model = 'configured-model';
      if (changed) result.config.approval_policy = 'never';
    }
    return result;
  });
  const operation = randomUUID();
  await expect(
    service.send(thread.id, operation, 'Configuration changed before dispatch', {}),
  ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT', uncertain: false });
  expect(service.store.operation(operation)).toMatchObject({ state: 'failed', turnId: undefined });
  expect(
    (await service.history(thread.id)).messages.some((item) => item.clientId === operation),
  ).toBe(false);
});

it('refreshes the loaded thread when native configuration changes', async () => {
  const { service, thread, project } = await fixture();
  const call = service.driver.call.bind(service.driver);
  const config = {
    model: 'first-configured-model',
    model_reasoning_effort: 'medium',
    plan_mode_reasoning_effort: 'high',
    service_tier: 'priority',
  };
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation((method, params, timeout) =>
      method === 'config/read' ? Promise.resolve({ config }) : call(method, params, timeout),
    );
  await service.send(thread.id, randomUUID(), 'Explicit overrides', {
    permission: 'read-only',
    model: 'simulated-model',
    effort: 'low',
    fast: false,
  });
  await until(() => thread.state === 'completed');
  const lastStart = () => spy.mock.calls.filter(([method]) => method === 'turn/start').at(-1)?.[1];
  expect(lastStart()).toMatchObject({
    collaborationMode: {
      settings: { model: 'first-configured-model', reasoning_effort: 'medium' },
    },
  });
  config.model = 'new-configured-model';
  await service.send(thread.id, randomUUID(), 'Inherit current project', {
    permission: 'read-only',
  });
  await until(() => thread.state === 'completed');
  expect(spy).toHaveBeenCalledWith('config/read', { cwd: project.path, includeLayers: false });
  expect(lastStart()).toMatchObject({
    collaborationMode: { settings: { model: 'new-configured-model', reasoning_effort: 'medium' } },
  });
  await service.send(thread.id, randomUUID(), 'Inherit Plan effort', {
    permission: 'read-only',
    mode: 'plan',
  });
  await until(() => thread.state === 'completed');
  expect(lastStart()).toMatchObject({
    collaborationMode: { settings: { reasoning_effort: 'high' } },
  });
});
it('steers the same active turn once without replacing its execution receipt', async () => {
  const { service, thread } = await fixture();
  const task = randomUUID(),
    follow = randomUUID();
  await service.send(thread.id, task, '[slow] Start', thread.settings);
  const turnId = thread.turnId!;
  await Promise.all([
    service.steer(thread.id, follow, turnId, 'Change direction'),
    service.steer(thread.id, follow, turnId, 'Change direction'),
  ]);
  expect(service.store.active(thread.id)?.id).toBe(task);
  expect(service.store.operation(follow)).toMatchObject({ kind: 'steer', turnId });
  expect(thread.turnId).toBe(turnId);
  expect(thread.messages.filter((entry) => entry.clientId === follow)).toHaveLength(1);
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  expect(service.store.operation(follow)?.state).toBe('completed');
  expect(thread.steering).toHaveLength(0);
});
it('rejects a stale turn and questions/approvals instead of starting an extra task', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve]', thread.settings);
  await until(() => thread.state === 'waitingApproval');
  const id = randomUUID();
  await expect(
    service.steer(thread.id, id, thread.turnId!, 'Do not bypass approval'),
  ).rejects.toMatchObject({ code: 'STEER_UNAVAILABLE' });
  expect(service.store.operation(id)).toBeUndefined();
  expect(thread.actions[0]?.status).toBe('pending');
});
it('retains an uncertain follow-up after the original task ends and blocks automatic/new dispatch', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[slow] Unknown steer', thread.settings);
  const call = service.driver.call.bind(service.driver);
  vi.spyOn(service.driver, 'call').mockImplementation((method, params, timeout) => {
    if (method === 'turn/steer')
      return Promise.reject(new AppError('CLI_TIMEOUT', 'Lost follow-up response', 504, true));
    return call(method, params, timeout);
  });
  const id = randomUUID();
  await expect(service.steer(thread.id, id, thread.turnId!, 'Unconfirmed')).rejects.toMatchObject({
    uncertain: true,
  });
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  expect(service.store.operation(id)?.state).toBe('unknown');
  await service.reconcile(thread.id);
  await expect(
    service.send(thread.id, randomUUID(), 'Never duplicate', thread.settings),
  ).rejects.toMatchObject({ code: 'STEER_PENDING' });
  await expect(service.archive(thread.id, randomUUID(), true)).rejects.toMatchObject({
    code: 'CONVERSATION_ACTIVE',
  });
  await service.enqueue(thread.id, randomUUID(), {
    text: 'Must wait',
    settings: thread.settings,
    attachments: [],
  });
  expect(service.store.queue.state(thread.id).items[0]?.state).toBe('queued');
});
it('uses a native user item to reconcile a lost steer acknowledgement without resending it', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[slow] Lost acknowledgement', thread.settings);
  const call = service.driver.call.bind(service.driver);
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    const response = await call(method, params, timeout);
    if (method === 'turn/steer')
      throw new AppError('CLI_TIMEOUT', 'Lost acknowledgement', 504, true);
    return response;
  });
  const id = randomUUID();
  await expect(service.steer(thread.id, id, thread.turnId!, 'Accepted once')).rejects.toMatchObject(
    { uncertain: true },
  );
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  await service.reconcile(thread.id);
  expect(service.store.operation(id)?.state).toBe('completed');
  expect(thread.messages.filter((entry) => entry.clientId === id)).toHaveLength(1);
});
it('claims queued Send now atomically and joins the running native turn', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[slow] Queue promotion', thread.settings);
  await service.controlQueue(thread.id, true);
  const id = randomUUID();
  await service.enqueue(thread.id, id, {
    text: 'Promote this message',
    settings: { mode: 'default', ...thread.settings },
    attachments: [],
  });
  const attempts = await Promise.allSettled([
    service.steerQueued(thread.id, id, thread.turnId!),
    service.steerQueued(thread.id, id, thread.turnId!),
  ]);
  expect(attempts.some((result) => result.status === 'fulfilled')).toBe(true);
  expect(thread.messages.filter((entry) => entry.clientId === id)).toHaveLength(1);
  expect(service.queueState(thread.id).items.map((entry) => entry.id)).not.toContain(id);
  const other = randomUUID();
  await service.enqueue(thread.id, other, {
    text: 'Different permissions',
    settings: { permission: 'workspace-write' },
    attachments: [],
  });
  await service.steerQueued(thread.id, other, thread.turnId!);
  expect(thread.messages.filter((entry) => entry.clientId === other)).toHaveLength(1);
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  expect(service.store.operation(id)?.state).toBe('completed');
  expect(service.store.queue.get(id)).toMatchObject({
    state: 'completed',
    error: 'The task ended interrupted.',
  });
  expect(service.queueState(thread.id).items.map((entry) => entry.id)).toEqual([]);
  expect(service.store.queue.state(thread.id).paused).toBe(true);
});
it('runs native reviews with idempotent receipts and visible review output', async () => {
  const { service, thread } = await fixture();
  const spy = vi.spyOn(service.driver, 'call');
  const id = randomUUID();
  const target = { type: 'baseBranch', branch: 'main' } as const;
  await service.review(thread.id, id, target, { permission: 'workspace-write' });
  await until(() => !thread.pending);
  expect(service.store.operation(id)).toMatchObject({ kind: 'review', state: 'completed' });
  expect(thread.messages.some((entry) => entry.text.includes('Simulated review:'))).toBe(true);
  expect(spy.mock.calls.some(([method]) => method === 'thread/settings/update')).toBe(false);
  expect(spy.mock.calls.find(([method]) => method === 'review/start')?.[1]).toMatchObject({
    delivery: 'inline',
    target,
  });
  await service.review(thread.id, id, target, { permission: 'workspace-write' });
  expect(spy.mock.calls.filter(([method]) => method === 'review/start')).toHaveLength(1);
  expect(
    (await service.history(thread.id)).messages.some((entry) =>
      entry.text.includes('Simulated review:'),
    ),
  ).toBe(true);
});
it('keeps unknown native reviews protected when no client message ID or returned turn ID proves a result', async () => {
  const { service, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  vi.spyOn(service.driver, 'call').mockImplementation((method, params, timeout) =>
    method === 'review/start'
      ? Promise.reject(new AppError('CLI_TIMEOUT', 'Review acknowledgement lost', 504, true))
      : call(method, params, timeout),
  );
  const id = randomUUID();
  await expect(
    service.review(thread.id, id, { type: 'uncommittedChanges' }, thread.settings),
  ).rejects.toMatchObject({ uncertain: true });
  await service.reconcile(thread.id);
  expect(service.store.active(thread.id)).toMatchObject({ id, state: 'unknown' });
  await expect(
    service.send(thread.id, randomUUID(), 'Blocked', thread.settings),
  ).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
});
it('distinguishes latest context usage from cumulative tokens and ignores malformed updates', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[slow] Token fixture', thread.settings);
  await until(() => !!thread.usage);
  expect(thread.usage).toMatchObject({
    contextTokens: 1200,
    totalTokens: 3400,
    contextWindow: 128000,
  });
  service.driver.emit('notification', {
    method: 'thread/tokenUsage/updated',
    params: {
      threadId: thread.id,
      turnId: thread.turnId,
      tokenUsage: { last: { totalTokens: -1 }, total: { totalTokens: 0 } },
    },
  });
  expect(thread.usage?.contextTokens).toBe(1200);
});

it('does not release a review lease for unrelated or nonterminal native events', async () => {
  const { service, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  vi.spyOn(service.driver, 'call').mockImplementation((method, params, timeout) =>
    method === 'review/start'
      ? Promise.resolve({ turn: { id: 'expected-review' }, reviewThreadId: thread.id })
      : call(method, params, timeout),
  );
  const id = randomUUID();
  await service.review(thread.id, id, { type: 'uncommittedChanges' }, thread.settings);
  expect(thread.pending).toMatchObject({ kind: 'review', turnId: 'expected-review' });
  await expect(
    service.steer(thread.id, randomUUID(), thread.turnId!, 'Wait until review finishes'),
  ).rejects.toMatchObject({ code: 'STEER_UNAVAILABLE' });
  service.driver.emit('notification', {
    method: 'turn/completed',
    params: { threadId: thread.id, turn: { id: 'unrelated', status: 'completed', items: [] } },
  });
  expect(service.store.active(thread.id)?.id).toBe(id);
  service.driver.emit('notification', {
    method: 'turn/completed',
    params: {
      threadId: thread.id,
      turn: { id: 'expected-review', status: 'inProgress', items: [] },
    },
  });
  expect(service.store.active(thread.id)?.id).toBe(id);
  service.driver.emit('notification', {
    method: 'turn/completed',
    params: {
      threadId: thread.id,
      turn: { id: 'expected-review', status: 'completed', items: [] },
    },
  });
  expect(service.store.active(thread.id)).toBeUndefined();
});

it('correlates the outer review completion after an inner runner starts, including before the response arrives', async () => {
  const { service, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    const response = await call(method, params, timeout);
    if (method === 'review/start') {
      // The simulator emits a different inner turn/started, then the outer terminal
      // event. Hold the RPC result so the server cannot correlate it prematurely.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return response;
  });
  const id = randomUUID();
  const result = await service.review(
    thread.id,
    id,
    { type: 'uncommittedChanges' },
    thread.settings,
  );
  expect(result.state).toBe('completed');
  expect(thread.state).toBe('completed');
  expect(thread.pending).toBeUndefined();
  expect(thread.turnId).toBe(result.turnId);
});

it('bounds pending steer previews while preserving the full native follow-up', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[slow] Large follow-up', thread.settings);
  const id = randomUUID(),
    text = 'A long follow-up ' + 'x'.repeat(5000);
  await service.steer(thread.id, id, thread.turnId!, text);
  expect(service.store.steers(thread.id)[0]!.text.length).toBe(2000);
  expect(thread.steering![0]!.text.length).toBe(2000);
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  expect(
    (await service.history(thread.id)).messages.find((entry) => entry.clientId === id)?.text,
  ).toBe(text);
});

it('streams native plan text but uses the final completed item as canonical content', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[slow] Plan streaming', thread.settings);
  const params = { threadId: thread.id, turnId: thread.turnId };
  service.driver.emit('notification', {
    method: 'item/started',
    params: { ...params, item: { id: 'plan-stream', type: 'plan', text: '' } },
  });
  service.driver.emit('notification', {
    method: 'item/plan/delta',
    params: { ...params, itemId: 'plan-stream', delta: 'Proposed outline' },
  });
  expect(thread.messages.find((entry) => entry.id === 'plan-stream')?.text).toBe(
    'Proposed outline',
  );
  service.driver.emit('notification', {
    method: 'item/completed',
    params: {
      ...params,
      item: { id: 'plan-stream', type: 'plan', text: 'Canonical revised plan' },
    },
  });
  expect(thread.messages.find((entry) => entry.id === 'plan-stream')?.text).toBe(
    'Canonical revised plan',
  );
});

it('ignores permission and speed overrides in legacy browser requests', async () => {
  const { service, project } = await fixture();
  const spy = vi.spyOn(service.driver, 'call');
  const configuration = service.modelSettings.configuration;
  const before = await configuration.read(project.path, true);
  await configuration.save(project.path, {
    version: before.userVersion!,
    changes: { default_permissions: ':workspace', service_tier: 'fast' },
  });
  const thread = await service.create(project.id, { permission: 'danger-full-access' });
  expect(thread.nativeSettings).toMatchObject({
    sandbox: 'workspaceWrite',
    serviceTier: 'priority',
  });
  expect(spy.mock.calls.find(([method]) => method === 'thread/start')?.[1]).toEqual({
    cwd: project.path,
  });
  await service.send(thread.id, randomUUID(), 'Inherited configuration', {
    permission: 'danger-full-access',
    fast: false,
  });
  await until(() => thread.state === 'completed');
  const turn = spy.mock.calls.find(([method]) => method === 'turn/start')?.[1];
  for (const key of ['sandboxPolicy', 'approvalPolicy', 'approvalsReviewer', 'serviceTierForTurn'])
    expect(turn).not.toHaveProperty(key);
});

it('keeps model capabilities public while withholding private metadata', async () => {
  const { service } = await fixture();
  const call = service.driver.call.bind(service.driver);
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    const result = await call(method, params, timeout);
    if (method === 'model/list') {
      result.data[0].serviceTiers = [{ id: 'default', name: 'Standard', description: 'Standard' }];
      result.data[0].privateConfig = 'not-public';
    }
    return result;
  });
  const models = await service.modelSettings.models();
  expect(models[0]?.supportsFast).toBe(false);
  expect(models[0]).not.toHaveProperty('privateConfig');
});

it('keeps queued input waiting while a native approval is pending', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve] Standard task', thread.settings);
  await until(() => thread.actions.length > 0);
  const id = randomUUID();
  await service.enqueue(thread.id, id, { text: 'Waiting task', settings: {}, attachments: [] });
  await expect(service.steerQueued(thread.id, id, thread.turnId!)).rejects.toMatchObject({
    code: 'STEER_UNAVAILABLE',
  });
  expect(service.store.queue.get(id)?.state).toBe('queued');
  service.cancelQueued(thread.id, id);
  await service.interrupt(thread.id);
});
