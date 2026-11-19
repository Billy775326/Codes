#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const [major, minor] = process.versions.node.split('.').map(Number);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(`Usage: codes

Start the codes web workspace in the foreground (default: http://127.0.0.1:6670).
Configuration uses CODES_* environment variables. Press Ctrl+C to stop.
Default data directory: ${join(root, '.local')}
Relative configuration paths resolve from the calling directory.
Build the application first with npm run build in ${root}`);
} else if (args.length) {
  console.error('Unknown arguments. Use codes --help for usage.');
  process.exitCode = 1;
} else if (major !== 24 || minor < 19) {
  console.error('codes requires Node.js 24.19 or newer in the 24.x line.');
  process.exitCode = 1;
} else if (
  !existsSync(join(root, 'dist/server/main.js')) ||
  !existsSync(join(root, 'dist/web/index.html'))
) {
  console.error(`Build files are missing. Run npm run build in ${root} before starting codes.`);
  process.exitCode = 1;
} else {
  // Keep one data directory across callers, while honoring explicit relative paths.
  for (const key of ['CODES_DATA_DIR', 'CODES_PROJECT_ROOT', 'CODES_TASK_WRITE_ROOT']) {
    if (process.env[key]) process.env[key] = resolve(process.env[key]);
  }
  if (process.env.CODES_CODEX_BINARY?.includes('/'))
    process.env.CODES_CODEX_BINARY = resolve(process.env.CODES_CODEX_BINARY);
  process.chdir(root);
  try {
    await import(new URL('../dist/server/main.js', import.meta.url).href);
  } catch (error) {
    // Recognize the lock error from existing builds as well as the current build.
    // Other startup failures retain their original diagnostic and exit behavior.
    if (!(error instanceof Error) || error.message !== 'The data directory is already in use.')
      throw error;
    const directory = process.env.CODES_DATA_DIR ?? join(root, '.local');
    let pid;
    try {
      const owner = Number(readFileSync(join(directory, 'server.lock'), 'utf8'));
      if (Number.isSafeInteger(owner) && owner > 0) pid = owner;
    } catch (readError) {
      // The existing process may have released the lock after rejecting this start.
      if (readError.code !== 'ENOENT') throw readError;
    }
    console.error('codes did not start: the data directory is already in use.');
    console.error(`Data directory: ${directory}`);
    if (pid) console.error(`Lock owner PID: ${pid}`);
    console.error(
      'Use the existing workspace. This command does not restart it or remove its lock.',
    );
    process.exitCode = 1;
  }
}
