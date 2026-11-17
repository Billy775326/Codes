import { expect, it } from 'vitest';
import { Driver } from '../src/codex/driver';
it('rejects an incompatible binary before attempting to execute a thread', async () => {
  const driver = new Driver('codex', { binary: process.execPath, stateFile: '/unused' });
  try {
    await expect(driver.start()).rejects.toMatchObject({ code: 'CLI_VERSION' });
    expect(driver.state).toBe('unavailable');
  } finally {
    await driver.stop();
  }
});
it('prevents a process from spawning after shutdown races with startup', async () => {
  const driver = new Driver('mock', { stateFile: '/unused' });
  const assertion = expect(driver.start()).rejects.toMatchObject({ code: 'RUNTIME_OFFLINE' });
  await driver.stop();
  await assertion;
  expect(driver.state).toBe('stopped');
});
