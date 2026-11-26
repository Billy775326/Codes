import { expect, it, vi } from 'vitest';
import type { Driver } from '../src/codex/driver';
import { ModelSettings } from '../src/server/model-settings';

it('shares catalog reads in a runtime and refreshes them after an epoch change or expiry', async () => {
  const now = vi.spyOn(performance, 'now').mockReturnValue(100);
  const mode = { name: 'Default', mode: 'default', model: null };
  const model = {
    id: 'fixture',
    model: 'fixture',
    displayName: 'Fixture',
    isDefault: true,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: 'medium',
  };
  const driver = {
    epoch: 'first',
    start: async () => {},
    supports: () => true,
    call: vi.fn(async (method: string) => ({ data: method === 'model/list' ? [model] : [mode] })),
  };
  const settings = new ModelSettings(driver as unknown as Driver);
  try {
    await Promise.all([settings.models(), settings.models(), settings.modes(), settings.modes()]);
    expect(driver.call).toHaveBeenCalledTimes(2);
    expect((await settings.models())[0]?.id).toBe('fixture');
    expect(driver.call).toHaveBeenCalledTimes(2);
    driver.epoch = 'second';
    await settings.models();
    expect(driver.call).toHaveBeenCalledTimes(3);
    now.mockReturnValue(60_101);
    await settings.models();
    expect(driver.call).toHaveBeenCalledTimes(4);
    settings.invalidateCatalogs();
    driver.call.mockRejectedValueOnce(new Error('metadata unavailable'));
    await expect(settings.models()).rejects.toThrow('metadata unavailable');
    await expect(settings.models()).resolves.toHaveLength(1);
    expect(driver.call).toHaveBeenCalledTimes(6);
  } finally {
    now.mockRestore();
  }
});
