import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../src/server/store';
import { Service } from '../src/server/service';
import { Driver } from '../src/codex/driver';
import { AppError } from '../src/shared/errors';
import type { Thread } from '../src/shared/types';
const cleanup: (() => Promise<void>)[] = [];
it('shrinks dense history pages without skipping or duplicating older turns', async () => {
  const { service, project } = await fixture();
  const seeded = await service.driver.call('test/seed', {
    cwd: project.path,
    count: 8,
    extraCommandsPerTurn: 40,
  });
  await service.list(project.id);
  const id = seeded.thread.id;
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await service.history(id, cursor);
    expect(page.messages.length).toBeLessThanOrEqual(240);
    for (const turn of page.turns) {
      expect(seen.has(turn.id)).toBe(false);
      seen.add(turn.id);
    }
    expect(page.messages.filter((message) => message.kind === 'command')).toHaveLength(
      page.turns.length * 40,
    );
    cursor = page.olderCursor ?? undefined;
    pages++;
  } while (cursor && pages < 10);
  expect(cursor).toBeUndefined();
  expect(seen.size).toBe(8);
  expect(pages).toBeGreaterThan(1);
  const loaded = await service.read(id);
  expect(loaded.state).toBe('completed');
  expect(loaded.messages.length).toBeGreaterThan(0);
});
it('keeps an explicit limit for a single oversized turn', async () => {
  const { service, project } = await fixture();
  const seeded = await service.driver.call('test/seed', {
    cwd: project.path,
    count: 1,
    extraCommandsPerTurn: 250,
  });
  await service.list(project.id);
  await expect(service.history(seeded.thread.id)).rejects.toMatchObject({
    code: 'HISTORY_LIMIT',
    status: 413,
  });
});
it('does not regress a proven terminal result when its acknowledgement times out later', async () => {
  const { service, thread } = await fixture(1400);
  const id = randomUUID();
  await expect(service.send(thread.id, id, '[lost-ack]', thread.settings)).resolves.toMatchObject({
    state: 'completed',
  });
  expect(thread.state).toBe('completed');
  expect(thread.pending).toBeUndefined();
  expect(service.store.active(thread.id)).toBeUndefined();
});
it('retains cancellation intent across the CLI runner startup window', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[slow]', thread.settings);
  const call = service.driver.call.bind(service.driver);
  let starting = true;
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    if (method === 'turn/interrupt' && starting) {
      starting = false;
      throw new AppError('CLI_ERROR', 'no active turn to interrupt', 409);
    }
    return call(method, params, timeout);
  });
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  expect(thread.pending).toBeUndefined();
});
it('keeps a completed result when completion races with an interrupt request', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), 'Hello', thread.settings);
  await until(() => thread.state === 'completed');
  const call = service.driver.call.bind(service.driver);
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    if (method === 'turn/interrupt')
      throw new AppError('CLI_ERROR', 'no active turn to interrupt', 409);
    return call(method, params, timeout);
  });
  await expect(service.interrupt(thread.id)).resolves.toMatchObject({ alreadyFinished: true });
  expect(thread.state).toBe('completed');
});
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
it('evicts idle native subscriptions without losing a waiting approval or resumed history', async () => {
  const { service, project, thread } = await fixture();
  await service.send(thread.id, randomUUID(), 'Before cache eviction', thread.settings);
  await until(() => thread.state === 'completed');
  const waiting = await service.create(project.id, thread.settings);
  await service.send(waiting.id, randomUUID(), '[approve]', waiting.settings);
  await until(() => waiting.actions.length > 0);
  for (let i = 0; i < 22; i++) await service.create(project.id, thread.settings);
  const resumed = await service.read(thread.id);
  expect(resumed.messages.filter((m) => m.kind === 'user')).toHaveLength(1);
  await service.send(resumed.id, randomUUID(), 'After cache eviction', resumed.settings);
  await until(() => resumed.state === 'completed');
  expect(resumed.messages.filter((m) => m.kind === 'user')).toHaveLength(2);
  await service.answer(waiting.actions[0]!.id, randomUUID(), { decision: 'decline' });
  await until(() => waiting.state === 'interrupted');
});
async function fixture(timeoutMs = 2000) {
  const directory = await mkdtemp(join(tmpdir(), 'codes-service-'));
  const service = new Service(
    new Store(directory),
    new Driver('mock', { stateFile: join(directory, 'history.json'), timeoutMs }),
  );
  cleanup.push(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const project = await service.addProject(directory, 'Fixture');
  const thread = await service.create(project.id, { permission: 'read-only' });
  return { service, project, thread, directory };
}
async function until(predicate: () => boolean) {
  const end = Date.now() + 6000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Condition did not become true');
    await new Promise((r) => setTimeout(r, 15));
  }
}
it('streams one user message and one response for duplicate sends', async () => {
  const { service, thread } = await fixture();
  const id = randomUUID();
  const settings = { permission: 'read-only' } as const;
  await Promise.all([
    service.send(thread.id, id, 'Hello', settings),
    service.send(thread.id, id, 'Hello', settings),
  ]);
  await until(() => thread.state === 'completed');
  expect(thread.messages.filter((m) => m.kind === 'user')).toHaveLength(1);
  expect(thread.messages.filter((m) => m.kind === 'assistant')).toHaveLength(1);
  expect(thread.messages.at(-1)?.text).toContain('simulated response');
  expect(service.store.operation(id)?.state).toBe('completed');
});
it('keeps approval pending without a browser and accepts a single answer', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve]', thread.settings);
  await until(() => thread.actions.length > 0);
  expect(thread.state).toBe('waitingApproval');
  const action = thread.actions[0]!;
  const op = randomUUID();
  await service.answer(action.id, op, { decision: 'accept' });
  await service.answer(action.id, op, { decision: 'accept' });
  await expect(
    service.answer(action.id, randomUUID(), { decision: 'accept' }),
  ).rejects.toMatchObject({ code: 'STALE_ACTION' });
  await expect(service.answer(action.id, op, { decision: 'decline' })).rejects.toMatchObject({
    code: 'OPERATION_CONFLICT',
  });
  await until(() => thread.state === 'completed');
});
it('declines an approval without simulating successful execution', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve]', thread.settings);
  await until(() => thread.actions.length > 0);
  await service.answer(thread.actions[0]!.id, randomUUID(), { decision: 'decline' });
  await until(() => thread.state === 'interrupted');
  expect(thread.messages.some((m) => m.kind === 'assistant')).toBe(false);
});
it('validates all question answers before resolving a request', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[question]', thread.settings);
  await until(() => thread.actions.length > 0);
  const action = thread.actions[0]!;
  await expect(service.answer(action.id, randomUUID(), { answers: {} })).rejects.toMatchObject({
    code: 'ANSWER_REQUIRED',
  });
  await service.answer(action.id, randomUUID(), { answers: { direction: 'Continue' } });
  await until(() => thread.state === 'completed');
});
it('interrupts the actual task and clears its approval lifecycle', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve]', thread.settings);
  await until(() => thread.actions.length > 0);
  const action = thread.actions[0]!;
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  await expect(
    service.answer(action.id, randomUUID(), { decision: 'accept' }),
  ).rejects.toMatchObject({ code: 'STALE_ACTION' });
  expect(thread.pending).toBeUndefined();
});
it('reconciles a lost acknowledgement and lost terminal notification by client message ID', async () => {
  const { service, thread } = await fixture(1400);
  const id = randomUUID();
  await expect(
    service.send(thread.id, id, '[lost-ack] [lost-terminal]', thread.settings),
  ).rejects.toMatchObject({ code: 'RESULT_UNKNOWN' });
  expect(service.store.operation(id)?.state).toBe('unknown');
  await expect(service.archive(thread.id, randomUUID(), true)).rejects.toMatchObject({
    code: 'CONVERSATION_ACTIVE',
  });
  await expect(
    service.send(thread.id, randomUUID(), 'duplicate?', thread.settings),
  ).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
  await service.reconcile(thread.id);
  expect(thread.state).toBe('completed');
  expect(thread.pending).toBeUndefined();
  expect(service.store.operation(id)?.state).toBe('completed');
  expect(thread.messages.filter((m) => m.kind === 'user')).toHaveLength(1);
});
it('ignores terminal events for a different turn when clearing an execution lease', async () => {
  const { service, thread } = await fixture();
  const id = randomUUID();
  await service.send(thread.id, id, '[slow]', thread.settings);
  service.driver.emit('notification', {
    method: 'turn/completed',
    params: { threadId: thread.id, turn: { id: 'unrelated', status: 'completed', items: [] } },
  });
  expect(service.store.active(thread.id)?.id).toBe(id);
  await service.interrupt(thread.id);
});
it('paginates native history instead of loading every turn', async () => {
  const { service, project } = await fixture();
  await service.driver.call('test/seed', { cwd: project.path, count: 100 });
  const list = await service.list(project.id);
  const seed = list.find((t) => t.title === 'Rendering reference')!;
  const page = await service.history(seed.id);
  expect(page.messages).toHaveLength(24);
  expect(page.olderCursor).toBeTruthy();
  const older = await service.history(seed.id, page.olderCursor!);
  expect(older.messages).toHaveLength(24);
  expect(older.messages[0]?.id).not.toBe(page.messages[0]?.id);
});
it('blocks directory traversal, hidden files, and escaping symlinks', async () => {
  const { service, project, directory } = await fixture();
  await symlink('/etc', join(directory, 'outside'));
  for (const path of ['../passwd', '.private', 'outside/passwd'])
    await expect(service.file(project.id, path)).rejects.toMatchObject({ code: 'PATH_DENIED' });
});
it('rejects stale context but still returns an existing operation receipt after files change', async () => {
  const { service, project, directory, thread } = await fixture();
  await writeFile(join(directory, 'example.ts'), 'first\nsecond\n');
  const file = await service.file(project.id, 'example.ts');
  const attachments = [{ path: file.path, sha: file.sha, fromLine: 1, toLine: 2 }];
  const id = randomUUID();
  await service.send(thread.id, id, 'Read the file', thread.settings, attachments);
  await writeFile(join(directory, 'example.ts'), 'changed');
  expect(
    await service.send(thread.id, id, 'Read the file', thread.settings, attachments),
  ).toMatchObject({ id });
  await until(() => thread.state === 'completed');
  await expect(
    service.send(thread.id, randomUUID(), 'Read again', thread.settings, attachments),
  ).rejects.toMatchObject({ code: 'FILE_CHANGED' });
});
it('expires live approvals and blocks accidental resends after the runtime exits', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve]', thread.settings);
  await until(() => thread.actions.length > 0);
  const action = thread.actions[0]!;
  await service.driver.stop();
  expect(thread.state).toBe('unknown');
  expect(action.status).toBe('expired');
  await expect(
    service.send(thread.id, randomUUID(), 'Again', thread.settings),
  ).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
});

