import { AccessToken } from '../src/server/access-token';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT, generateKeyPair } from 'jose';
import { expect, it } from 'vitest';
import { Driver } from '../src/codex/driver';
import { application } from '../src/server/http';
import { NetworkConfiguration } from '../src/server/network-settings';
import { Service } from '../src/server/service';
import { Store } from '../src/server/store';

it('requires verified Access on every route, binds the Codes session to its identity, and closes expired streams', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codes-access-'));
  const fixture = 'isolated-cloudflare-test-token';
  const host = 'codes.example.test';
  const origin = 'https://' + host;
  const issuer = 'https://example.cloudflareaccess.com';
  const audience = 'a'.repeat(64);
  const keys = await generateKeyPair('RS256');
  const otherKeys = await generateKeyPair('RS256');
  const saved = new NetworkConfiguration(directory, {});
  const settings = {
    ...saved.active,
    origins: [origin],
    authMode: 'cloudflare-access',
    issuer,
    audience,
  };
  let app: Awaited<ReturnType<typeof application>> | undefined;
  try {
    for (const update of [
      { issuer: 'https://example.cloudflareaccess.com.evil.test' },
      { issuer: issuer + '/arbitrary' },
      { issuer: issuer + ':444' },
      { audience: 'invalid' },
      { origins: ['http://127.0.0.1:6670', origin] },
    ]) {
      expect(() => saved.save({ revision: 0, settings: { ...settings, ...update } })).toThrow();
    }
    expect(saved.save({ revision: 0, settings })).toMatchObject({
      active: { authMode: 'local' },
      restartRequired: true,
    });
    const network = new NetworkConfiguration(directory, {});
    expect(network.snapshot()).toMatchObject({ active: settings, restartRequired: false });
    const service = new Service(
      new Store(directory),
      new Driver('mock', { stateFile: join(directory, 'history.json') }),
    );
    const project = await service.addProject(directory);
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>Isolated Codes</title>');
    app = await application(service, {
      network,
      token: new AccessToken(directory, fixture),
      staticDir: directory,
      cloudflareKey: async () => keys.publicKey,
    });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    const port = (app.server.address() as { port: number }).port;
    const send = (path: string, jwt?: string, cookie?: string, payload?: object) =>
      new Promise<IncomingMessage>((resolve, reject) => {
        const outgoing = request(
          {
            hostname: '127.0.0.1',
            port,
            path,
            method: payload ? 'POST' : 'GET',
            headers: {
              host,
              origin,
              'content-type': 'application/json',
              'cf-access-authenticated-user-email': 'fake@example.test',
              ...(jwt ? { 'cf-access-jwt-assertion': jwt } : {}),
              ...(cookie ? { cookie } : {}),
            },
          },
          resolve,
        );
        outgoing.on('error', reject);
        outgoing.end(payload && JSON.stringify(payload));
      });
    const status = async (...args: Parameters<typeof send>) => {
      const response = await send(...args);
      response.resume();
      return response.statusCode;
    };
    const jwt = (claims: Record<string, string | number> = {}, signingKey = keys.privateKey) =>
      new SignJWT({
        iss: issuer,
        sub: 'owner',
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 60,
        ...claims,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'isolated-test-key' })
        .sign(signingKey);
    const valid = await jwt();
    expect(await status('/')).toBe(401);
    expect(await status('/api/login', undefined, undefined, { token: fixture })).toBe(401);
    for (const invalid of [
      'forged',
      await jwt({ iss: 'https://wrong.cloudflareaccess.com' }),
      await jwt({ aud: 'b'.repeat(64) }),
      await jwt({ exp: 1 }),
      await jwt({ nbf: Math.floor(Date.now() / 1000) + 60 }),
      await jwt({}, otherKeys.privateKey),
    ]) {
      expect(await status('/', invalid)).toBe(401);
    }
    const index = await send('/', valid);
    expect(index.statusCode).toBe(200);
    expect(index.headers['cache-control']).toContain('no-store');
    index.resume();
    expect(await status('/api/settings/network', valid)).toBe(401);
    const login = await send('/api/login', valid, undefined, { token: fixture });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers['set-cookie']![0]!.split(';')[0]!;
    login.resume();
    expect(await status('/api/settings/network', valid, cookie)).toBe(200);
    expect(await status('/api/settings/network', undefined, cookie)).toBe(401);
    expect(await status('/api/settings/network', await jwt({ sub: 'someone-else' }), cookie)).toBe(
      401,
    );
    const short = await jwt({ exp: Date.now() / 1000 + 2 });
    const query = new URLSearchParams({
      projectId: project.id,
      after: String(service.events.seq),
      epoch: service.events.epoch,
    });
    const stream = await send('/api/events?' + query, short, cookie);
    expect(stream.statusCode).toBe(200);
    let messages = '';
    for await (const chunk of stream) messages += chunk;
    expect(messages).toContain('event: ready');
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);
