/** Metadata-only compatibility check. No account, prompt, command, or model execution. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Driver } from '../src/codex/driver.js';
import { Service } from '../src/server/service.js';
import { Store } from '../src/server/store.js';
const directory = await mkdtemp(join(tmpdir(), 'codes-native-'));
process.env.CODEX_HOME = join(directory, 'codex-home');
delete process.env.OPENAI_API_KEY;
delete process.env.CODEX_API_KEY;
await mkdir(process.env.CODEX_HOME);
await mkdir(join(directory, 'project'));
const service = new Service(
  new Store(join(directory, 'data')),
  new Driver('codex', {
    binary: process.env.CODES_CODEX_BINARY,
    stateFile: join(directory, 'unused'),
  }),
);
try {
  const project = await service.addProject(join(directory, 'project'));
  const models = await service.driver.call('model/list', { limit: 30 });
  assert.ok(Array.isArray(models.data));
  const thread = await service.create(project.id, { permission: 'read-only' });
  assert.ok(thread.id);
  const history = await service.history(thread.id);
  assert.equal(history.messages.length, 0);
  assert.equal(history.state, 'idle');
  console.log(
    'PASS: CLI 0.167.0 initialization, model metadata, thread creation/read, and lazy empty history. No model requests.',
  );
} finally {
  await service.close();
  await rm(directory, { recursive: true, force: true });
}
