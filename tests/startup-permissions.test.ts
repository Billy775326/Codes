import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return value;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit');
  child.kill('SIGTERM');
  await ended;
}
it('ignores retired global policy settings and preserves native permissions across restart', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'codes-startup-policy-')));
  const root = join(directory, 'project-outside-retired-root'),
    data = join(directory, 'private-data');
  await mkdir(root);
  await mkdir(data);
  const retiredRoot = join(directory, 'retired-root');
  await mkdir(retiredRoot);
  // A retired file is neither loaded nor migrated, even when malformed.
  await writeFile(join(data, 'task-policy.json'), '{retired-preview-policy');
  const token = 'isolated-startup-token-not-a-real-secret';
  let child: ChildProcess | undefined;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = 'http://127.0.0.1:' + (await port());
      child = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
        stdio: 'ignore',
        env: {
          ...process.env,
          CODES_RUNTIME: 'mock',
          CODES_DATA_DIR: data,
          CODES_TASK_WRITE_ROOT: attempt === 0 ? retiredRoot : '',
          CODES_PROJECT_ROOT: root,
          CODES_HOST: '127.0.0.1',
          CODES_PORT: new URL(base).port,
          CODES_PUBLIC_ORIGIN: base,
          CODES_ACCESS_TOKEN: token,
        },
      });
      await expect
        .poll(
          async () => {
            if (child?.exitCode !== null)
              throw new Error('The isolated server exited before readiness');
            try {
              return (await fetch(base + '/api/system')).status;
            } catch {
              return 0;
            }
          },
          { timeout: 5000 },
        )
        .toBe(401);
      const response = await fetch(base + '/api/login', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      expect(response.status).toBe(200);
      const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
      const system = await (await fetch(base + '/api/system', { headers: { cookie } })).json();
      expect(system).not.toHaveProperty('taskWriteRoot');
      const projects = await (await fetch(base + '/api/projects', { headers: { cookie } })).json();
      const project = projects.find((item: { path: string }) => item.path === root);
      expect(project).toBeDefined();
      const profile = await (
        await fetch(base + '/api/settings/defaults', { headers: { cookie } })
      ).json();
      if (attempt === 0) {
        const saved = await fetch(base + '/api/settings/defaults', {
          method: 'PUT',
          headers: { cookie, Origin: base, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            revision: profile.revision,
            settings: { permission: 'danger-full-access' },
          }),
        });
        expect(saved.status).toBe(200);
      } else expect(profile.settings.permission).toBe('danger-full-access');
      const created = await fetch(base + '/api/projects/' + project.id + '/threads', {
        method: 'POST',
        headers: { cookie, Origin: base, 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(created.status).toBe(200);
      expect((await created.json()).settings.permission).toBe('danger-full-access');
      await stop(child);
      child = undefined;
    }
  } finally {
    if (child) await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
});
