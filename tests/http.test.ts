import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import type { IncomingHttpHeaders } from 'node:http';
import { Store } from '../src/server/store';
import { Service } from '../src/server/service';
import { Driver } from '../src/codex/driver';
import { application } from '../src/server/http';
let app: Awaited<ReturnType<typeof application>>;
let directory: string;
let service: Service;
let origin: string;
let cookie: string;
const token = 'test-only-access-token-not-a-real-secret';
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codes-http-'));
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
  app = await application(service, { host: '127.0.0.1', port, origin, token });
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
