import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { serviceEnvironment, serviceInstance } from './service-control.mjs';

const execute = promisify(execFile);

function writableParent(path) {
  try {
    if (!statSync(path).isDirectory()) return false;
    accessSync(path, constants.R_OK | constants.W_OK | constants.X_OK);
    return true;
  } catch (error) {
    return error?.code === 'ENOENT' && dirname(path) !== path && writableParent(dirname(path));
  }
}

function checkListener(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, autoSelectFamily: false });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1500);
    socket.once('connect', () => finish('reachable'));
    socket.once('timeout', () => finish('timed out'));
    socket.once('error', (error) =>
      finish(error.code === 'ECONNREFUSED' ? 'no listener' : (error.code ?? 'connection failed')),
    );
  });
}

export async function doctor(root, supportedNode, built) {
  let failed = false;
  const check = (ok, label, message) => {
    if (!ok) failed = true;
    console.log(`${ok ? 'OK' : 'FAIL'}  ${label}: ${message}`);
  };
  const warn = (label, message) => console.log(`WARN  ${label}: ${message}`);
  check(process.platform === 'linux', 'Platform', process.platform);
  check(
    supportedNode,
    'Node.js',
    supportedNode ? process.version : `${process.version}. Codes requires 24.19+ in the 24.x line.`,
  );
  check(
    built,
    'Build',
    built ? 'server and web files found' : 'run npm run build from the checkout',
  );
  if (failed) return 1;

  const { dataDirectory } = await import('../dist/server/data-directory.js');
  const directory = dataDirectory(process.env, root);
  const writable = writableParent(directory);
  check(writable, 'Data directory', writable ? directory : `cannot write to ${directory}`);
  let owner;
  let env = process.env;
  try {
    owner = serviceInstance(root, directory);
    check(true, 'Service', owner ? `running (PID ${owner.pid})` : 'stopped');
  } catch (error) {
    check(false, 'Service', error.message);
  }
  if (owner) {
    try {
      env = serviceEnvironment(owner, directory);
    } catch {
      warn(
        'Startup environment',
        'using the current shell because the running environment could not be recovered',
      );
    }
  }

  const mode = env.CODES_RUNTIME ?? 'codex';
  if (mode === 'mock') {
    check(true, 'Codex CLI', 'simulator mode');
  } else if (mode === 'codex') {
    try {
      const binary = env.CODES_CODEX_BINARY ?? 'codex';
      const { stdout } = await execute(binary, ['--version'], {
        env,
        cwd: owner?.cwd ?? root,
        maxBuffer: 4096,
        timeout: 5000,
      });
      const version = /^codex(?:-cli)?\s+(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?)$/.exec(
        stdout.trim(),
      )?.[1];
      check(
        !!version,
        'Codex CLI',
        version ?? 'the configured executable did not report a Codex version',
      );
    } catch (error) {
      check(
        false,
        'Codex CLI',
        error.code === 'ENOENT'
          ? 'executable not found. Check PATH or CODES_CODEX_BINARY.'
          : 'could not run the configured executable with --version',
      );
    }
  } else check(false, 'Runtime', 'CODES_RUNTIME must be codex or mock');

  const { RuntimeConfiguration } = await import('../dist/server/runtime-settings.js');
  try {
    const runtime = new RuntimeConfiguration(directory, env);
    check(true, 'Runtime settings', `native request timeout ${runtime.active.requestTimeoutMs} ms`);
  } catch {
    check(
      false,
      'Runtime settings',
      'check runtime-settings.json or CODES_CODEX_REQUEST_TIMEOUT_MS',
    );
  }

  const { NetworkConfiguration } = await import('../dist/server/network-settings.js');
  try {
    const { host, port } = new NetworkConfiguration(directory, env).active;
    const address = `${host === '::1' ? '[::1]' : host}:${port}`;
    const listener = await checkListener(host, port);
    if (owner && listener !== 'reachable')
      warn('Configured listener', `${address} (${listener}). Check for settings awaiting restart.`);
    else
      check(
        listener === (owner ? 'reachable' : 'no listener'),
        'Configured listener',
        !owner && listener === 'reachable' ? `${address} is in use` : `${address} (${listener})`,
      );
  } catch {
    check(false, 'Network settings', 'check network-settings.json or the listener environment');
  }
  return failed ? 1 : 0;
}
