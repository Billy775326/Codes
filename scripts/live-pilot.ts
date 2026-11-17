/** Opt-in live model pilot. Uses the server's login and leaves native acceptance threads. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Driver } from '../src/codex/driver.js';
import { Service } from '../src/server/service.js';
import { Store } from '../src/server/store.js';
import type { Thread } from '../src/shared/types.js';
if (!process.argv.includes('--allow-model-requests'))
  throw new Error(
    'This pilot uses your existing login and model quota. Pass --allow-model-requests explicitly.',
  );
const directory = await mkdtemp(join(tmpdir(), 'codes-live-'));
await writeFile(join(directory, 'README.md'), 'CODES_LIVE_FIXTURE_OK\n');
const service = new Service(
  new Store(join(directory, '.data')),
  new Driver('codex', {
    binary: process.env.CODES_CODEX_BINARY,
    stateFile: join(directory, 'unused'),
  }),
);
async function terminal(thread: Thread) {
  const deadline = Date.now() + 90_000;
  while (!['completed', 'failed', 'interrupted'].includes(thread.state)) {
    if (thread.actions.some((a) => a.status === 'pending')) {
      await service.interrupt(thread.id);
      throw new Error(
        'An unexpected approval or question requires manual live acceptance. No approval was granted.',
      );
    }
    if (Date.now() > deadline) {
      await service.interrupt(thread.id);
      throw new Error('The live pilot exceeded its deadline.');
    }
    await new Promise((yes) => setTimeout(yes, 100));
  }
}
try {
  const project = await service.addProject(directory, 'codes acceptance fixture');
  const thread = await service.create(project.id, { permission: 'read-only' });
  const operationId = randomUUID();
  await service.send(
    thread.id,
    operationId,
    'Read only README.md in the current directory and reply with its first line followed by VERIFIED. This is an isolated acceptance fixture. Do not inspect any other directory or edit anything.',
    thread.settings,
  );
  await terminal(thread);
  assert.equal(thread.state, 'completed');
  assert.ok(
    thread.messages.some((m) => m.kind === 'assistant' && m.text.includes('CODES_LIVE_FIXTURE_OK')),
  );
  const history = await service.history(thread.id);
  assert.ok(
    history.messages.some((m) => m.clientId === operationId),
    'The native client message identity must survive history reads.',
  );
  assert.ok(
    history.messages.some(
      (m) => m.kind === 'assistant' && m.text.includes('CODES_LIVE_FIXTURE_OK'),
    ),
  );
  console.log(
    'PASS: live read-only stream, tool activity, terminal receipt, client identity, and native history.',
  );

  await service.send(
    thread.id,
    randomUUID(),
    'In this disposable fixture only, use apply_patch to replace README.md with the single line CODES_LIVE_EDIT_OK followed by a newline. Do not change any other file or access other directories. Reply EDIT_VERIFIED when done.',
    { permission: 'workspace-write' },
  );
  await terminal(thread);
  assert.equal(thread.state, 'completed');
  assert.equal(await readFile(join(directory, 'README.md'), 'utf8'), 'CODES_LIVE_EDIT_OK\n');
  assert.ok(
    thread.diff.length > 0 || thread.messages.some((m) => m.kind === 'change'),
    'The CLI must expose the file change or turn diff.',
  );
  console.log(
    'PASS: live workspace-write edit and native change/diff events in the disposable fixture.',
  );

  const stopped = await service.create(project.id, { permission: 'read-only' });
  await service.send(
    stopped.id,
    randomUUID(),
    'Explain how this fixture could be tested, without executing commands or changing files. Provide a detailed plan.',
    stopped.settings,
  );
  await service.interrupt(stopped.id);
  await terminal(stopped);
  assert.equal(stopped.state, 'interrupted');
  assert.equal(stopped.pending, undefined);
  console.log('PASS: real turn interruption and execution lease release.');
} finally {
  await service.close();
  await rm(directory, { recursive: true, force: true });
}
