import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const directory = await mkdtemp(join(tmpdir(), 'codes-browser-'));
const project = join(directory, 'sample-project');
await mkdir(project);
await writeFile(
  join(project, 'README.md'),
  '# Sample project\n\nA fixture for isolated browser acceptance.\n',
);
await writeFile(
  join(project, 'example.ts'),
  'export function hello(name: string) {\n  return `Hello, ${name}`;\n}\n',
);
const child = spawn(process.execPath, ['dist/server/main.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CODES_RUNTIME: 'mock',
    CODES_TEST_MODE: '1',
    CODES_DATA_DIR: join(directory, 'data'),
    CODES_PROJECT_ROOT: project,
    CODES_PORT: '19140',
    CODES_HOST: '127.0.0.1',
    CODES_PUBLIC_ORIGIN: 'http://127.0.0.1:19140',
    CODES_ACCESS_TOKEN: 'test-only-browser-token-not-a-real-secret',
  },
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  await new Promise<void>((yes) =>
    child.exitCode !== null ? yes() : child.once('exit', () => yes()),
  );
  await rm(directory, { recursive: true, force: true });
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
child.once('exit', () => {
  if (!stopping) void stop();
});
