/** Metadata-only compatibility check. No account, prompt, command, or model execution. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Driver } from '../src/codex/driver.js';
import { Service } from '../src/server/service.js';
import { Store } from '../src/server/store.js';

const directory = await mkdtemp(join(tmpdir(), 'codes-native-'));
process.env.CODEX_HOME = join(directory, 'codex-home');
delete process.env.OPENAI_API_KEY;
delete process.env.CODEX_API_KEY;
delete process.env.CODEX_SQLITE_HOME;
await mkdir(process.env.CODEX_HOME);
const cwd = join(directory, 'project');
await mkdir(join(cwd, '.codex'), { recursive: true });
await writeFile(join(cwd, '.codex/config.toml'), 'model_reasoning_effort = "medium"\n');
const configPath = join(process.env.CODEX_HOME, 'config.toml');
const config = [
  'model = "gpt-5.2"',
  'model_reasoning_effort = "low"',
  'plan_mode_reasoning_effort = "high"',
  'service_tier = "fast"',
  'approval_policy = "on-request"',
  'sandbox_mode = "workspace-write"',
  '[features]',
  'default_mode_request_user_input = false',
  '[projects.' + JSON.stringify(cwd) + ']',
  'trust_level = "trusted"',
  '',
].join('\n');
await writeFile(configPath, config);
const service = new Service(
  new Store(join(directory, 'data')),
  new Driver('codex', {
    binary: process.env.CODES_CODEX_BINARY,
    stateFile: join(directory, 'unused'),
  }),
);

try {
  const project = await service.addProject(cwd);
  const configuration = service.modelSettings.configuration;
  const first = await configuration.read(cwd, true);
  assert.match(service.system().version, /^\d+\.\d+\.\d+/);
  assert.equal(first.model, 'gpt-5.2');
  assert.equal(first.effort, 'medium');
  assert.equal(first.fast, true);
  assert.equal(first.codeQuestions, false);
  assert.equal(first.sources.model_reasoning_effort, 'project');
  assert.equal(first.writable, true);

  const models = await service.modelSettings.models();
  assert.ok(models.some((model) => model.supportsImages));
  const { collaborationMode } = await service.modelSettings.resolve(
    { mode: 'plan', model: 'old-setting' },
    cwd,
  );
  assert.equal(collaborationMode.mode, 'plan');
  assert.equal(collaborationMode.settings.model, first.model);
  assert.equal(collaborationMode.settings.reasoning_effort, 'high');

  const thread = await service.create(project.id, { permission: 'read-only' });
  assert.equal(thread.nativeSettings?.sandbox, 'workspaceWrite');
  const next = await configuration.save(cwd, {
    version: first.userVersion!,
    changes: {
      model_reasoning_effort: 'high',
      service_tier: 'default',
    },
  });
  assert.equal(next.effort, 'medium');
  assert.equal(next.fast, false);
  assert.equal((await configuration.read(directory)).effort, 'high');
  await assert.rejects(
    configuration.save(cwd, {
      version: first.userVersion!,
      changes: { model_reasoning_effort: 'low' },
    }),
    { code: 'SETTINGS_CONFLICT' },
  );

  await configuration.save(cwd, {
    version: next.userVersion!,
    changes: { sandbox_mode: null, default_permissions: ':read-only' },
  });
  const refreshed = await configuration.read(cwd);
  const runtime = await configuration.synchronizeThread(thread.id, cwd, refreshed.key);
  assert.equal(runtime.sandbox, 'readOnly');
  assert.equal(runtime.permissionProfile, ':read-only');

  const history = await service.history(thread.id);
  assert.equal(history.messages.length, 0);
  assert.equal(history.state, 'idle');
  await rename(cwd, join(directory, 'project-moved'));
  assert.equal((await service.conversationContext(thread.id)).directory.available, false);
  assert.equal((await service.history(thread.id)).messages.length, 0);
  await assert.rejects(service.create(project.id), { code: 'DIRECTORY_UNAVAILABLE' });
  const externalCwd = join(directory, 'external');
  const nativeId = randomUUID();
  const timestamp = '2026-05-10T12:00:00.000Z';
  const rollouts = join(process.env.CODEX_HOME!, 'sessions/2026/05/10');
  await mkdir(externalCwd);
  await mkdir(rollouts, { recursive: true });
  await writeFile(
    join(rollouts, 'rollout-2026-05-10T12-00-00-' + nativeId + '.jsonl'),
    [
      {
        timestamp,
        type: 'session_meta',
        payload: {
          id: nativeId,
          timestamp,
          cwd: externalCwd,
          originator: 'codex_cli_rs',
          cli_version: service.system().version,
          source: 'cli',
          model_provider: 'openai',
        },
      },
      {
        timestamp,
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'Synthetic native conversation',
          images: [],
          local_images: [],
          text_elements: [],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n') + '\n',
  );
  assert.equal(
    service.store.projects().some((item) => item.path === externalCwd),
    false,
  );
  const all = await service.nativeConversations({ sort: 'created_at' });
  assert.ok(all.data.some((row) => row.id === nativeId && row.cwd === externalCwd));
  assert.equal(
    (await service.nativeConversations({ cwd })).data.some((row) => row.id === nativeId),
    false,
  );
  await service.archive(nativeId, randomUUID(), true);
  assert.equal((await service.nativeConversations({ cwd: externalCwd })).data.length, 0);
  assert.equal(
    (await service.nativeConversations({ cwd: externalCwd, archived: true })).data[0]?.id,
    nativeId,
  );
  await service.archive(nativeId, randomUUID(), false);
  assert.equal((await service.nativeConversations({ cwd: externalCwd })).data[0]?.id, nativeId);
  console.log(
    'PASS: CLI ' +
      service.system().version +
      ' native layers, revision-checked writes, runtime permissions, model and Plan metadata, history recovery, Cwd/All discovery, and archive/restore. No model requests.',
  );
} finally {
  await service.close();
  await rm(directory, { recursive: true, force: true });
}
