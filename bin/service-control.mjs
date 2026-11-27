import { spawn } from 'node:child_process';
import {
  closeSync,
  fstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openServiceLog } from './service-log.mjs';

const timeout = 30_000;
const pollInterval = 100;

function missing(error) {
  return error?.code === 'ENOENT' || error?.code === 'ESRCH';
}

function readOptional(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

function processStart(pid) {
  const stat = readOptional(`/proc/${pid}/stat`);
  if (!stat) return;
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  if (fields[0] !== 'Z') return fields[19];
}

function lockOwner(directory) {
  const value = readOptional(join(directory, 'server.lock'));
  if (value === undefined) return;
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error('Invalid data directory lock. Inspect it before managing Codes.');
  return pid;
}

export function serviceInstance(root, directory) {
  const pid = lockOwner(directory);
  const started = pid && processStart(pid);
  if (!started) return;
  const proc = `/proc/${pid}`;
  const mismatch = () =>
    new Error(`Cannot verify PID ${pid} as Codes for this checkout and data directory.`);
  try {
    const [node, entry, ...args] = readFileSync(join(proc, 'cmdline'), 'utf8')
      .split('\0')
      .filter(Boolean);
    const cwd = realpathSync(join(proc, 'cwd'));
    const executable = readlinkSync(join(proc, 'exe'));
    if (
      statSync(proc).uid !== process.getuid() ||
      !node ||
      !['node', 'nodejs'].includes(basename(executable)) ||
      !entry ||
      args.length
    )
      throw mismatch();
    const main = realpathSync(join(root, 'dist/server/main.js'));
    const launcher = realpathSync(join(root, 'bin/codes.mjs'));
    const program = realpathSync(resolve(cwd, entry));
    if (program !== main && program !== launcher) throw mismatch();
    const database = realpathSync(join(directory, 'codes.sqlite'));
    const ownsDatabase = readdirSync(join(proc, 'fd')).some((fd) => {
      try {
        return readlinkSync(join(proc, 'fd', fd)) === database;
      } catch (error) {
        if (!missing(error)) throw error;
        return false;
      }
    });
    if (!ownsDatabase || lockOwner(directory) !== pid || processStart(pid) !== started)
      throw mismatch();
    return { pid, started, proc, cwd, executable, launcher: program === launcher };
  } catch (error) {
    if (processStart(pid) !== started) return;
    if (missing(error) || error?.code === 'EACCES' || error?.code === 'EPERM') throw mismatch();
    throw error;
  }
}

function hasRelativeProjectPaths(env) {
  return (
    (env.CODES_PROJECT_ROOT && !isAbsolute(env.CODES_PROJECT_ROOT)) ||
    (env.CODES_CODEX_BINARY?.includes('/') && !isAbsolute(env.CODES_CODEX_BINARY))
  );
}

export function resolveLaunchPaths(env, cwd) {
  for (const key of ['CODES_DATA_DIR', 'CODES_PROJECT_ROOT']) {
    if (env[key]) env[key] = resolve(cwd, env[key]);
  }
  if (env.CODES_CODEX_BINARY?.includes('/'))
    env.CODES_CODEX_BINARY = resolve(cwd, env.CODES_CODEX_BINARY);
}

export function rememberLaunchDirectory(directory, cwd, initialEnv) {
  // The foreground launcher changes into the installation before serving files.
  // Restart still needs the caller directory for defaults and relative settings.
  if (
    process.platform !== 'linux' ||
    (initialEnv.CODES_PROJECT_ROOT && !hasRelativeProjectPaths(initialEnv))
  )
    return;
  if (lockOwner(directory) !== process.pid) return;
  const target = join(directory, 'launcher-cwd.json');
  const temp = target + '.' + randomUUID();
  try {
    writeFileSync(
      temp,
      JSON.stringify({ pid: process.pid, started: processStart(process.pid), cwd }),
      {
        mode: 0o600,
        flag: 'wx',
      },
    );
    renameSync(temp, target);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function serviceEnvironment(owner, directory) {
  const env = Object.fromEntries(
    readFileSync(join(owner.proc, 'environ'), 'utf8')
      .split('\0')
      .filter((entry) => entry.indexOf('=') > 0)
      .map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]),
  );
  let cwd = owner.cwd;
  const relative = hasRelativeProjectPaths(env);
  if (owner.launcher && (relative || !env.CODES_PROJECT_ROOT)) {
    const record = JSON.parse(readOptional(join(directory, 'launcher-cwd.json')) || 'null');
    if (
      record?.pid === owner.pid &&
      record.started === owner.started &&
      typeof record.cwd === 'string' &&
      isAbsolute(record.cwd)
    )
      cwd = record.cwd;
    else if (relative)
      throw new Error(
        'Cannot recover the original path for a relative startup setting. Use codes stop, then codes start with the intended environment.',
      );
  }
  env.CODES_DATA_DIR = directory;
  env.CODES_PROJECT_ROOT ||= cwd;
  resolveLaunchPaths(env, cwd);
  return env;
}

async function stop(root, directory, owner) {
  const current = serviceInstance(root, directory);
  if (!current || current.pid !== owner.pid || current.started !== owner.started)
    throw new Error('The service changed while preparing to stop. Run codes status.');
  process.kill(owner.pid, 'SIGTERM');
  const deadline = Date.now() + timeout;
  while (processStart(owner.pid) === owner.started && Date.now() < deadline)
    await delay(pollInterval);
  if (processStart(owner.pid) === owner.started)
    throw new Error(
      `Shutdown is still pending for PID ${owner.pid}. Run codes status to check it.`,
    );
  console.log(`Codes stopped (PID ${owner.pid}).`);
}

async function start(root, directory, env, executable, cwd, { path, fd }) {
  const offset = fstatSync(fd).size;
  const child = spawn(executable, [join(root, 'dist/server/main.js')], {
    cwd,
    env: { ...env, CODES_DATA_DIR: directory },
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  let spawnError;
  child.on('error', (error) => {
    spawnError = error;
  });
  child.unref();
  const deadline = Date.now() + timeout;
  const buffer = Buffer.alloc(64 * 1024);
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Codes startup failed. See ${path}.`);
    const size = readSync(fd, buffer, 0, buffer.length, offset);
    const output = buffer.toString('utf8', 0, size);
    const ready = /^codes is ready at .+$/m.exec(output)?.[0];
    if (ready && serviceInstance(root, directory)?.pid === child.pid) {
      console.log(ready);
      const tokenPath = /^Use the access token stored in .+$/m.exec(output)?.[0];
      if (tokenPath) console.log(tokenPath);
      console.log(`PID: ${child.pid}\nLog: ${path}`);
      return;
    }
    await delay(pollInterval);
  }
  throw new Error(`Codes startup has not been confirmed. Run codes status and inspect ${path}.`);
}

export async function manageService(command, root, directory, caller) {
  if (process.platform !== 'linux') throw new Error('Codes service commands require Linux.');
  const owner = serviceInstance(root, directory);
  if (command === 'status' || (command === 'start' && owner)) {
    console.log(owner ? `Codes is running (PID ${owner.pid}).` : 'Codes is stopped.');
    console.log(`Data directory: ${directory}`);
    return command === 'status' && !owner ? 1 : 0;
  }
  if (command === 'stop') {
    if (owner) await stop(root, directory, owner);
    else console.log('Codes is already stopped.');
    return 0;
  }
  const env = owner
    ? serviceEnvironment(owner, directory)
    : { ...process.env, CODES_PROJECT_ROOT: process.env.CODES_PROJECT_ROOT || caller };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const log = openServiceLog(directory, true);
  try {
    if (owner) await stop(root, directory, owner);
    await start(
      root,
      directory,
      env,
      owner?.executable ?? process.execPath,
      owner?.cwd ?? root,
      log,
    );
  } finally {
    closeSync(log.fd);
  }
  return 0;
}
