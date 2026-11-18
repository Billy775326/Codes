#!/usr/bin/env node
import { existsSync } from 'node:fs';
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
  for (const key of ['CODES_DATA_DIR', 'CODES_PROJECT_ROOT']) {
    if (process.env[key]) process.env[key] = resolve(process.env[key]);
  }
  if (process.env.CODES_CODEX_BINARY?.includes('/'))
    process.env.CODES_CODEX_BINARY = resolve(process.env.CODES_CODEX_BINARY);
  process.chdir(root);
  await import(new URL('../dist/server/main.js', import.meta.url).href);
}
