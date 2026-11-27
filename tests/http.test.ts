import { deferred } from '../src/shared/deferred';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import type { IncomingHttpHeaders } from 'node:http';
import { switchWebPreview } from '../scripts/web-preview';
import { Store } from '../src/server/store';
import { Service } from '../src/server/service';
import { Driver } from '../src/codex/driver';
import { application } from '../src/server/http';
import { NetworkConfiguration } from '../src/server/network-settings';
import { AccessToken } from '../src/server/access-token';
import { sampleDocx, samplePdf } from './fixtures/document';
let app: Awaited<ReturnType<typeof application>>;
let directory: string;
let service: Service;
let origin: string;
let cookie: string;
const token = 'test-only-access-token-not-a-real-secret';
it('stops advancing disconnected HTTP history while a different conversation is running', async () => {
  const project = await service.addProject(directory);
  const active = await service.create(project.id, { permission: 'read-only' });
  const history = await service.create(project.id, { permission: 'read-only' });
  await service.send(active.id, randomUUID(), '[hold] Keep this turn running', active.settings);
  const readStarted = deferred<void>();
  const releasePage = deferred<void>();
  const loggedAbort = deferred<void>();
  const output = console.info;
  const info = vi.spyOn(console, 'info').mockImplementation((line) => {
    if (typeof line === 'string' && line.includes('CLIENT_DISCONNECTED')) loggedAbort.resolve();
    else output(line);
  });
  const call = service.driver.call.bind(service.driver);
  let pages = 0;
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation(async (method, params, timeout) => {
      if (
        typeof params === 'object' &&
        params &&
        'threadId' in params &&
        params.threadId === history.id
      ) {
        if (method === 'thread/turns/list')
          return { data: [{ id: 'history-turn', status: 'completed', itemsView: 'notLoaded' }] };
        if (method === 'thread/items/list') {
          pages++;
          readStarted.resolve();
          await releasePage.promise;
          return { data: [], nextCursor: pages === 1 ? 'next' : null };
        }
      }
      return call(method, params, timeout);
    });
  const cursor = Buffer.from(
    JSON.stringify({ id: history.id, cursor: '', direction: 'older' }),
  ).toString('base64url');
  const controller = new AbortController();
  try {
    const request = fetch(origin + '/api/threads/' + history.id + '/history?cursor=' + cursor, {
      headers: { cookie },
      signal: controller.signal,
    });
    const aborted = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await readStarted.promise;
    controller.abort();
    await aborted;
    await loggedAbort.promise;
    releasePage.resolve();
    const snapshot = await fetch(origin + '/api/threads/' + active.id + '/snapshot', {
      headers: { cookie },
    });
    expect(snapshot.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect((await snapshot.json()).thread.state).toBe('running');
    expect(pages).toBe(1);
    await service.interrupt(active.id);
  } finally {
    releasePage.resolve();
    spy.mockRestore();
    info.mockRestore();
  }
});
it('switches and rolls back a compatible web build without restarting execution or its event stream', async () => {
  const dist = join(directory, 'dist');
  const candidate = join(directory, 'candidate');
  const state = join(directory, 'preview-state');
  const previous = 'style-aaaaaaaa.css';
  const next = 'style-bbbbbbbb.css';
  for (const [folder, asset, style] of [
    [dist, previous, 'body{color:red}'],
    [candidate, next, 'body{color:blue}'],
  ] as const) {
    await mkdir(join(folder, 'server'), { recursive: true });
    await writeFile(join(folder, 'server', 'main.js'), 'same backend');
    await mkdir(join(folder, 'web', 'assets'), { recursive: true });
    await writeFile(join(folder, 'web', 'assets', asset), style);
    await writeFile(
      join(folder, 'web', 'index.html'),
      '<link rel="stylesheet" href="/assets/' + asset + '">',
    );
  }
  const project = await service.addProject(directory);
  const thread = await service.create(project.id, { permission: 'read-only' });
  await service.send(thread.id, randomUUID(), '[hold] Keep executing', thread.settings);
  const epoch = service.events.epoch;
  const controller = new AbortController();
  const event = await fetch(
    origin +
      '/api/events?' +
      new URLSearchParams({
        threadId: thread.id,
        after: String(service.events.seq),
        epoch,
      }),
    { headers: { cookie }, signal: controller.signal },
  );
  const reader = event.body!.getReader();
  const webBuild = async () =>
    (await fetch(origin + '/api/web-build', { headers: { cookie } })).json();
  try {
    expect(await webBuild()).toEqual({ signature: '/assets/' + previous });
    await switchWebPreview(dist, state, candidate);
    expect(await (await fetch(origin + '/')).text()).toContain(next);
    expect(await webBuild()).toEqual({ signature: '/assets/' + next });
    expect(await (await fetch(origin + '/assets/' + previous)).text()).toBe('body{color:red}');
    service.events.publish('web-switch-fixture', {}, thread.id);
    let received = '';
    while (!received.includes('web-switch-fixture')) {
      const frame = await reader.read();
      expect(frame.done).toBe(false);
      received += new TextDecoder().decode(frame.value);
    }
    expect(service.events.epoch).toBe(epoch);
    expect(thread.state).toBe('running');
    await writeFile(join(candidate, 'server', 'main.js'), 'different backend');
    await expect(switchWebPreview(dist, state, candidate)).rejects.toThrow(
      /different backend output/,
    );
    await switchWebPreview(dist, state);
    expect(await webBuild()).toEqual({ signature: '/assets/' + previous });
    expect(await (await fetch(origin + '/assets/' + next)).text()).toBe('body{color:blue}');
    await service.interrupt(thread.id);
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
});
it('returns only effective execution defaults for an authenticated registered project', async () => {
  const project = await service.addProject(directory);
  const url = origin + '/api/projects/' + project.id + '/codex-defaults';
  const call = service.driver.call.bind(service.driver);
  const spy = vi.spyOn(service.driver, 'call').mockImplementation((method, params, timeout) =>
    method === 'config/read'
      ? Promise.resolve({
          config: {
            model: 'fixture-default',
            model_reasoning_effort: 'high',
            service_tier: 'priority',
            features: { fast_mode: false },
            mcp_servers: { private: { env: { TOKEN: 'private-fixture-only' } } },
          },
          origins: {
            model: { name: { type: 'user', file: 'private-config.toml' }, version: 'fixture' },
          },
        })
      : call(method, params, timeout),
  );
  expect((await fetch(url)).status).toBe(401);
  expect(await (await fetch(url, { headers: { cookie } })).json()).toEqual({
    model: 'fixture-default',
    effort: 'high',
    fast: false,
    fastAvailable: false,
  });
  expect(spy).toHaveBeenCalledWith('config/read', { cwd: project.path, includeLayers: false });
});
it('edits only the authenticated project instructions and rejects stale revisions and symlinks', async () => {
  const root = join(directory, 'project');
  await mkdir(root);
  const project = await service.addProject(root);
  const url = origin + '/api/projects/' + project.id + '/instructions';
  const path = join(root, 'AGENTS.md');
  const read = () => fetch(url, { headers: { cookie } });
  const save = (value: unknown, session = cookie) =>
    fetch(url, {
      method: 'PUT',
      headers: { origin, cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
  expect(await (await read()).json()).toEqual({ text: '', revision: null });
  expect((await save({ revision: null, text: '# Unauthorized' }, '')).status).toBe(401);
  expect((await save({ revision: null, text: '# Instructions\n' })).status).toBe(200);
  expect(await readFile(path, 'utf8')).toBe('# Instructions\n');
  const current = await (await read()).json();
  expect((await save({ revision: null, text: 'Would overwrite' })).status).toBe(409);
  const changed = await save({ revision: current.revision, text: '# Updated\n' });
  expect(changed.status).toBe(200);
  const updated = await changed.json();
  await writeFile(path, '# External edit\n');
  expect((await save({ revision: updated.revision, text: 'Stale edit' })).status).toBe(409);
  expect(await readFile(path, 'utf8')).toBe('# External edit\n');
  const outside = join(directory, 'external.txt');
  await writeFile(outside, 'Keep this file');
  await rm(path);
  await symlink(outside, path);
  expect((await read()).status).toBe(403);
  expect((await save({ revision: null, text: 'Replace symlink' })).status).toBe(403);
  expect(await readFile(outside, 'utf8')).toBe('Keep this file');
});
it('allows authenticated browsing of protected and external server paths with a scope warning', async () => {
  const home = join(directory, 'codex-home');
  await mkdir(home);
  const protectedPath = join(home, 'protected.txt');
  await writeFile(protectedPath, 'Protected preview fixture');
  const parent = await service.addProject(directory);
  const nested = join(directory, 'project');
  await mkdir(nested);
  const otherProject = await service.addProject(nested);
  const browse = (kind: string, path: string, projectId: string) =>
    origin +
    '/api/file-browser?' +
    new URLSearchParams({ kind, path, projectId, showHidden: 'true' });
  const protectedUrl = browse('file', 'codex-home/protected.txt', parent.id);
  const headers = { cookie };
  expect((await fetch(protectedUrl)).status).toBe(401);
  const oldFile =
    origin + '/api/projects/' + parent.id + '/file?path=codex-home/protected.txt&showHidden=true';
  expect((await fetch(oldFile, { headers })).status).toBe(403);
  expect(await (await fetch(protectedUrl, { headers })).json()).toMatchObject({
    outsideScope: true,
    value: { text: 'Protected preview fixture' },
  });
  expect(
    await (await fetch(browse('file', protectedPath, otherProject.id), { headers })).json(),
  ).toMatchObject({
    outsideScope: true,
    value: { text: 'Protected preview fixture' },
  });
  expect(
    await (await fetch(browse('directory', home, otherProject.id), { headers })).json(),
  ).toMatchObject({
    outsideScope: true,
    value: [{ name: 'protected.txt', path: protectedPath, directory: false }],
  });
  const alias = join(nested, 'linked-directory');
  await symlink(home, alias);
  expect(
    await (await fetch(browse('location', alias, otherProject.id), { headers })).json(),
  ).toEqual({
    outsideScope: true,
    value: { directory: true, path: alias },
  });
  const normal = join(nested, 'normal.txt');
  await writeFile(normal, 'Project preview fixture');
  expect(
    await (await fetch(browse('file', normal, otherProject.id), { headers })).json(),
  ).toMatchObject({
    outsideScope: false,
    value: { path: 'normal.txt', text: 'Project preview fixture' },
  });
  const v = '/api/projects/' + otherProject.id + '/file?path=' + encodeURIComponent(protectedPath);
  expect((await fetch(origin + v, { headers })).status).toBe(403);
});
it('edits the active global instruction file in the server Codex home', async () => {
  const home = join(directory, 'codex-home');
  const url = origin + '/api/settings/codex-instructions';
  const project = await service.addProject(directory);
  const projectInstructions = join(directory, 'AGENTS.md');
  await writeFile(projectInstructions, '# Project instructions');
  const base = join(home, 'AGENTS.md');
  const override = join(home, 'AGENTS.override.md');
  const read = () => fetch(url, { headers: { cookie } });
  const save = (value: unknown, session = cookie, requestOrigin = origin) =>
    fetch(url, {
      method: 'PUT',
      headers: { origin: requestOrigin, cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });

  expect((await fetch(url)).status).toBe(401);
  const initial = { filename: 'AGENTS.md', revision: null, text: '' };
  expect(await (await read()).json()).toEqual(initial);
  expect((await save(initial, '')).status).toBe(401);
  expect((await save(initial, cookie, 'https://example.test')).status).toBe(403);
  expect((await save({ ...initial, filename: '../AGENTS.md' })).status).toBe(400);
  const written = await save({ ...initial, text: '# Global instructions' });
  expect(written.status).toBe(200);
  const standard = await written.json();
  expect(await readFile(base, 'utf8')).toBe('# Global instructions');
  expect(await readFile(projectInstructions, 'utf8')).toBe('# Project instructions');
  await expect(service.file(project.id, 'codex-home/AGENTS.md', true)).rejects.toMatchObject({
    code: 'PATH_DENIED',
  });

  await writeFile(override, standard.text);
  const overriding = await (await read()).json();
  expect(overriding).toEqual({ ...standard, filename: 'AGENTS.override.md' });
  expect((await save({ ...standard, text: 'Stale target' })).status).toBe(409);
  const editedOverride = await save({ ...overriding, text: '# Global override' });
  expect(editedOverride.status).toBe(200);
  expect(await readFile(override, 'utf8')).toBe('# Global override');
  expect(await readFile(base, 'utf8')).toBe('# Global instructions');

  const cleared = await save({ ...(await editedOverride.json()), text: '' });
  expect(await cleared.json()).toEqual(standard);
  expect(await readFile(override, 'utf8')).toBe('');
  expect(await (await read()).json()).toEqual(standard);
  await rm(base);
  await symlink(projectInstructions, base);
  expect((await read()).status).toBe(403);
  expect((await save({ ...standard, text: 'Would replace symlink' })).status).toBe(403);
  expect(await readFile(projectInstructions, 'utf8')).toBe('# Project instructions');
});
it('authenticates and validates native configuration writes and rejects stale versions', async () => {
  const project = await service.addProject(directory);
  const path = '/api/projects/' + project.id + '/codex-configuration';
  const put = (value: unknown, session = cookie) =>
    fetch(origin + path, {
      method: 'PUT',
      headers: { origin, cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
  const read = async () => (await fetch(origin + path, { headers: { cookie } })).json();
  const before = await read();
  const input = {
    version: before.userVersion,
    changes: { model_reasoning_effort: 'high', service_tier: 'fast' },
  };
  expect((await put(input, '')).status).toBe(401);
  expect((await put({ ...input, filePath: '/private-fixture' })).status).toBe(400);
  expect(
    (
      await put({
        version: before.userVersion,
        changes: { 'mcp_servers.example.env.TOKEN': 'fixture' },
      })
    ).status,
  ).toBe(400);
  expect((await put(input)).status).toBe(200);
  expect(await read()).toMatchObject({ effort: 'high', fast: true });
  expect((await put(input)).status).toBe(409);
  expect(service.store.db.prepare('SELECT count(*) AS count FROM operations').get()).toMatchObject({
    count: 0,
  });
});

it('keeps legacy settings readable and refuses writes to retired preference routes', async () => {
  const project = await service.addProject(directory);
  const thread = await service.create(project.id, { permission: 'read-only' });
  const path = origin + '/api/threads/' + thread.id + '/settings';
  const response = await fetch(path, {
    method: 'PUT',
    headers: { origin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ revision: 0, settings: { permission: 'workspace-write' } }),
  });
  expect(response.status).toBe(410);
  expect(await (await fetch(path, { headers: { cookie } })).json()).toMatchObject({
    settings: { permission: 'read-only' },
  });
});
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codes-http-'));
  vi.stubEnv('CODEX_HOME', join(directory, 'codex-home'));
  service = new Service(
    new Store(directory),
    new Driver('mock', { stateFile: join(directory, 'history.json') }),
  );
  // Reserve an ephemeral port, then create the application with its exact trusted origin.
  const { createServer } = await import('node:net');
  const reserve = createServer();
  await new Promise<void>((yes) => reserve.listen(0, '127.0.0.1', yes));
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>((yes) => reserve.close(() => yes()));
  origin = `http://127.0.0.1:${port}`;
  const network = new NetworkConfiguration(directory, { CODES_PORT: String(port) });
  await writeFile(join(directory, 'access-token'), token + '\n', { mode: 0o600 });
  app = await application(service, {
    network,
    token: new AccessToken(directory),
    staticDir: join(directory, 'dist', 'web'),
  });
  await new Promise<void>((yes) => app.server.listen(port, '127.0.0.1', yes));
  const login = await fetch(origin + '/api/login', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  cookie = login.headers.get('set-cookie')!.split(';')[0]!;
});
afterEach(async () => {
  await app?.close();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
it('protects APIs with an HttpOnly session rather than a URL token', async () => {
  expect((await fetch(origin + '/api/system')).status).toBe(401);
  const response = await fetch(origin + '/api/login', {
    method: 'POST',
    headers: { origin },
    body: JSON.stringify({ token }),
  });
  expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
  expect((await fetch(origin + '/api/system', { headers: { cookie } })).status).toBe(200);
});
it('rejects cross-origin mutations and untrusted Host headers', async () => {
  expect(
    (
      await fetch(origin + '/api/projects', {
        method: 'POST',
        headers: { cookie, origin: 'https://attacker.example' },
        body: JSON.stringify({ path: directory }),
      })
    ).status,
  ).toBe(403);
  const status = await new Promise<number | undefined>((yes, no) => {
    const req = httpRequest(
      origin + '/api/system',
      { headers: { cookie, host: 'attacker.example' } },
      (res) => {
        res.resume();
        yes(res.statusCode);
      },
    );
    req.on('error', no);
    req.end();
  });
  expect(status).toBe(403);
});
it('accepts reset redemption only with a trusted origin, session and issued-key shape', async () => {
  const redeem = vi.spyOn(service.codexUsage, 'redeem').mockResolvedValue({
    outcome: 'noCredit',
    usage: { limits: { status: 'unavailable' }, activity: { status: 'unavailable' } },
  });
  const key = 'bceda480-e8c9-4eef-8964-29566fd3bb03';
  const reset = (value: string, headers: Record<string, string>) =>
    fetch(origin + '/api/connection/codex/usage/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ key: value }),
    });
  expect((await reset(key, { cookie, origin: 'https://untrusted.example' })).status).toBe(403);
  expect((await reset(key, { origin })).status).toBe(401);
  expect((await reset('invalid', { origin, cookie })).status).toBe(400);
  service.startMaintenance();
  expect((await reset(key, { origin, cookie })).status).toBe(503);
  service.cancelMaintenance();
  expect(redeem).not.toHaveBeenCalled();
  const response = await reset(key, { origin, cookie });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ outcome: 'noCredit' });
  expect(redeem).toHaveBeenCalledExactlyOnceWith(key);
});
it('protects and validates pending network settings without changing the running listener', async () => {
  const path = origin + '/api/settings/network';
  const active = (await (await fetch(path, { headers: { cookie } })).json()).settings;
  const put = (settings: unknown, headers: Record<string, string> = {}, revision = 0) =>
    fetch(path, {
      method: 'PUT',
      headers: { cookie, origin, 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ revision, settings }),
    });
  expect((await fetch(path)).status).toBe(401);
  expect((await put(active, { cookie: '' })).status).toBe(401);
  const otherAllowedOrigin = origin.replace('127.0.0.1', 'localhost');
  expect(active.origins).toContain(otherAllowedOrigin);
  expect((await put(active, { origin: otherAllowedOrigin })).status).toBe(403);
  for (const invalid of [
    { host: '0.0.0.0' },
    { port: 0 },
    { port: 65536 },
    { authMode: 'cloudflare' },
    ...[
      'https://example.test/path',
      'https://example.test?',
      'https://example.test#',
      'https://test@example.test',
      'https://*.example.test',
      'ftp://example.test',
    ].map((address) => ({ origins: [address] })),
  ])
    expect((await put({ ...active, ...invalid })).status).toBe(400);
  const next = {
    ...active,
    host: '::1',
    port: 8787,
    origins: ['https://codes.example.test/', 'https://codes.example.test:443'],
  };
  const updated = await put(next);
  expect(updated.status).toBe(200);
  expect(await updated.json()).toEqual({
    revision: 1,
    active,
    settings: { ...next, origins: ['https://codes.example.test'] },
    restartRequired: true,
  });
  expect((await put(active)).status).toBe(409);
  const canceled = await put(active, {}, 1);
  expect(await canceled.json()).toMatchObject({ revision: 2, restartRequired: false });
});
it('revokes a signed-out session even if its cookie is replayed', async () => {
  expect(
    (
      await fetch(origin + '/api/logout', {
        method: 'POST',
        headers: { cookie, origin },
        body: '{}',
      })
    ).status,
  ).toBe(200);
  expect((await fetch(origin + '/api/system', { headers: { cookie } })).status).toBe(401);
});
it('limits login attempts and oversized bodies', async () => {
  for (let i = 0; i < 5; i++)
    await fetch(origin + '/api/login', {
      method: 'POST',
      headers: { origin },
      body: JSON.stringify({ token: 'wrong' }),
    });
  expect(
    (
      await fetch(origin + '/api/login', {
        method: 'POST',
        headers: { origin },
        body: JSON.stringify({ token }),
      })
    ).status,
  ).toBe(429);
  expect(
    (
      await fetch(origin + '/api/projects', {
        method: 'POST',
        headers: { origin, cookie },
        body: JSON.stringify({ path: 'x'.repeat(270_000) }),
      })
    ).status,
  ).toBe(413);
});
it('keeps simulator seeding unavailable in the normal application', async () => {
  const added = await fetch(origin + '/api/projects', {
    method: 'POST',
    headers: { origin, cookie },
    body: JSON.stringify({ path: directory }),
  });
  const project = (await added.json()) as { id: string };
  expect(
    (
      await fetch(`${origin}/api/projects/${project.id}/seed`, {
        method: 'POST',
        headers: { origin, cookie },
        body: '{}',
      })
    ).status,
  ).toBe(404);
});

it('archives and restores an empty project through an authenticated, repeatable API', async () => {
  const project = await service.addProject(directory);
  const path = origin + '/api/projects/' + project.id + '/archive';
  const put = (archived: unknown, session = cookie, url = path) =>
    fetch(url, {
      method: 'PUT',
      headers: { origin, cookie: session },
      body: JSON.stringify({ archived }),
    });
  expect((await put(true, '')).status).toBe(401);
  expect((await put('true')).status).toBe(400);
  expect((await put(true, cookie, origin + '/api/projects/missing/archive')).status).toBe(404);
  const read = async () =>
    (await (await fetch(origin + '/api/projects', { headers: { cookie } })).json())[0];
  expect(await (await put(true)).json()).toEqual({ id: project.id, archived: true });
  expect(await (await put(true)).json()).toEqual({ id: project.id, archived: true });
  expect(await read()).toEqual({ ...project, archived: true, latestConversationAt: 0 });
  expect(await service.addProject(directory)).toEqual({ ...project, archived: true });
  expect(await (await put(false)).json()).toEqual({ id: project.id, archived: false });
  expect(await read()).toEqual({ ...project, latestConversationAt: 0 });
});

it('validates conversation mutations and exposes only the native-shaped management API', async () => {
  async function post(path: string, body: unknown) {
    return fetch(origin + '/api' + path, {
      method: 'POST',
      headers: { origin, cookie },
      body: JSON.stringify(body),
    });
  }
  const project = (await (await post('/projects', { path: directory })).json()) as { id: string };
  const thread = (await (
    await post('/projects/' + project.id + '/threads', { permission: 'read-only' })
  ).json()) as { id: string };
  const { randomUUID } = await import('node:crypto');
  for (const name of ['', ' '.repeat(2), 'x'.repeat(81)])
    expect(
      (await post('/threads/' + thread.id + '/rename', { operationId: randomUUID(), name })).status,
    ).toBe(400);
  expect(
    (
      await post('/threads/' + thread.id + '/rename', {
        operationId: randomUUID(),
        name: '  API title  ',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await post('/threads/' + thread.id + '/archive', {
        operationId: randomUUID(),
        archived: 'true',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await fetch(origin + '/api/projects/' + project.id + '/conversations?archived=wrong', {
        headers: { cookie },
      })
    ).status,
  ).toBe(400);
  expect(
    (await post('/projects/' + project.id + '/seed-conversations', { count: 250 })).status,
  ).toBe(404);
  const page = (await (
    await fetch(origin + '/api/projects/' + project.id + '/conversations?search=api', {
      headers: { cookie },
    })
  ).json()) as { data: { title: string }[] };
  expect(page.data.map((row) => row.title)).toEqual(['API title']);
});

it('returns bounded queue previews and the full owned message for editing', async () => {
  const { randomUUID } = await import('node:crypto');
  const mutate = async (path: string, value: unknown, method = 'POST') =>
    fetch(origin + '/api' + path, {
      method,
      headers: { origin, cookie },
      body: JSON.stringify(value),
    });
  const project = (await (await mutate('/projects', { path: directory })).json()) as { id: string };
  const thread = (await (
    await mutate('/projects/' + project.id + '/threads', { permission: 'read-only' })
  ).json()) as { id: string };
  await mutate('/threads/' + thread.id + '/queue/control', { paused: true });
  const id = randomUUID(),
    text = 'long private fixture ' + 'x'.repeat(5000);
  const added = (await (
    await mutate('/threads/' + thread.id + '/queue', {
      operationId: id,
      text,
      settings: { permission: 'read-only' },
      attachments: [],
    })
  ).json()) as { items: { text: string; textTruncated: boolean }[] };
  expect(added.items[0]).toMatchObject({ textTruncated: true });
  expect(added.items[0]!.text.length).toBe(2000);
  const full = (await (
    await fetch(origin + '/api/threads/' + thread.id + '/queue/' + id, { headers: { cookie } })
  ).json()) as { text: string; state: string };
  expect(full).toMatchObject({ text, state: 'queued' });
  expect(
    (await mutate('/threads/' + thread.id + '/queue/' + id, { text: 'Edited' }, 'PATCH')).status,
  ).toBe(200);
  expect(
    (
      await mutate('/threads/' + thread.id + '/fork', {
        operationId: randomUUID(),
        lastTurnId: false,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await fetch(origin + '/api/threads/' + thread.id + '/queue/' + randomUUID(), {
        headers: { cookie },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await fetch(origin + '/api/threads/' + thread.id + '/queue/' + id, {
        method: 'DELETE',
        headers: { cookie, origin },
      })
    ).status,
  ).toBe(200);
});

it('validates native steering/review inputs and publishes bounded reasoning metadata', async () => {
  const { randomUUID } = await import('node:crypto');
  const mutate = async (path: string, value: unknown) =>
    fetch(origin + '/api' + path, {
      method: 'POST',
      headers: { origin, cookie },
      body: JSON.stringify(value),
    });
  const project = (await (await mutate('/projects', { path: directory })).json()) as { id: string };
  const thread = (await (
    await mutate('/projects/' + project.id + '/threads', { permission: 'read-only' })
  ).json()) as { id: string };
  const path = '/threads/' + thread.id;
  expect(
    (await mutate(path + '/steer', { operationId: randomUUID(), text: 'Missing turn' })).status,
  ).toBe(400);
  expect(
    (
      await mutate(path + '/steer', {
        operationId: randomUUID(),
        text: 'Stale turn',
        expectedTurnId: 'stale',
      })
    ).status,
  ).toBe(409);
  for (const target of [
    { type: 'baseBranch', branch: ' ' },
    { type: 'commit', sha: 'main;command' },
    { type: 'custom', instructions: '' },
    { type: 'uncommittedChanges', arbitrary: true },
  ])
    expect(
      (
        await mutate(path + '/review', {
          operationId: randomUUID(),
          target,
          settings: { permission: 'read-only' },
        })
      ).status,
    ).toBe(400);
  expect(
    (
      await mutate(path + '/review', {
        operationId: randomUUID(),
        target: { type: 'uncommittedChanges' },
        settings: { permission: 'read-only' },
        delivery: 'detached',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await mutate(path + '/send', {
        operationId: randomUUID(),
        text: 'Invalid mode',
        settings: { permission: 'read-only', mode: 'invented' },
      })
    ).status,
  ).toBe(400);
  const models = await (await fetch(origin + '/api/models', { headers: { cookie } })).json();
  expect(models[0]).toMatchObject({
    model: 'simulated-model',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low' },
      { reasoningEffort: 'medium' },
      { reasoningEffort: 'high' },
    ],
  });
  expect(Object.keys(models[0])).toEqual([
    'id',
    'model',
    'displayName',
    'isDefault',
    'defaultReasoningEffort',
    'supportedReasoningEfforts',
    'supportsImages',
    'supportsFast',
  ]);
  const modes = await (await fetch(origin + '/api/modes', { headers: { cookie } })).json();
  expect(modes.map((entry: { mode: string }) => entry.mode)).toEqual(['default', 'plan']);
});

function rawJson(path: string, acceptEncoding: string) {
  return new Promise<{ headers: IncomingHttpHeaders; bytes: Buffer }>((yes, no) => {
    const req = httpRequest(
      origin + path,
      { headers: { cookie, 'accept-encoding': acceptEncoding } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => yes({ headers: response.headers, bytes: Buffer.concat(chunks) }));
        response.on('error', no);
      },
    );
    req.on('error', no);
    req.end();
  });
}
it('compresses large JSON without changing history, declares its wire length, and respects encoding refusal', async () => {
  const project = await service.addProject(directory);
  const thread = await service.create(project.id, { permission: 'read-only' });
  const text = 'Synthetic history: 你好🙂 '.repeat(4000);
  vi.spyOn(service, 'read').mockResolvedValue({
    ...thread,
    messages: [{ id: 'fixture', turnId: 'turn', kind: 'assistant', text }],
  });
  const path = '/api/threads/' + thread.id + '/snapshot';
  const plain = await rawJson(path, 'identity');
  const compressed = await rawJson(path, 'br, gzip;q=0.8');
  expect(compressed.headers['content-encoding']).toBe('gzip');
  expect(compressed.headers['content-length']).toBe(String(compressed.bytes.length));
  expect(compressed.headers['transfer-encoding']).toBeUndefined();
  expect(compressed.headers.vary).toBe('Accept-Encoding');
  expect(compressed.headers['cache-control']).toBe('no-store');
  expect(compressed.bytes.length).toBeLessThan(plain.bytes.length / 2);
  expect(JSON.parse(gunzipSync(compressed.bytes).toString()).thread.messages[0].text).toBe(text);
  for (const encoding of ['gzip;q=0, *;q=1', 'identity', 'gzip;q=invalid']) {
    const declined = await rawJson(path, encoding);
    expect(declined.headers['content-encoding']).toBeUndefined();
    expect(declined.headers['content-length']).toBe(String(declined.bytes.length));
    expect(JSON.parse(declined.bytes.toString()).thread.messages[0].text).toBe(text);
  }
  const wildcard = await rawJson(path, '*;q=1');
  expect(wildcard.headers['content-encoding']).toBe('gzip');
});
it('sends small JSON with an exact length without introducing a compressed stream', async () => {
  const result = await rawJson('/api/system', 'gzip');
  expect(result.headers['content-encoding']).toBeUndefined();
  expect(result.headers['content-length']).toBe(String(result.bytes.length));
  expect(JSON.parse(result.bytes.toString()).runtime).toBe('mock');
});

it('serves only validated images inside the authenticated project scope', async () => {
  const { imagePng } = await import('./fixtures/image');
  const work = join(directory, 'project');
  await mkdir(work);
  const imageBytes = Buffer.concat([imagePng, Buffer.alloc(600_000)]);
  await writeFile(join(work, 'plot.png'), imageBytes);
  await writeFile(join(work, '.plot.png'), imagePng);
  await writeFile(join(work, 'wrong.jpg'), imagePng);
  await writeFile(join(work, 'not-an-image.png'), '<html>invalid image</html>');
  await writeFile(join(directory, 'outside.png'), imagePng);
  await symlink(join(directory, 'outside.png'), join(work, 'escape.png'));
  const project = await service.addProject(work);
  const read = (path: string, session = cookie, showHidden = false) =>
    fetch(
      origin +
        '/api/projects/' +
        project.id +
        '/image-preview?path=' +
        encodeURIComponent(path) +
        (showHidden ? '&showHidden=true' : ''),
      {
        headers: { cookie: session },
      },
    );
  expect((await read('plot.png', '')).status).toBe(401);
  const image = await read('plot.png');
  expect(image.status).toBe(200);
  expect(image.headers.get('content-type')).toBe('image/png');
  expect(image.headers.get('cache-control')).toBe('private,no-store');
  expect(Buffer.from(await image.arrayBuffer())).toEqual(imageBytes);
  expect((await read('../outside.png')).status).toBe(403);
  expect((await read('escape.png')).status).toBe(403);
  expect((await read('.plot.png')).status).toBe(403);
  expect((await read('.plot.png', '')).status).toBe(401);
  expect((await read('.plot.png', cookie, true)).status).toBe(200);
  expect((await read('escape.png', cookie, true)).status).toBe(403);
  expect((await read('wrong.jpg')).status).toBe(415);
  expect((await read('not-an-image.png')).status).toBe(400);
});

it('serves authenticated Word and PDF previews without treating the originals as UTF-8', async () => {
  const workspace = join(directory, 'document-project');
  await mkdir(workspace);
  await writeFile(join(workspace, 'plan.docx'), sampleDocx);
  await writeFile(join(workspace, 'layout.pdf'), samplePdf());
  await writeFile(join(workspace, 'invalid.pdf'), '<script>not a PDF</script>');
  await writeFile(join(workspace, 'invalid.doc'), 'not a Word file');
  const oversizedWord = join(workspace, 'oversized.docx');
  const oversizedPdf = join(workspace, 'oversized.pdf');
  await writeFile(oversizedWord, sampleDocx);
  await writeFile(oversizedPdf, samplePdf());
  await truncate(oversizedWord, 8 * 1024 * 1024 + 1);
  await truncate(oversizedPdf, 32 * 1024 * 1024 + 1);
  const project = await service.addProject(workspace);
  const read = (kind: 'document' | 'pdf', path: string, session = cookie, version?: string) =>
    fetch(
      origin +
        '/api/file-browser?' +
        new URLSearchParams({ kind, projectId: project.id, path, ...(version ? { version } : {}) }),
      {
        headers: { cookie: session },
      },
    );
  expect((await read('document', 'plan.docx', '')).status).toBe(401);
  const word = await read('document', 'plan.docx');
  expect(word.status).toBe(200);
  const document = await word.json();
  expect(document).toEqual({
    value: {
      format: 'word',
      text: expect.stringContaining('Quarterly plan preview'),
      truncated: false,
      version: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
    outsideScope: false,
  });
  await expect(
    (await read('document', 'plan.docx', cookie, document.value.version)).json(),
  ).resolves.toEqual({
    value: { format: 'unchanged', version: document.value.version },
    outsideScope: false,
  });
  await writeFile(join(workspace, 'plan.docx'), 'changed to a malformed document');
  expect((await read('document', 'plan.docx', cookie, document.value.version)).status).toBe(422);
  expect((await read('document', 'invalid.doc')).status).toBe(422);
  expect((await read('document', 'oversized.docx')).status).toBe(413);
  expect((await read('pdf', 'oversized.pdf')).status).toBe(413);
  const outside = await read('document', join(workspace, 'layout.pdf'));
  expect(await outside.json()).toEqual({ value: { format: 'pdf' }, outsideScope: false });
  const pdf = await read('pdf', 'layout.pdf');
  expect(pdf.status).toBe(200);
  expect(pdf.headers.get('content-type')).toBe('application/pdf');
  expect(pdf.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  expect(pdf.headers.get('content-disposition')).toContain('layout.pdf');
  expect(Buffer.from(await pdf.arrayBuffer())).toEqual(samplePdf());
  expect((await read('pdf', 'plan.docx')).status).toBe(415);
  expect((await read('pdf', 'invalid.pdf')).status).toBe(415);
});

it('previews named raster images across workspace paths without exposing private data folders', async () => {
  const { imagePng } = await import('./fixtures/image');
  const external = await mkdtemp(join(tmpdir(), 'codes-preview-outside-project-'));
  const read = (path: string, session = cookie) =>
    fetch(origin + '/api/image-preview?path=' + encodeURIComponent(path), {
      headers: { cookie: session },
    });
  try {
    const outside = join(external, 'outside.png');
    const exportPath = join(directory, 'export.png');
    const privatePath = join(directory, 'backup', 'capture.png');
    await mkdir(join(directory, 'backup'));
    for (const path of [outside, exportPath, privatePath]) await writeFile(path, imagePng);
    await symlink(privatePath, join(external, 'alias.png'));
    expect((await read(outside, '')).status).toBe(401);
    for (const path of [outside, exportPath]) {
      const result = await read(path);
      expect(result.status).toBe(200);
      expect(result.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await result.arrayBuffer())).toEqual(imagePng);
    }
    expect((await read(privatePath)).status).toBe(403);
    expect((await read(join(external, 'alias.png'))).status).toBe(403);
    expect((await read('outside.png')).status).toBe(403);
    expect((await read(join(external, 'missing.png'))).status).toBe(404);
    await writeFile(join(external, 'notes.txt'), 'ordinary file');
    expect((await read(join(external, 'notes.txt'))).status).toBe(415);
  } finally {
    await rm(external, { recursive: true, force: true });
  }
});

it('saves project uploads without overwrite and streams downloads', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'codes-managed-files-'));
  try {
    const project = await service.addProject(workspace);
    const api = origin + '/api/projects/' + project.id + '/file-management';
    const headers = { origin, cookie };
    const put = (contents: string) =>
      fetch(api + '/upload?path=reports&name=large.log', {
        method: 'POST',
        headers,
        body: contents,
      });
    expect(
      (
        await fetch(api + '/directory', {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'reports' }),
        })
      ).status,
    ).toBe(201);
    const data = 'sample\n'.repeat(50_000);
    const responses = await Promise.all([put(data), put('concurrent content')]);
    expect(responses.map((item) => item.status).sort()).toEqual([201, 409]);
    const saved = await readFile(join(workspace, 'reports', 'large.log'), 'utf8');
    expect(saved).toBe(responses[0]!.status === 201 ? data : 'concurrent content');
    const download = await fetch(api + '/download?path=reports%2Flarge.log', { headers });
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment;');
    expect(await download.text()).toBe(saved);

    await symlink(directory, join(workspace, 'external'));
    expect(
      (
        await fetch(api + '/upload?path=external&name=blocked.txt', {
          method: 'POST',
          headers,
          body: 'blocked',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(api + '/upload?name=.git&showHidden=true', {
          method: 'POST',
          headers,
          body: 'blocked',
        })
      ).status,
    ).toBe(403);
    const stopped = async function* () {
      yield Buffer.from('partial');
      throw new Error('Upload interrupted');
    };
    await expect(
      service.fileManagement.upload(
        project.id,
        'reports',
        'partial.log',
        false,
        stopped(),
        () => true,
      ),
    ).rejects.toThrow('Upload interrupted');
    expect(await readdir(join(workspace, 'reports'))).toEqual(['large.log']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

it('saves composer documents in the project with a version and preserves both uploads on collision', async () => {
  const testRoot = await mkdtemp(join(tmpdir(), 'codes-composer-attachment-test-'));
  try {
    const workspace = join(testRoot, 'attachments-project');
    await mkdir(workspace);
    const project = await service.addProject(workspace);
    const api = origin + '/api/projects/' + project.id + '/file-management';
    const attach = (content: Uint8Array<ArrayBuffer>, name: string, session = cookie) =>
      fetch(api + '/attach?' + new URLSearchParams({ name }), {
        method: 'POST',
        headers: { origin, cookie: session, 'content-type': 'application/octet-stream' },
        body: content,
      });
    const firstBytes = Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0xff);
    const otherBytes = Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x00);
    expect((await attach(firstBytes, 'sample.pdf', '')).status).toBe(401);
    expect((await attach(firstBytes, '../escape.pdf')).status).toBe(403);
    const responses = await Promise.all([
      attach(firstBytes, 'sample.pdf'),
      attach(otherBytes, 'sample.pdf'),
    ]);
    expect(responses.map((item) => item.status)).toEqual([201, 201]);
    const [first, second] = await Promise.all(responses.map((item) => item.json()));
    expect(first.path).not.toEqual(second.path);
    for (const [attachment, bytes] of [
      [first, firstBytes],
      [second, otherBytes],
    ] as const) {
      expect(attachment).toEqual({
        kind: 'file-reference',
        path: expect.stringMatching(/^codes-attachments\/(?:[a-f0-9]{8}-)?sample\.pdf$/),
        version: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(await readFile(join(workspace, attachment.path))).toEqual(Buffer.from(bytes));
      const reference = await fetch(
        api + '/reference?' + new URLSearchParams({ path: attachment.path }),
        {
          headers: { cookie },
        },
      );
      expect(await reference.json()).toEqual(attachment);
    }

    const otherDirectory = join(testRoot, 'symlink-attachments-project');
    await mkdir(otherDirectory);
    await symlink(workspace, join(otherDirectory, 'codes-attachments'));
    const other = await service.addProject(otherDirectory);
    const denied = await fetch(
      origin + '/api/projects/' + other.id + '/file-management/attach?name=outside.pdf',
      { method: 'POST', headers: { origin, cookie }, body: firstBytes },
    );
    expect(denied.status).toBe(403);
    expect(await readdir(workspace)).toEqual(['codes-attachments']);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

it('paginates a managed project folder and invalidates the page when the directory changes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'codes-file-pages-'));
  try {
    const project = await service.addProject(workspace);
    const names = Array.from({ length: 205 }, (_, index) => 'entry-' + index + '.txt');
    for (const name of names) await writeFile(join(workspace, name), '');
    const first = await service.fileManagement.list(project.id, '', false, 0);
    expect(first.entries).toHaveLength(200);
    const next = first.next!;
    const last = await service.fileManagement.list(
      project.id,
      '',
      false,
      next.offset,
      next.revision,
    );
    expect(last.next).toBeUndefined();
    expect(new Set([...first.entries, ...last.entries].map((entry) => entry.name))).toEqual(
      new Set(names),
    );
    await writeFile(join(workspace, 'added.txt'), '');
    await expect(
      service.fileManagement.list(project.id, '', false, next.offset, next.revision),
    ).rejects.toMatchObject({ code: 'FILE_LIST_CHANGED' });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

it('validates local text uploads and only resolves their references in the owning project', async () => {
  const project = await service.addProject(directory);
  const upload = (body: string | Uint8Array<ArrayBuffer>, session = cookie) =>
    fetch(origin + '/api/projects/' + project.id + '/uploaded-files', {
      method: 'POST',
      headers: { origin, cookie: session, 'x-file-name': 'notes.txt' },
      body,
    });
  expect((await upload('private text', '')).status).toBe(401);
  expect((await upload(Uint8Array.of(255, 0))).status).toBe(400);
  expect((await upload('x'.repeat(65537))).status).toBe(413);
  const response = await upload('private text');
  expect(response.status).toBe(200);
  const attachment = await response.json();
  expect(attachment).toEqual({
    kind: 'uploaded-file',
    id: expect.stringMatching(/^[a-f0-9]{64}$/),
    name: 'notes.txt',
  });
  expect(await (await upload('private text')).json()).toEqual(attachment);
  const otherDirectory = join(directory, 'other');
  await mkdir(otherDirectory);
  const other = await service.addProject(otherDirectory);
  const thread = await service.create(other.id);
  const sent = await fetch(origin + '/api/threads/' + thread.id + '/send', {
    method: 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      operationId: randomUUID(),
      text: 'Read this file',
      settings: { permission: 'read-only' },
      attachments: [attachment],
    }),
  });
  expect(sent.status).toBe(404);
  expect((await sent.json()).error.code).toBe('FILE_NOT_FOUND');
});

it('uploads images separately from JSON, protects reads and dispatches image-only input by small references', async () => {
  const { imagePng } = await import('./fixtures/image');
  const project = service.store.addProject('Images', directory);
  const bytes = Buffer.concat([imagePng, Buffer.alloc(300_000)]);
  const upload = await fetch(origin + '/api/projects/' + project.id + '/images', {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'image/png', 'x-image-name': 'screenshot.png' },
    body: bytes,
  });
  expect(upload.status).toBe(200);
  const image = await upload.json();
  expect(image).toMatchObject({ kind: 'image', name: 'screenshot.png' });
  expect(JSON.stringify(image).length).toBeLessThan(250);
  const path = '/api/projects/' + project.id + '/images/' + image.id;
  expect((await fetch(origin + path)).status).toBe(401);
  const read = await fetch(origin + path, { headers: { cookie } });
  expect(read.headers.get('content-type')).toBe('image/png');
  expect(read.headers.get('cache-control')).toContain('private');
  expect(Buffer.from(await read.arrayBuffer())).toEqual(bytes);
  const other = service.store.addProject('Other images', directory + '-other');
  expect(
    (
      await fetch(origin + '/api/projects/' + other.id + '/images/' + image.id, {
        headers: { cookie },
      })
    ).status,
  ).toBe(404);
  const thread = await service.create(project.id, { permission: 'read-only' });
  const sent = await fetch(origin + '/api/threads/' + thread.id + '/send', {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      operationId: randomUUID(),
      text: '',
      settings: thread.settings,
      attachments: [image],
    }),
  });
  expect(sent.status).toBe(200);
  const snapshot = await (
    await fetch(origin + '/api/threads/' + thread.id + '/snapshot', { headers: { cookie } })
  ).json();
  expect(snapshot.thread.messages.find((row: any) => row.kind === 'user').images).toEqual([
    { kind: 'image', id: image.id, name: 'Attached image' },
  ]);
  const json = JSON.stringify(snapshot);
  expect(json).not.toContain('data:image');
  expect(snapshot.context.project.path).toBe(project.path);
  expect(json).not.toContain(join(directory, 'images'));
  expect(json.length).toBeLessThan(100_000);
  await service.driver.stop();
  const offline = await fetch(origin + '/api/threads/' + thread.id + '/snapshot', {
    headers: { cookie },
  });
  expect(offline.status).toBe(200);
  const retained = await offline.json();
  expect(retained.context.project.id).toBe(project.id);
  expect(retained.thread.messages.find((row: any) => row.kind === 'user').images).toEqual(
    snapshot.thread.messages.find((row: any) => row.kind === 'user').images,
  );
});

it('rejects fake image uploads, invalid names and oversized uploads without dispatching work', async () => {
  const { imagePng } = await import('./fixtures/image');
  const project = service.store.addProject('Images', directory);
  const path = origin + '/api/projects/' + project.id + '/images';
  const upload = (body: Buffer, type = 'image/png', name = 'capture.png') =>
    fetch(path, {
      method: 'POST',
      headers: { cookie, origin, 'content-type': type, 'x-image-name': name },
      body: new Uint8Array(body),
    });
  expect((await upload(Buffer.from('<svg/>'))).status).toBe(400);
  expect((await upload(imagePng, 'text/plain')).status).toBe(415);
  expect((await upload(imagePng, 'image/png', '%invalid')).status).toBe(400);
  expect((await upload(Buffer.alloc(8 * 1024 * 1024 + 1))).status).toBe(413);
});

it('exports a consistent authenticated database snapshot with current workspace records', async () => {
  const project = await service.addProject(directory, 'Backup fixture');
  const thread = await service.create(project.id, { permission: 'read-only' });
  const endpoint = origin + '/api/settings/backup';
  expect((await fetch(endpoint, { method: 'POST', headers: { origin } })).status).toBe(401);
  expect(
    await fetch(endpoint, {
      method: 'POST',
      headers: { origin: 'http://example.invalid', cookie },
    }),
  ).toMatchObject({ status: 403 });

  const response = await fetch(endpoint, { method: 'POST', headers: { origin, cookie } });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/vnd.sqlite3');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('content-disposition')).toMatch(
    /^attachment; filename="codes-db-\d{4}-\d{2}-\d{2}\.sqlite"$/,
  );
  const path = join(directory, 'downloaded.sqlite');
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  const { DatabaseSync } = await import('node:sqlite');
  const exported = new DatabaseSync(path, { readOnly: true });
  try {
    expect(exported.prepare('PRAGMA integrity_check').get()).toMatchObject({
      integrity_check: 'ok',
    });
    expect(exported.prepare('SELECT name FROM projects WHERE id = ?').get(project.id)).toEqual({
      name: 'Backup fixture',
    });
    expect(exported.prepare('SELECT id FROM threads WHERE id = ?').get(thread.id)).toEqual({
      id: thread.id,
    });
  } finally {
    exported.close();
  }
});

it('persists the project prefill and applies the login lifetime to new sign-ins', async () => {
  const path = origin + '/api/settings/workspace';
  const change = (input: unknown) =>
    fetch(path, {
      method: 'PATCH',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  const initialProjects = service.store.projects();
  expect(
    (await change({ field: 'defaultProjectDirectory', expected: '', value: '.' })).status,
  ).toBe(400);
  const saved = await change({ field: 'defaultProjectDirectory', expected: '', value: directory });
  expect(saved.status).toBe(200);
  expect(service.store.projects()).toEqual(initialProjects);
  expect(await (await fetch(origin + '/api/system', { headers: { cookie } })).json()).toMatchObject(
    { defaultProjectPath: directory },
  );
  expect((await change({ field: 'defaultProjectDirectory', expected: '', value: '' })).status).toBe(
    409,
  );
  expect((await change({ field: 'sessionHours', expected: 12, value: 1 })).status).toBe(200);
  const login = await fetch(origin + '/api/login', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  expect(login.headers.get('set-cookie')).toContain('Max-Age=3600');
  const short = login.headers.get('set-cookie')!.split(';')[0]!;
  const future = Date.now() + 3600_001;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(future);
  try {
    expect((await fetch(path, { headers: { cookie: short } })).status).toBe(401);
    expect((await fetch(path, { headers: { cookie } })).status).toBe(200);
  } finally {
    clock.mockRestore();
  }
});

it('expires temporary diagnostics and validates staged restores without replacing the live database', async () => {
  const headers = { cookie, origin, 'content-type': 'application/json' };
  const diagnostics = origin + '/api/settings/diagnostics';
  const activation = await fetch(diagnostics, {
    method: 'POST',
    headers,
    body: JSON.stringify({ minutes: 5 }),
  });
  const active = (await activation.json()).expiresAt;
  expect(active).toBeGreaterThan(Date.now());
  const clock = vi.spyOn(Date, 'now').mockReturnValue(active + 1);
  try {
    expect(await (await fetch(diagnostics, { headers })).json()).toMatchObject({ expiresAt: null });
  } finally {
    clock.mockRestore();
  }

  const endpoint = origin + '/api/settings/restore';
  const stage = (body: BodyInit) =>
    fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/vnd.sqlite3' },
      body,
    });
  expect((await stage('not a SQLite file')).status).toBe(400);
  expect(await (await fetch(endpoint, { headers })).json()).toEqual({ pending: null });

  const file = await fetch(origin + '/api/settings/backup', { method: 'POST', headers });
  expect(file.ok).toBe(true);
  const bytes = await file.arrayBuffer();
  await service.addProject(directory, 'Added after backup');
  const staged = await stage(bytes);
  expect(staged.status).toBe(200);
  const { pending } = await staged.json();
  expect(pending).toMatchObject({ bytes: bytes.byteLength });
  expect(service.store.projects().map((item) => item.name)).toContain('Added after backup');
  expect((await stage(bytes)).status).toBe(409);
  const removed = await fetch(endpoint, {
    method: 'DELETE',
    headers,
    body: JSON.stringify(pending),
  });
  expect(await removed.json()).toEqual({ pending: null });
});

it('requires the current token and revokes sessions and event streams after a private file update', async () => {
  const replacement = 'new-http-access-token-test-fixture';
  const endpoint = origin + '/api/settings/access-token';
  const headers = { origin, cookie, 'content-type': 'application/json' };
  const update = (current: string, value: string, requestHeaders = headers) =>
    fetch(endpoint, {
      method: 'PUT',
      headers: requestHeaders,
      body: JSON.stringify({ current, replacement: value }),
    });
  expect((await fetch(endpoint)).status).toBe(401);
  expect(await (await fetch(endpoint, { headers })).json()).toEqual({ source: 'file' });
  expect(
    (await update(token, replacement, { ...headers, origin: 'http://example.invalid' })).status,
  ).toBe(403);
  expect((await update('incorrect-test-token', replacement)).status).toBe(403);
  expect((await update(token, ' short-value')).status).toBe(400);
  expect((await update(token, token)).status).toBe(400);

  const project = await service.addProject(directory);
  const thread = await service.create(project.id, { permission: 'read-only' });
  await service.send(
    thread.id,
    randomUUID(),
    '[hold] Continue after token rotation',
    thread.settings,
  );
  const controller = new AbortController();
  try {
    const events = await fetch(
      origin +
        '/api/events?' +
        new URLSearchParams({
          projectId: project.id,
          epoch: service.events.epoch,
          after: String(service.events.seq),
        }),
      { headers: { cookie }, signal: controller.signal },
    );
    expect(events.status).toBe(200);
    const read = events.text();
    const response = await update(token, replacement);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await response.json()).toEqual({ ok: true });
    expect(await read).toContain('event: ready');
    expect(service.store.thread(thread.id)?.state).toBe('running');
    expect((await fetch(endpoint, { headers })).status).toBe(401);
    const login = (value: string) =>
      fetch(origin + '/api/login', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ token: value }),
      });
    expect((await login(token)).status).toBe(401);
    expect((await login(replacement)).status).toBe(200);
    expect(new AccessToken(directory).matches(replacement)).toBe(true);
    const { stat } = await import('node:fs/promises');
    expect((await stat(join(directory, 'access-token'))).mode & 0o777).toBe(0o600);
  } finally {
    controller.abort();
    await service.interrupt(thread.id);
  }
});

it('keeps the environment token authoritative over the file', async () => {
  const managed = new AccessToken(directory, 'environment-token-test-fixture');
  expect(managed.source).toBe('environment');
  expect(managed.matches(token)).toBe(false);
  expect(() => managed.replace('attempted-new-token-test-fixture')).toThrow(
    'The server environment manages the access token.',
  );
  expect(new AccessToken(directory).matches(token)).toBe(true);
});
