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
