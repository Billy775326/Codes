import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
it('uses the saved port and allows local and HTTPS proxy origins after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codes-network-startup-'));
  const initialPort = await port();
  let nextPort = await port();
  while (nextPort === initialPort) nextPort = await port();
  const local = (value: number) => `http://127.0.0.1:${value}`;
  const proxy = 'https://codes.example.test';
  const token = 'isolated-network-token-not-a-real-secret';
  const env = {
    ...process.env,
    CODES_RUNTIME: 'mock',
    CODES_DATA_DIR: directory,
    CODES_PROJECT_ROOT: '',
    CODES_HOST: '127.0.0.1',
    CODES_PORT: String(initialPort),
    CODES_PUBLIC_ORIGIN: local(initialPort),
    CODES_ACCESS_TOKEN: token,
    CODES_CODE_QUESTIONS: '1',
    CODES_CODEX_REQUEST_TIMEOUT_MS: '23000',
  };
  const path = '/api/settings/network';
  let child: ChildProcess | undefined;
  try {
    for (const currentPort of [initialPort, nextPort]) {
      child = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
        stdio: 'ignore',
        env,
      });
      const base = local(currentPort);
      await expect
        .poll(
          async () => {
            if (child?.exitCode !== null) throw new Error('The isolated network server exited.');
            try {
              return (await fetch(base + path)).status;
            } catch {
              return 0;
            }
          },
          { timeout: 5000 },
        )
        .toBe(401);
      const response = await fetch(base + '/api/login', {
        method: 'POST',
        headers: { origin: base, 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      expect(response.status).toBe(200);
      const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
      const runtimePath = base + '/api/settings/runtime';
      const runtime = await (await fetch(runtimePath, { headers: { cookie } })).json();
      if (currentPort === initialPort) {
        expect((await fetch(runtimePath)).status).toBe(401);
        expect(runtime).toMatchObject({
          active: { codeQuestions: true, requestTimeoutMs: 23000 },
          restartRequired: false,
        });
        const saveRuntime = (requestTimeoutMs: number) =>
          fetch(runtimePath, {
            method: 'PUT',
            headers: { cookie, origin: base, 'content-type': 'application/json' },
            body: JSON.stringify({
              revision: 0,
              settings: { codeQuestions: false, requestTimeoutMs },
            }),
          });
        expect((await saveRuntime(100)).status).toBe(400);
        const updatedRuntime = await saveRuntime(45000);
        expect(updatedRuntime.status).toBe(200);
        expect(await updatedRuntime.json()).toMatchObject({
          restartRequired: true,
          active: runtime.active,
        });
        expect((await saveRuntime(46000)).status).toBe(409);
        const saved = await fetch(base + path, {
          method: 'PUT',
          headers: { cookie, origin: base, 'content-type': 'application/json' },
          body: JSON.stringify({
            revision: 0,
            settings: {
              host: '127.0.0.1',
              port: nextPort,
              origins: [local(nextPort), proxy],
              authMode: 'local',
            },
          }),
        });
        expect(saved.status).toBe(200);
        expect(await saved.json()).toMatchObject({
          restartRequired: true,
          active: { port: initialPort },
        });
      } else {
        expect(runtime).toMatchObject({
          active: { codeQuestions: false, requestTimeoutMs: 45000 },
          restartRequired: false,
        });
        const system = await (await fetch(base + '/api/system', { headers: { cookie } })).json();
        expect(system).toMatchObject({ defaultProjectPath: resolve(import.meta.dirname, '..') });
        expect(system).not.toHaveProperty('codeQuestions');
        expect(await (await fetch(base + '/api/projects', { headers: { cookie } })).json()).toEqual(
          [],
        );
        const state = await (await fetch(base + path, { headers: { cookie } })).json();
        expect(state).toMatchObject({
          restartRequired: false,
          active: { port: nextPort, origins: [base, proxy] },
        });
        const proxiedLogin = (origin: string, host: string) =>
          new Promise<IncomingMessage>((resolve, reject) => {
            const request = httpRequest(
              base + '/api/login',
              { method: 'POST', headers: { origin, host, 'content-type': 'application/json' } },
              (response) => {
                response.resume();
                resolve(response);
              },
            );
            request.on('error', reject);
            request.end(JSON.stringify({ token }));
          });
        const proxied = await proxiedLogin(proxy, 'codes.example.test');
        expect(proxied.statusCode).toBe(200);
        expect(proxied.headers['set-cookie']?.[0]).toContain('; Secure');
        expect((await proxiedLogin(base, 'codes.example.test')).statusCode).toBe(403);
        expect(
          (await proxiedLogin('https://invalid.example.test', 'invalid.example.test')).statusCode,
        ).toBe(403);
      }
      await stop(child);
      child = undefined;
    }
  } finally {
    if (child) await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
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
      expect(system).toMatchObject({ defaultProjectPath: root });
      expect(system).not.toHaveProperty('taskWriteRoot');
      const projects = await (await fetch(base + '/api/projects', { headers: { cookie } })).json();
      const project = projects.find((item: { path: string }) => item.path === root);
      expect(project).toBeDefined();
      const path = base + '/api/projects/' + project.id + '/codex-configuration';
      const config = await (await fetch(path, { headers: { cookie } })).json();
      if (attempt === 0) {
        const saved = await fetch(path, {
          method: 'PUT',
          headers: { cookie, Origin: base, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            version: config.userVersion,
            changes: { default_permissions: ':workspace' },
          }),
        });
        expect(saved.status).toBe(200);
      } else expect(config.permissionProfile).toBe(':workspace');
      const created = await fetch(base + '/api/projects/' + project.id + '/threads', {
        method: 'POST',
        headers: { cookie, Origin: base, 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(created.status).toBe(200);
      expect((await created.json()).nativeSettings).toMatchObject({
        permissionProfile: ':workspace',
        sandbox: 'workspaceWrite',
      });
      await stop(child);
      child = undefined;
    }
  } finally {
    if (child) await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
});
it('starts with a missing registered project and keeps saved history available after restart', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'codes-missing-startup-')));
  const root = join(directory, 'project'),
    data = join(directory, 'data');
  await mkdir(root);
  let child: ChildProcess | undefined;
  let threadId = '',
    projectId = '';
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = 'http://127.0.0.1:' + (await port());
      child = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
        stdio: 'ignore',
        env: {
          ...process.env,
          CODES_RUNTIME: 'mock',
          CODES_DATA_DIR: data,
          CODES_PROJECT_ROOT: root,
          CODES_HOST: '127.0.0.1',
          CODES_PORT: new URL(base).port,
          CODES_PUBLIC_ORIGIN: base,
          CODES_ACCESS_TOKEN: 'missing-directory-fixture-token',
        },
      });
      await expect
        .poll(
          async () => {
            if (child?.exitCode !== null)
              throw new Error('Server did not retain the registered project');
            try {
              return (await fetch(base + '/api/system')).status;
            } catch {
              return 0;
            }
          },
          { timeout: 5000 },
        )
        .toBe(401);
      const login = await fetch(base + '/api/login', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'missing-directory-fixture-token' }),
      });
      expect(login.status).toBe(200);
      const headers = {
        cookie: login.headers.get('set-cookie')!.split(';')[0]!,
        Origin: base,
        'Content-Type': 'application/json',
      };
      const projects = await (await fetch(base + '/api/projects', { headers })).json();
      expect(projects).toHaveLength(1);
      projectId = projects[0].id;
      if (attempt === 0) {
        const thread = await (
          await fetch(base + '/api/projects/' + projectId + '/threads', {
            method: 'POST',
            headers,
            body: '{}',
          })
        ).json();
        threadId = thread.id;
        const sent = await fetch(base + '/api/threads/' + threadId + '/send', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            text: 'Persist history across missing directory',
            settings: { permission: 'read-only' },
            attachments: [],
          }),
        });
        expect(sent.status).toBe(200);
        await expect
          .poll(
            async () =>
              (
                await (
                  await fetch(base + '/api/threads/' + threadId + '/snapshot', { headers })
                ).json()
              ).thread.state,
            { timeout: 5000 },
          )
          .toBe('completed');
      } else {
        const snapshot = await (
          await fetch(base + '/api/threads/' + threadId + '/snapshot', { headers })
        ).json();
        expect(
          snapshot.thread.messages.some((message: { text: string }) =>
            message.text.includes('Persist history'),
          ),
        ).toBe(true);
        expect(snapshot.context.directory).toMatchObject({
          available: false,
          code: 'DIRECTORY_UNAVAILABLE',
        });
        expect(
          (
            await fetch(base + '/api/projects/' + projectId + '/threads', {
              method: 'POST',
              headers,
              body: '{}',
            })
          ).status,
        ).toBe(409);
      }
      await stop(child);
      child = undefined;
      if (attempt === 0) await rename(root, root + '-moved');
    }
  } finally {
    if (child) await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
});
