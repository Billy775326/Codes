/** Disposable native filesystem checks. Executes shell commands, but sends no model prompts. */
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Driver } from '../src/codex/driver.js';
import { WriteBoundary } from '../src/codex/write-boundary.js';
const directory = await mkdtemp(join(tmpdir(), 'codes-native-boundary-'));
const forbiddenTemporaryFile = '/tmp/codes-native-boundary-' + randomUUID();
const allowed = join(directory, 'allowed'),
  outside = join(directory, 'outside');
await mkdir(allowed);
await mkdir(outside);
await mkdir(join(directory, 'home'));
await mkdir(join(allowed, '.codex'));
await writeFile(join(allowed, '.codex/owner-policy'), 'protected');
await writeFile(join(outside, 'keep'), 'original');
await symlink(outside, join(allowed, 'escape'));
process.env.CODEX_HOME = join(directory, 'home');
delete process.env.OPENAI_API_KEY;
delete process.env.CODEX_API_KEY;
const boundary = new WriteBoundary(allowed);
const driver = new Driver('codex', {
  stateFile: join(directory, 'unused'),
  writeBoundary: boundary,
});
try {
  await driver.start();
  const config = await driver.call('config/read', { includeLayers: false });
  assert.equal(config.config.features.apps, false);
  assert.equal(config.config.sandbox_workspace_write.exclude_slash_tmp, true);
  const thread = await driver.call('thread/start', { cwd: allowed, sandbox: 'workspace-write' });
  assert.equal(thread.approvalPolicy, 'never');
  assert.equal(thread.sandbox.excludeTmpdirEnvVar, true);
  assert.equal(thread.sandbox.excludeSlashTmp, true);
  const result = await driver.call('command/exec', {
    cwd: allowed,
    command: [
      '/bin/sh',
      '-c',
      `printf inside > inside; printf changed > '${outside}/keep'; printf escape > escape/keep; printf protected > .codex/owner-policy; printf outside > '${forbiddenTemporaryFile}'`,
    ],
    sandboxPolicy: boundary.sandbox(),
    timeoutMs: 5000,
  });
  assert.match(result.stderr, /Read-only file system|Permission denied/);
  assert.equal(await readFile(join(allowed, 'inside'), 'utf8'), 'inside');
  assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'original');
  assert.equal(await readFile(join(allowed, '.codex/owner-policy'), 'utf8'), 'protected');
  assert.equal(result.exitCode, 2);
  console.log(
    'PASS inside write succeeds, outside, symlink escape and /tmp writes denied. No model requests.',
  );
} finally {
  await driver.stop();
  await rm(forbiddenTemporaryFile, { force: true });
  await rm(directory, { recursive: true, force: true });
}
