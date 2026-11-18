import { test, expect } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'exit');
  child.kill('SIGINT');
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await closed;
  } finally {
    clearTimeout(deadline);
  }
}

for (const relativeData of [false, true]) {
  test(`installed command starts outside checkout with ${relativeData ? 'relative' : 'default'} data and stops cleanly`, async ({
    playwright,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), 'codes-command-'));
    const checkout = join(directory, "checkout 'with spaces'");
    const caller = join(directory, 'caller');
    const commandDir = join(directory, 'commands');
    const command = join(commandDir, 'codes');
    let child: ChildProcess | undefined;
    try {
      await mkdir(join(checkout, 'bin'), { recursive: true });
      await mkdir(join(checkout, 'scripts'));
      await mkdir(caller);
      await copyFile('bin/codes.mjs', join(checkout, 'bin/codes.mjs'));
      await copyFile('scripts/install-command.mjs', join(checkout, 'scripts/install-command.mjs'));
      await symlink(resolve('dist'), join(checkout, 'dist'));
      const environment = { ...process.env, CODES_BIN_DIR: commandDir };
      const install = () =>
        spawnSync(process.execPath, [join(checkout, 'scripts/install-command.mjs')], {
          env: environment,
          encoding: 'utf8',
        });
      expect(install().status).toBe(0);
      expect(install().status).toBe(0);
      const help = spawnSync(command, ['--help'], {
        cwd: caller,
        env: { ...environment, PATH: '/unused' },
        encoding: 'utf8',
      });
      expect(help.status).toBe(0);
      expect(help.stdout).toContain('6670');
      expect(spawnSync(command, ['--unknown'], { encoding: 'utf8' }).status).toBe(1);

      const listener = createServer();
      listener.listen(0, '127.0.0.1');
      await once(listener, 'listening');
      const port = (listener.address() as { port: number }).port;
      await new Promise<void>((yes) => listener.close(() => yes()));
      const origin = `http://127.0.0.1:${port}`;
      const env = {
        ...environment,
        PATH: '/unused',
        CODES_RUNTIME: 'mock',
        CODES_DATA_DIR: relativeData ? 'private/state' : '',
        CODES_PROJECT_ROOT: '.',
        CODES_HOST: '127.0.0.1',
        CODES_PORT: String(port),
        CODES_PUBLIC_ORIGIN: origin,
        CODES_ACCESS_TOKEN: 'test-only-command-token-not-a-real-secret',
      };
      // Leave the variable absent to exercise the default data directory.
      if (!relativeData) delete (env as Partial<typeof env>).CODES_DATA_DIR;
      let output = '';
      child = spawn(command, [], { cwd: caller, env });
      child.stdout?.on('data', (chunk) => (output += chunk));
      child.stderr?.on('data', (chunk) => (output += chunk));
      await expect.poll(() => output, { timeout: 10000 }).toContain('codes is ready');
      const client = await playwright.request.newContext({ baseURL: origin });
      try {
        expect((await client.get('/')).status()).toBe(200);
        expect(
          (
            await client.post('/api/login', {
              data: { token: env.CODES_ACCESS_TOKEN },
              headers: { Origin: origin },
            })
          ).status(),
        ).toBe(200);
        const projects = await (await client.get('/api/projects')).json();
        expect(projects).toEqual([expect.objectContaining({ path: caller })]);
        const data = relativeData ? join(caller, 'private/state') : join(checkout, '.local');
        expect(await readFile(join(data, 'server.lock'), 'utf8')).toBe(String(child.pid));
        const duplicate = spawnSync(command, [], { cwd: caller, env, encoding: 'utf8' });
        expect(duplicate.status).toBe(1);
        expect(duplicate.stderr).toContain('already in use');
        expect(duplicate.stderr).toContain('Lock owner PID: ' + child.pid);
        expect(duplicate.stderr).toContain('Data directory: ' + data);
        expect(duplicate.stderr).not.toContain('file://');
        expect(duplicate.stderr).not.toContain('at ModuleJob');
        expect((await client.get('/api/system')).status()).toBe(200);
        await stop(child);
        expect(child.exitCode).toBe(0);
        await expect(readFile(join(data, 'server.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
        // A lock held by another live process must also remain protected.
        await writeFile(join(data, 'server.lock'), String(process.pid));
        const occupied = spawnSync(command, [], { cwd: caller, env, encoding: 'utf8' });
        expect(occupied.status).toBe(1);
        expect(occupied.stderr).toContain('Lock owner PID: ' + process.pid);
        expect(await readFile(join(data, 'server.lock'), 'utf8')).toBe(String(process.pid));
      } finally {
        await client.dispose();
      }
      await writeFile(command, '#!/bin/sh\n# A different existing command\n');
      expect(install().status).toBe(1);
      expect(await readFile(command, 'utf8')).toContain('A different existing command');
    } finally {
      if (child) await stop(child);
      await rm(directory, { recursive: true, force: true });
    }
  });
}
