import { nativePermissions, permissionPresets } from '../src/shared/permissions.js';
/** Metadata-only compatibility check. No account, prompt, command, or model execution. */
import assert from 'node:assert/strict';
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
await mkdir(process.env.CODEX_HOME);
await mkdir(join(directory, 'project'));
const configPath = join(process.env.CODEX_HOME, 'config.toml');
const config =
  'model = "gpt-5.2"\nmodel_reasoning_effort = "high"\nplan_mode_reasoning_effort = "medium"\nservice_tier = "priority"\n';
await writeFile(configPath, config);
const service = new Service(
  new Store(join(directory, 'data')),
  new Driver('codex', {
    binary: process.env.CODES_CODEX_BINARY,
    stateFile: join(directory, 'unused'),
  }),
);
try {
  const project = await service.addProject(join(directory, 'project'));
  const configuration = await service.driver.call('config/read', { includeLayers: false });
  assert.equal(configuration.config.features.default_mode_request_user_input, true);
  const defaults = await service.modelSettings.defaults(project.path);
  assert.deepEqual(defaults, {
    model: 'gpt-5.2',
    effort: 'high',
    planEffort: 'medium',
    fast: true,
    fastAvailable: true,
  });
  const models = await service.modelSettings.models();
  assert.ok(models.length > 0);
  assert.ok(models.every((model) => typeof model.supportsImages === 'boolean'));
  assert.ok(models.some((model) => model.supportsImages));
  const modes = await service.modelSettings.modes();
  assert.ok(modes.some((entry) => entry.mode === 'plan'));
  assert.ok(modes.some((entry) => entry.mode === 'default'));
  const thread = await service.create(project.id, { permission: 'read-only' });
  assert.ok(thread.id);
  const { collaborationMode: mode, serviceTier } = await service.modelSettings.resolve(
    { permission: 'read-only', mode: 'plan' },
    project.path,
  );
  assert.equal(mode.mode, 'plan');
  assert.equal(mode.settings.reasoning_effort, 'medium');
  assert.equal(serviceTier, 'priority');
  await service.driver.call('thread/settings/update', {
    threadId: thread.id,
    cwd: project.path,
    collaborationMode: mode,
    sandboxPolicy: { type: 'readOnly' },
  });
  for (const serviceTier of ['priority', 'default']) {
    const approvalsReviewer = serviceTier === 'priority' ? 'auto_review' : 'user';
    let cancel!: () => void;
    const changed = new Promise<any>((resolve, reject) => {
      const onNotification = (event: any) => {
        if (
          event.method !== 'thread/settings/updated' ||
          event.params.threadId !== thread.id ||
          event.params.threadSettings?.serviceTier !== serviceTier ||
          event.params.threadSettings?.approvalsReviewer !== approvalsReviewer
        )
          return;
        cancel();
        resolve(event.params);
      };
      const timeout = setTimeout(() => {
        cancel();
        reject(new Error('Native settings notification timed out'));
      }, 5000);
      cancel = () => {
        clearTimeout(timeout);
        service.driver.off('notification', onNotification);
      };
      service.driver.on('notification', onNotification);
    });
    try {
      const result = await service.driver.call('thread/settings/update', {
        threadId: thread.id,
        serviceTier,
        approvalsReviewer,
      });
      assert.deepEqual(result, {});
      const notification = await changed;
      assert.equal(notification.threadSettings.serviceTier, serviceTier);
      assert.equal(notification.threadSettings.approvalsReviewer, approvalsReviewer);
      assert.equal(notification.threadSettings.collaborationMode.mode, 'plan');
    } finally {
      cancel();
    }
  }
  const afterSpeedChange = await service.driver.call('config/read', { includeLayers: false });
  assert.equal(afterSpeedChange.config.service_tier, configuration.config.service_tier);
  assert.equal(afterSpeedChange.config.approvals_reviewer, configuration.config.approvals_reviewer);
  await writeFile(configPath, config + '\n[features]\nfast_mode = false\n');
  assert.deepEqual(await service.modelSettings.defaults(project.path), {
    ...defaults,
    fast: false,
    fastAvailable: false,
  });
  assert.equal((await service.modelSettings.permissions()).autoReview, true);
  for (const preset of permissionPresets) {
    const configured = await service.create(project.id, { permission: preset.id });
    await service.driver.call('thread/settings/update', {
      threadId: configured.id,
      ...nativePermissions(preset.id, join(directory, 'project')),
    });
    await service.driver.call('thread/settings/update', {
      threadId: configured.id,
      ...nativePermissions('read-only', join(directory, 'project')),
    });
  }
  const history = await service.history(thread.id);
  assert.equal(history.messages.length, 0);
  assert.equal(history.state, 'idle');
  await rename(join(directory, 'project'), join(directory, 'project-moved'));
  assert.equal((await service.conversationContext(thread.id)).directory.available, false);
  assert.equal((await service.history(thread.id)).messages.length, 0);
  await assert.rejects(service.create(project.id), { code: 'DIRECTORY_UNAVAILABLE' });
  await rename(join(directory, 'project-moved'), join(directory, 'project'));
  console.log(
    'PASS: CLI 0.167.0 initialization, model/reasoning/image-input metadata, Plan/Code presets, Fast/standard thread settings, creation/read, all four sandbox/approval/reviewer presets with manual read-only restoration, lazy empty history, and missing-directory metadata/history recovery. No model requests.',
  );
} finally {
  await service.close();
  await rm(directory, { recursive: true, force: true });
}
