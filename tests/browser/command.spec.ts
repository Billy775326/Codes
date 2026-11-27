import { test, expect } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
  appendFile,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
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

for (const mode of ['default', 'legacy', 'relative'] as const) {
  const relativeData = mode === 'relative';
  test(`installed command starts outside checkout with ${mode} data and stops cleanly`, async ({
    playwright,
  }) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'codes-command-')));
    const checkout = join(directory, "checkout 'with spaces'");
    const caller = join(directory, 'caller');
    const commandDir = join(directory, 'commands');
    const command = join(commandDir, 'codes');
    let child: ChildProcess | undefined;
    try {
      await mkdir(join(checkout, 'bin'), { recursive: true });
      await mkdir(join(checkout, 'scripts'));
      await mkdir(caller);
      await cp('bin', join(checkout, 'bin'), { recursive: true });
      await copyFile('scripts/install-command.mjs', join(checkout, 'scripts/install-command.mjs'));
      await symlink(resolve('dist'), join(checkout, 'dist'));
      const xdgData = join(directory, 'xdg');
      const environment = { ...process.env, CODES_BIN_DIR: commandDir, XDG_DATA_HOME: xdgData };
      if (mode === 'legacy') {
        const legacy = join(checkout, '.local');
        await mkdir(legacy);
        await writeFile(join(legacy, 'codes.sqlite'), '', { mode: 0o600 });
      }
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
      for (const alias of ['-h', 'help']) {
        const result = spawnSync(command, [alias], {
          cwd: caller,
          env: environment,
          encoding: 'utf8',
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toBe(help.stdout);
      }
      expect(help.stdout).toContain('logs [-f]');
      expect(help.stdout).toContain('doctor');
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
      // Exercise both generated and environment-managed tokens.
      if (!relativeData) {
        delete (env as Partial<typeof env>).CODES_DATA_DIR;
        delete (env as Partial<typeof env>).CODES_ACCESS_TOKEN;
      }
      if (mode === 'default') delete (env as Partial<typeof env>).CODES_PROJECT_ROOT;
      const data = relativeData
        ? join(caller, 'private/state')
        : mode === 'legacy'
          ? join(checkout, '.local')
          : join(xdgData, 'codes');
      const tokenFile = join(data, 'access-token');
      const run = (args: string[], overrides = {}, cwd = caller) =>
        spawnSync(command, args, {
          cwd,
          env: { ...env, ...overrides },
          encoding: 'utf8',
          timeout: 20000,
        });
      const start = async () => {
        let output = '';
        const process = spawn(command, [], { cwd: caller, env });
        child = process;
        process.stdout?.on('data', (chunk) => (output += chunk));
        process.stderr?.on('data', (chunk) => (output += chunk));
        await expect.poll(() => output, { timeout: 10000 }).toContain('Simulation mode');
        return { process, output };
      };
      const first = await start();
      if (relativeData) expect(first.output).not.toContain(tokenFile);
      else expect(first.output).toContain(tokenFile);
      const token = env.CODES_ACCESS_TOKEN ?? (await readFile(tokenFile, 'utf8')).trim();
      const client = await playwright.request.newContext({ baseURL: origin });
      try {
        expect((await client.get('/')).status()).toBe(200);
        expect(
          (
            await client.post('/api/login', {
              data: { token },
              headers: { Origin: origin },
            })
          ).status(),
        ).toBe(200);
        const projects = await (await client.get('/api/projects')).json();
        expect(projects).toEqual([expect.objectContaining({ path: caller })]);
        expect(await readFile(join(data, 'server.lock'), 'utf8')).toBe(String(first.process.pid));
        const status = run(['status']);
        expect(status.status, status.stderr).toBe(0);
        expect(status.stdout).toContain('PID ' + first.process.pid);
        const doctor = run(['doctor'], { CODES_RUNTIME: 'invalid', CODES_PORT: '0' });
        expect(doctor.status, doctor.stderr || doctor.stdout).toBe(0);
        expect(doctor.stdout).toContain('Codex CLI: simulator mode');
        expect(doctor.stdout).toContain('Service: running (PID ' + first.process.pid);
        expect(doctor.stdout).toContain('Configured listener: 127.0.0.1:' + port + ' (reachable)');
        const duplicate = spawnSync(command, [], { cwd: caller, env, encoding: 'utf8' });
        expect(duplicate.status).toBe(1);
        expect(duplicate.stderr).toContain('already in use');
        expect(duplicate.stderr).toContain('Lock owner PID: ' + first.process.pid);
        expect(duplicate.stderr).toContain('Data directory: ' + data);
        expect(duplicate.stderr).not.toContain('file://');
        expect(duplicate.stderr).not.toContain('at ModuleJob');
        expect(await (await client.get('/api/system')).json()).toMatchObject({
          initialWorkingDirectory: caller,
        });
        if (mode !== 'legacy') {
          try {
            const restart = run(
              ['restart'],
              {
                CODES_DATA_DIR: data,
                CODES_PROJECT_ROOT: 'wrong-project',
                CODES_RUNTIME: 'invalid',
                CODES_PORT: '0',
              },
              checkout,
            );
            expect(restart.status, restart.stderr).toBe(0);
            expect(restart.stdout).toContain('codes is ready at ' + origin);
            expect(Number(await readFile(join(data, 'server.lock'), 'utf8'))).not.toBe(
              first.process.pid,
            );
            expect(
              (
                await client.post('/api/login', { data: { token }, headers: { Origin: origin } })
              ).status(),
            ).toBe(200);
            expect(await (await client.get('/api/projects')).json()).toEqual([
              expect.objectContaining({ path: caller }),
            ]);
            expect(await (await client.get('/api/system')).json()).toMatchObject({
              initialWorkingDirectory: caller,
            });
          } finally {
            const stopped = run(['stop']);
            expect(stopped.status, stopped.stderr).toBe(0);
          }
        } else {
          await stop(first.process);
        }
        await expect.poll(() => first.process.exitCode).toBe(0);
        expect(run(['status']).status).toBe(1);
        expect(run(['stop']).status).toBe(0);
        const restarted = await start();
        expect(restarted.output).not.toContain(tokenFile);
        await stop(restarted.process);
        expect(restarted.process.exitCode).toBe(0);
        await expect(readFile(join(data, 'server.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
        const background = run(['start']);
        try {
          expect(background.status, background.stderr).toBe(0);
          expect(background.stdout).toContain('codes is ready at ' + origin);
          expect(
            (
              await client.post('/api/login', { data: { token }, headers: { Origin: origin } })
            ).status(),
          ).toBe(200);
          expect(await (await client.get('/api/system')).json()).toMatchObject({
            initialWorkingDirectory: caller,
          });
          const pid = await readFile(join(data, 'server.lock'), 'utf8');
          expect(run(['start']).stdout).toContain('PID ' + pid);
          expect(run(['ststus']).status).toBe(0);
          const logs = run(['logs']);
          expect(logs.status, logs.stderr).toBe(0);
          expect(logs.stdout).toContain('codes is ready at ' + origin);
          if (relativeData) {
            const logFile = join(data, 'server.log');
            await appendFile(
              logFile,
              Array.from({ length: 55 }, (_, index) => `fixture-log-${index}\n`).join(''),
            );
            const recent = run(['logs']).stdout;
            expect(recent).not.toContain('fixture-log-4\n');
            expect(recent).toContain('fixture-log-5\n');
            const follower = spawn(command, ['logs', '-f'], { cwd: caller, env });
            let output = '';
            follower.stdout.on('data', (chunk) => (output += chunk));
            try {
              await expect.poll(() => output).toContain('fixture-log-54');
              await appendFile(logFile, 'fixture-follow-up\n');
              await expect.poll(() => output).toContain('fixture-follow-up');
            } finally {
              await stop(follower);
            }
            expect(run(['status']).status).toBe(0);
          }
        } finally {
          const stopped = run(['stop']);
          expect(stopped.status, stopped.stderr).toBe(0);
        }
        // A lock held by another live process must also remain protected.
        await writeFile(join(data, 'server.lock'), String(process.pid));
        const occupied = spawnSync(command, [], { cwd: caller, env, encoding: 'utf8' });
        expect(occupied.status).toBe(1);
        expect(occupied.stderr).toContain('Lock owner PID: ' + process.pid);
        expect(await readFile(join(data, 'server.lock'), 'utf8')).toBe(String(process.pid));
        const protectedStop = run(['stop']);
        expect(protectedStop.status).toBe(1);
        expect(protectedStop.stderr).toContain('Cannot verify PID');
        if (relativeData) {
          const diagnosis = run(['doctor']);
          expect(diagnosis.status).toBe(1);
          expect(diagnosis.stdout).toContain('FAIL  Service: Cannot verify PID');
        }
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
