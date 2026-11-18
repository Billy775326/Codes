/** Opt-in local IDE workflow pilot; only a disposable read-only fixture is exposed to models. */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Driver } from '../src/codex/driver.js';
import { Service } from '../src/server/service.js';
import { Store } from '../src/server/store.js';
import type { Thread } from '../src/shared/types.js';
if (!process.argv.includes('--allow-model-requests'))
  throw new Error(
    'This pilot uses the server login and model quota. Pass --allow-model-requests explicitly.',
  );
const directory = await mkdtemp(join(tmpdir(), 'codes-live-ide-'));
await writeFile(
  join(directory, 'README.md'),
  '# Fixture\n\nA disposable documentation fixture with no code.\n',
);
const service = new Service(
  new Store(join(directory, '.data')),
  new Driver('codex', {
    binary: process.env.CODES_CODEX_BINARY,
    stateFile: join(directory, 'unused'),
  }),
);
async function wait(thread: Thread, ready: () => boolean, seconds = 90) {
  const deadline = Date.now() + seconds * 1000;
  while (!ready()) {
    if (thread.actions.some((entry) => entry.status === 'pending')) {
      await service.interrupt(thread.id);
      throw new Error('A real approval/question needs manual acceptance; this pilot grants none.');
    }
    if (Date.now() > deadline) {
      await service.interrupt(thread.id);
      throw new Error('Live IDE pilot timed out.');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
const done = (thread: Thread) =>
  wait(thread, () => ['completed', 'failed', 'interrupted'].includes(thread.state));
try {
  const project = await service.addProject(directory, 'codes IDE acceptance fixture');
  const thread = await service.create(project.id, { permission: 'read-only' });
  const models = await service.modelSettings.models();
  const model = models.find(
    (entry) => entry.model === thread.resolvedModel || entry.id === thread.resolvedModel,
  );
  assert.ok(model, 'The active model must expose reasoning metadata.');
  const settings = {
    permission: 'read-only',
    mode: 'plan',
    effort: model.defaultReasoningEffort,
  } as const;
  await service.send(
    thread.id,
    randomUUID(),
    'This is a disposable documentation-only fixture. Without executing commands, modifying files, or asking questions, give a short plan for checking that a README is understandable. No implementation is requested.',
    settings,
  );
  await done(thread);
  assert.equal(thread.state, 'completed');
  assert.equal(thread.pending, undefined);
  assert.ok(thread.messages.some((entry) => entry.kind === 'assistant' && entry.text.length > 0));
  console.log(
    'PASS: real Plan mode, catalog reasoning effort, streamed answer and completed receipt.',
  );

  await service.send(
    thread.id,
    randomUUID(),
    'In this disposable fixture directory only, run sleep 4 once, then reply ORIGINAL_FINISHED. Do not modify files, inspect any other directory, or execute additional commands.',
    { permission: 'read-only', mode: 'default', effort: model.defaultReasoningEffort },
  );
  await wait(
    thread,
    () =>
      thread.messages.some(
        (entry) =>
          entry.turnId === thread.turnId &&
          entry.kind === 'command' &&
          entry.text.includes('sleep'),
      ),
    30,
  );
  const turnId = thread.turnId!;
  const followId = randomUUID();
  await service.steer(
    thread.id,
    followId,
    turnId,
    'Change the final reply to include STEER_VERIFIED. Do not execute any additional commands or change files.',
  );
  await done(thread);
  assert.equal(thread.state, 'completed');
  assert.equal(thread.turnId, turnId);
  assert.equal(service.store.operation(followId)?.state, 'completed');
  const history = await service.history(thread.id);
  assert.ok(
    history.messages.some((entry) => entry.clientId === followId && entry.turnId === turnId),
  );
  assert.ok(
    history.messages.some(
      (entry) =>
        entry.kind === 'assistant' &&
        entry.turnId === turnId &&
        entry.text.includes('STEER_VERIFIED'),
    ),
  );
  assert.ok(thread.usage && thread.usage.totalTokens > 0);
  console.log(
    'PASS: real Code-mode transition, same-turn steering/client identity, native history and token usage.',
  );

  const reviewId = randomUUID();
  await service.review(
    thread.id,
    reviewId,
    {
      type: 'custom',
      instructions:
        'Review only README.md in this disposable fixture for unclear wording. Do not inspect other directories or modify any file. Return a concise review, even if no actionable finding exists.',
    },
    { permission: 'read-only', effort: model.defaultReasoningEffort },
  );
  await done(thread);
  assert.equal(thread.state, 'completed');
  assert.equal(service.store.operation(reviewId)?.state, 'completed');
  assert.equal(thread.settings.permission, 'read-only');
  assert.ok(
    thread.messages.some((entry) => entry.turnId === thread.turnId && entry.kind === 'notice'),
  );
  assert.ok(
    (await service.history(thread.id)).messages.some(
      (entry) =>
        entry.turnId === thread.turnId && (entry.kind === 'notice' || entry.kind === 'assistant'),
    ),
  );
  console.log(
    'PASS: real native review, read-only settings, review items/history and durable terminal receipt.',
  );
} finally {
  await service.close();
  await rm(directory, { recursive: true, force: true });
}
