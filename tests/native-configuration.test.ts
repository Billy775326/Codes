import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { Driver } from '../src/codex/driver';
import { NativeConfiguration } from '../src/server/native-configuration';

function fixture() {
  const driver = new Driver('mock', { stateFile: '/unused' });
  const response = {
    config: {
      model: 'configured-model',
      approval_policy: { granular: { sandbox_approval: true, rules: ['first', 'second'] } },
      features: { fast_mode: false, default_mode_request_user_input: true },
      permissions: { workspace: { network: { enabled: false } } },
    },
    origins: {
      model: { name: { type: 'user', profile: null }, version: 'user-version' },
      features: { name: { type: 'project', profile: null }, version: 'project-version' },
    },
  };
  vi.spyOn(driver, 'call').mockImplementation(async () => structuredClone(response));
  return { driver, response, configuration: new NativeConfiguration(driver) };
}

function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reorder(item)]),
  );
}

it('treats reordered configuration and source objects as the same configuration', async () => {
  const { driver, response, configuration } = fixture();
  const before = await configuration.read('/fixture');
  vi.mocked(driver.call).mockResolvedValue(reorder(response));
  const after = await configuration.read('/fixture');
  expect(after).toEqual(before);
});

it.each(['model', 'permission', 'array order', 'source version', 'runtime epoch'] as const)(
  'invalidates the configuration after a real %s change',
  async (change) => {
    const { driver, response, configuration } = fixture();
    const before = await configuration.read('/fixture');
    if (change === 'model') response.config.model = 'another-model';
    if (change === 'permission') response.config.permissions.workspace.network.enabled = true;
    if (change === 'array order') response.config.approval_policy.granular.rules.reverse();
    if (change === 'source version') response.origins.model.version = 'new-user-version';
    if (change === 'runtime epoch') driver.epoch = randomUUID();
    expect((await configuration.read('/fixture')).key).not.toBe(before.key);
  },
);
