import { mkdtemp, mkdir, writeFile, rename, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { Service } from '../src/server/service';
import { Store } from '../src/server/store';
import { Driver } from '../src/codex/driver';
import { projectViews, rememberProject } from '../src/web/project-navigation';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const work of cleanup.splice(0).reverse()) await work();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'codes-project-context-'));
  const a = join(directory, 'a'),
    b = join(directory, 'b');
  await mkdir(a);
  await mkdir(b);
  await writeFile(join(a, 'same.ts'), 'ALPHA_SOURCE\n');
  await writeFile(join(b, 'same.ts'), 'BETA_SOURCE\n');
  const service = new Service(
    new Store(join(directory, 'data')),
    new Driver('mock', { stateFile: join(directory, 'mock.json'), timeoutMs: 3000 }),
  );
  cleanup.push(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const projectA = await service.addProject(a),
    projectB = await service.addProject(b);
  const threadA = await service.create(projectA.id),
    threadB = await service.create(projectB.id);
  return { directory, a, b, service, projectA, projectB, threadA, threadB };
}
it('resolves same-named files and attachment hashes from the conversation owner', async () => {
  const { service, threadA, threadB, projectB } = await fixture();
  expect((await service.conversationContext(threadB.id)).project.id).toBe(projectB.id);
  const a = await service.conversationFile(threadA.id, 'same.ts');
  expect((await service.conversationFile(threadB.id, 'same.ts')).text).toBe('BETA_SOURCE\n');
  const call = vi.spyOn(service.driver, 'call');
  await expect(
    service.send(threadB.id, randomUUID(), 'Wrong context', threadB.settings, [
      { path: 'same.ts', sha: a.sha, fromLine: 1, toLine: 1 },
    ]),
  ).rejects.toMatchObject({ code: 'FILE_CHANGED' });
  expect(call.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
  await service.send(threadB.id, randomUUID(), '[hold] Bound working directory', threadB.settings);
  expect(call.mock.calls.find(([method]) => method === 'turn/start')?.[1]).toMatchObject({
    cwd: projectB.path,
  });
  await service.interrupt(threadB.id);
});
it('preserves history and settings while a missing directory blocks file access, creation, review, send and steer', async () => {
  const { service, a, threadA, projectA } = await fixture();
  await service.send(threadA.id, randomUUID(), '[hold] Retained history', threadA.settings);
  const count = service.store.db.prepare('select count(*) as n from operations').get()!.n;
  await rename(a, a + '-moved');
  expect(
    (await service.history(threadA.id)).messages.some((message) =>
      message.text.includes('Retained history'),
    ),
  ).toBe(true);
  expect((await service.projectContext(projectA.id)).directory).toMatchObject({
    available: false,
    code: 'DIRECTORY_UNAVAILABLE',
  });
  expect(service.store.settingsProfile(threadA.id).settings.permission).toBe('read-only');
  for (const work of [
    () => service.conversationFiles(threadA.id, ''),
    () => service.conversationFile(threadA.id, 'same.ts'),
    () => service.create(projectA.id),
    () => service.steer(threadA.id, randomUUID(), threadA.turnId!, 'Blocked follow-up'),
  ])
    await expect(work()).rejects.toMatchObject({
      code: 'DIRECTORY_UNAVAILABLE',
      status: 409,
      uncertain: false,
    });
  expect(service.store.db.prepare('select count(*) as n from operations').get()!.n).toBe(count);
  await service.interrupt(threadA.id);
  expect(threadA.state).toBe('interrupted');
  await expect(
    service.send(threadA.id, randomUUID(), 'Blocked', threadA.settings),
  ).rejects.toMatchObject({ code: 'DIRECTORY_UNAVAILABLE' });
  await expect(
    service.review(threadA.id, randomUUID(), { type: 'uncommittedChanges' }, threadA.settings),
  ).rejects.toMatchObject({ code: 'DIRECTORY_UNAVAILABLE' });
  await rename(a + '-moved', a);
  expect((await service.projectContext(projectA.id)).directory.available).toBe(true);
  expect((await service.conversationFile(threadA.id, 'same.ts')).text).toBe('ALPHA_SOURCE\n');
});
it('refuses a native conversation whose working directory no longer matches its registration', async () => {
  const { service, threadA, b } = await fixture();
  const call = service.driver.call.bind(service.driver);
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation(async (method, params, timeout) => {
      const result = await call(method, params, timeout);
      if (method === 'thread/read') result.thread.cwd = b;
      return result;
    });
  await expect(service.conversationFile(threadA.id, 'same.ts')).rejects.toMatchObject({
    code: 'PROJECT_OWNERSHIP',
  });
  await expect(
    service.send(threadA.id, randomUUID(), 'Do not run in another folder', threadA.settings),
  ).rejects.toMatchObject({ code: 'PROJECT_OWNERSHIP' });
  expect(spy.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
});
it('does not silently follow a registered directory retargeted to another project', async () => {
  const { service, a, b, projectA, threadA } = await fixture();
  await rename(a, a + '-original');
  await symlink(b, a);
  expect((await service.projectContext(projectA.id)).directory.available).toBe(false);
  await expect(service.conversationFile(threadA.id, 'same.ts')).rejects.toMatchObject({
    code: 'DIRECTORY_UNAVAILABLE',
  });
  await unlink(a);
  await rename(a + '-original', a);
  expect((await service.conversationFile(threadA.id, 'same.ts')).text).toBe('ALPHA_SOURCE\n');
});
it('distinguishes a missing file from a missing project directory', async () => {
  const { service, threadA } = await fixture();
  await expect(service.conversationFile(threadA.id, 'absent.ts')).rejects.toMatchObject({
    code: 'FILE_NOT_FOUND',
    status: 404,
  });
  expect((await service.conversationContext(threadA.id)).directory.available).toBe(true);
});
it('pauses queued work without claiming it when the directory disappears, then resumes after explicit recovery', async () => {
  const { service, a, threadA } = await fixture();
  await service.send(threadA.id, randomUUID(), '[hold] Active task', threadA.settings);
  const id = randomUUID();
  await service.enqueue(threadA.id, id, {
    text: 'Deferred task',
    settings: threadA.settings,
    attachments: [],
  });
  await rename(a, a + '-moved');
  await expect(service.steerQueued(threadA.id, id, threadA.turnId!)).rejects.toMatchObject({
    code: 'DIRECTORY_UNAVAILABLE',
  });
  expect(service.store.queue.get(id)?.state).toBe('queued');
  expect(service.store.operation(id)).toBeUndefined();
  await service.interrupt(threadA.id);
  service.controlQueue(threadA.id, false);
  await expect
    .poll(() => service.queueState(threadA.id).reason, { timeout: 4000 })
    .toContain('directory is unavailable');
  expect(service.store.queue.get(id)?.state).toBe('queued');
  expect(service.store.operation(id)).toBeUndefined();
  await rename(a + '-moved', a);
  service.controlQueue(threadA.id, false);
  await expect.poll(() => service.store.queue.get(id)?.state, { timeout: 6000 }).toBe('completed');
});
it('bounds browser project views and preserves the explicit new-conversation view', () => {
  let views: Record<string, string> = {};
  for (let n = 0; n < 25; n++) views = rememberProject(views, 'project-' + n, 'thread-' + n);
  views = rememberProject(views, 'project-24', '');
  expect(Object.keys(views)).toHaveLength(20);
  expect(projectViews(JSON.stringify(views))['project-24']).toBe('');
  expect(projectViews('{bad')).toEqual({});
  expect(projectViews(JSON.stringify({ a: 1, b: 'thread', c: null }))).toEqual({ b: 'thread' });
});
