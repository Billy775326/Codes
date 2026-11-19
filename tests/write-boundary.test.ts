import { mkdtemp, mkdir, rm, symlink, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { WriteBoundary } from '../src/codex/write-boundary';
import { taskWriteBoundary } from '../src/server/task-policy';
import { Service } from '../src/server/service';
import { Store } from '../src/server/store';
import { Driver } from '../src/codex/driver';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'codes-boundary-')));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'allowed'),
    outside = join(directory, 'outside');
  await mkdir(root);
  await mkdir(outside);
  const boundary = new WriteBoundary(root);
  return { directory, root, outside, boundary };
}
it('uses canonical directory boundaries instead of path prefixes or symlink aliases', async () => {
  const { directory, root, outside, boundary } = await fixture();
  const sibling = root + '-sibling';
  await mkdir(sibling);
  await mkdir(join(root, 'nested'));
  await symlink(outside, join(root, 'escape'));
  expect(boundary.directory(join(root, 'nested'))).toBe(join(root, 'nested'));
  for (const path of [directory, outside, sibling, join(root, 'escape')])
    expect(() => boundary.directory(path)).toThrow(/inside the task write root/);
});
it('fails closed for unsupported or conflicting persisted owner policies', async () => {
  const { root, outside } = await fixture();
  await mkdir(join(root, '.codex'));
  const policy = join(root, 'task-policy.json');
  expect(taskWriteBoundary(root)).toBeUndefined();
  await writeFile(policy, JSON.stringify({ version: 1, writeRoot: root }));
  expect(taskWriteBoundary(root)?.root).toBe(root);
  expect(() => taskWriteBoundary(root, outside)).toThrow(/conflicts/);
  await writeFile(policy, JSON.stringify({ version: 2, writeRoot: root }));
  expect(() => taskWriteBoundary(root)).toThrow(/Invalid/);
  await writeFile(policy, '{');
  expect(() => taskWriteBoundary(root)).toThrow();
});
it('blocks full-access preferences, sends, queued messages and external projects before side effects', async () => {
  const { root, outside, directory, boundary } = await fixture();
  const service = new Service(
    new Store(join(directory, 'data')),
    new Driver('mock', { stateFile: join(directory, 'mock.json'), writeBoundary: boundary }),
  );
  cleanup.push(() => service.close());
  const project = await service.addProject(root);
  await expect(service.addProject(outside)).rejects.toMatchObject({ code: 'TASK_WRITE_BOUNDARY' });
  const full = { permission: 'danger-full-access' as const };
  await expect(service.create(project.id, full)).rejects.toMatchObject({
    code: 'TASK_WRITE_BOUNDARY',
  });
  const thread = await service.create(project.id, { permission: 'read-only' });
  expect(() => service.saveDefaultSettings(0, full)).toThrow(/Full access/);
  expect(() => service.saveConversationSettings(thread.id, 0, full)).toThrow(/Full access/);
  expect(service.store.settingsProfile(thread.id).settings.permission).toBe('read-only');
  const operation = randomUUID();
  await expect(service.send(thread.id, operation, 'Forbidden task', full)).rejects.toMatchObject({
    code: 'TASK_WRITE_BOUNDARY',
  });
  expect(service.store.operation(operation)).toBeUndefined();
  await expect(
    service.enqueue(thread.id, randomUUID(), {
      text: 'Forbidden queue',
      settings: full,
      attachments: [],
    }),
  ).rejects.toMatchObject({ code: 'TASK_WRITE_BOUNDARY' });
  expect(service.store.queue.count(thread.id)).toBe(0);
  expect(service.driver.system().taskWriteRoot).toBe(root);
});
it('refuses unconfined external tool processes while permitting explicitly disabled entries', async () => {
  const { boundary } = await fixture();
  for (const config of [
    { mcp_servers: { local: { command: 'node' } } },
    { plugins: { tool: { enabled: true } } },
    { notify: ['sh'] },
    { hooks: { Stop: [] } },
  ])
    expect(() => boundary.checkConfiguration(config)).toThrow(/requires MCP/);
  expect(() =>
    boundary.checkConfiguration({
      mcp_servers: { local: { enabled: false } },
      plugins: { tool: { enabled: false } },
    }),
  ).not.toThrow();
});
it('keeps read-only tasks read-only and removes temporary roots and sandbox elevation', async () => {
  const { root, boundary } = await fixture();
  expect(
    boundary.params('turn/start', { threadId: 'x', sandboxPolicy: { type: 'readOnly' } }),
  ).toEqual({
    threadId: 'x',
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
  });
  const next = boundary.params('turn/start', {
    sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/tmp'] },
    approvalPolicy: 'on-request',
  }) as any;
  expect(next.sandboxPolicy).toEqual({
    type: 'workspaceWrite',
    writableRoots: [root],
    networkAccess: false,
    excludeTmpdirEnvVar: true,
    excludeSlashTmp: true,
  });
  expect(next.approvalPolicy).toBe('never');
  expect(() =>
    boundary.params('turn/start', { sandboxPolicy: { type: 'dangerFullAccess' } }),
  ).toThrow(/Full access/);
  expect(
    (boundary.params('thread/settings/update', { serviceTier: 'priority' }) as any).sandboxPolicy
      .type,
  ).toBe('readOnly');
});