it('renames native conversations without interrupting their task or changing its receipt', async () => {
  const { service, thread } = await fixture();
  const sendId = randomUUID();
  await service.send(thread.id, sendId, '[approve] Rename while working', thread.settings);
  await until(() => thread.actions.length > 0);
  const renameId = randomUUID();
  await expect(service.rename(thread.id, renameId, 'Focused work')).resolves.toMatchObject({
    title: 'Focused work',
    executionPending: true,
  });
  await expect(service.rename(thread.id, renameId, 'Focused work')).resolves.toMatchObject({
    title: 'Focused work',
  });
  await expect(service.rename(thread.id, renameId, 'Other')).rejects.toMatchObject({
    code: 'OPERATION_CONFLICT',
  });
  expect(service.store.active(thread.id)?.id).toBe(sendId);
  expect(
    (await service.driver.call('thread/read', { threadId: thread.id, includeTurns: false })).thread
      .name,
  ).toBe('Focused work');
  await expect(service.archive(thread.id, randomUUID(), true)).rejects.toMatchObject({
    code: 'CONVERSATION_ACTIVE',
  });
  await service.interrupt(thread.id);
});
it('paginates beyond 200 conversations, searches titles without case sensitivity, and scopes cursors', async () => {
  const { service, project } = await fixture();
  await service.driver.call('test/seedConversations', { cwd: project.path, count: 250 });
  const seen = new Set<string>();
  let cursor: string | undefined;
  let firstCursor = '';
  do {
    const page = await service.conversations(project.id, { cursor });
    expect(page.data.length).toBeLessThanOrEqual(30);
    for (const row of page.data) {
      expect(seen.has(row.id)).toBe(false);
      seen.add(row.id);
    }
    cursor = page.nextCursor ?? undefined;
    firstCursor ||= cursor ?? '';
  } while (cursor);
  expect(seen.size).toBe(251);
  const found = await service.conversations(project.id, { search: 'FIXTURE CONVERSATION 24' });
  expect(found.data).toHaveLength(10);
  expect(found.data.every((row) => row.title.startsWith('Fixture conversation 24'))).toBe(true);
  await expect(
    service.conversations(project.id, { cursor: firstCursor, archived: true }),
  ).rejects.toMatchObject({ code: 'LIST_CURSOR' });
  await expect(
    service.conversations(project.id, { cursor: firstCursor, search: 'changed' }),
  ).rejects.toMatchObject({ code: 'LIST_CURSOR' });
  await expect(service.conversations(project.id, { cursor: 'invalid' })).rejects.toMatchObject({
    code: 'LIST_CURSOR',
  });
});
it('archives and restores native history while refusing new work in the archived view', async () => {
  const { service, project, thread } = await fixture();
  await service.send(thread.id, randomUUID(), 'Keep this history', thread.settings);
  await until(() => thread.state === 'completed');
  const id = randomUUID();
  await expect(service.archive(thread.id, id, true)).resolves.toMatchObject({
    archived: true,
    managementPending: false,
  });
  await expect(service.archive(thread.id, id, true)).resolves.toMatchObject({ archived: true });
  expect((await service.conversations(project.id)).data).toHaveLength(0);
  expect((await service.conversations(project.id, { archived: true })).data).toHaveLength(1);
  expect(
    (await service.history(thread.id)).messages.filter((row) => row.kind === 'user'),
  ).toHaveLength(1);
  await expect(
    service.send(thread.id, randomUUID(), 'Forbidden', thread.settings),
  ).rejects.toMatchObject({ code: 'CONVERSATION_ARCHIVED' });
  await expect(service.archive(thread.id, randomUUID(), false)).resolves.toMatchObject({
    archived: false,
  });
  await service.send(thread.id, randomUUID(), 'After restoration', thread.settings);
  await until(() => thread.state === 'completed');
  expect(
    (await service.history(thread.id)).messages.filter((row) => row.kind === 'user'),
  ).toHaveLength(2);
});
it('keeps an uncertain archive protected until native evidence proves its result', async () => {
  const { service, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation(async (method, params, timeout) => {
      if (method === 'thread/archive')
        throw new AppError('RPC_TIMEOUT', 'Test-only lost acknowledgement', 504, true);
      return call(method, params, timeout);
    });
  const id = randomUUID();
  await expect(service.archive(thread.id, id, true)).rejects.toMatchObject({ code: 'RPC_TIMEOUT' });
  expect(service.store.thread(thread.id)?.managementPending).toBe(true);
  await expect(
    service.send(thread.id, randomUUID(), 'Do not dispatch', thread.settings),
  ).rejects.toMatchObject({ code: 'MANAGEMENT_BUSY' });
  await service.checkManagement(thread.id);
  expect(service.store.operation(id)?.state).toBe('unknown');
  spy.mockRestore();
  await call('thread/archive', { threadId: thread.id });
  await until(() => service.store.operation(id)?.state === 'completed');
  expect(service.store.thread(thread.id)).toMatchObject({
    archived: true,
    managementPending: false,
  });
});
it('does not import a stale list title over a concurrent native rename', async () => {
  const { service, project, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation(async (method, params, timeout) => {
      const response = await call(method, params, timeout);
      if (method === 'thread/list') {
        captured();
        await paused;
      }
      return response;
    });
  const listing = service.conversations(project.id);
  await ready;
  await service.rename(thread.id, randomUUID(), 'New title wins');
  release();
  expect((await listing).data.find((row) => row.id === thread.id)?.title).toBe('New title wins');
  spy.mockRestore();
});
it('does not replace the first task title with an earlier empty native list response', async () => {
  const { service, project, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation(async (method, params, timeout) => {
      const response = await call(method, params, timeout);
      if (method === 'thread/list') {
        captured();
        await paused;
      }
      return response;
    });
  const listing = service.conversations(project.id);
  await ready;
  await service.send(thread.id, randomUUID(), '[approve] First task title', thread.settings);
  await until(() => thread.actions.length > 0);
  release();
  expect((await listing).data.find((row) => row.id === thread.id)?.title).toBe(
    '[approve] First task title',
  );
  expect(thread.title).toBe('[approve] First task title');
  spy.mockRestore();
  await service.interrupt(thread.id);
});
