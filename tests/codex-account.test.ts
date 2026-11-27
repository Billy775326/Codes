import { expect, it, vi } from 'vitest';
import { Driver } from '../src/codex/driver';
import { CodexAccount } from '../src/server/codex-account';

function fixture() {
  const driver = new Driver('codex', { stateFile: '/unused' });
  driver.state = 'ready';
  const native = {
    account: null as null | { type: string; email: string },
    requiresOpenaiAuth: true,
  };
  const call = vi
    .spyOn(driver, 'call')
    .mockImplementation(async (method) =>
      method === 'account/read' ? native : { config: { model_provider: null } },
    );
  const terminal = vi.spyOn(driver, 'terminalLoginStatus').mockResolvedValue(false);
  return { account: new CodexAccount(driver), driver, call, native, terminal };
}

it('shares a read-only native account probe and blocks only a confirmed OpenAI context', async () => {
  const { account, call } = fixture();
  expect(await Promise.all([account.status('openai'), account.status('custom')])).toEqual([
    'signed-out',
    'unknown',
  ]);
  expect(call.mock.calls.filter(([method]) => method === 'account/read')).toEqual([
    ['account/read', { refreshToken: false }, 5000],
  ]);
  await expect(account.requireForSend('openai', 'openai')).rejects.toMatchObject({
    code: 'CODEX_SIGN_IN_REQUIRED',
    uncertain: false,
  });
  await expect(account.requireForSend('openai', 'custom')).resolves.toBeUndefined();
  await expect(account.requireForSend('custom', 'openai')).resolves.toBeUndefined();
});

it('distinguishes terminal login changes and native runtime restarts', async () => {
  const { account, call, driver, native, terminal } = fixture();
  expect(await account.status('openai')).toBe('signed-out');
  terminal.mockResolvedValue(true);
  expect(await account.status('openai', true)).toBe('reload-required');
  native.account = { type: 'chatgpt', email: 'fixture@example.invalid' };
  driver.epoch = '01234567-1234-4123-8123-012345678901';
  expect(await account.status('openai')).toBe('signed-in');
  expect(call.mock.calls.filter(([method]) => method === 'account/read')).toHaveLength(3);
});

it('handles an auth-free provider and unavailable account metadata independently', async () => {
  const { account, call, native } = fixture();
  native.requiresOpenaiAuth = false;
  expect(await account.status('openai')).toBe('not-required');
  call.mockRejectedValue(new Error('Optional account RPC unavailable'));
  account.invalidate();
  expect(await account.status('openai')).toBe('unknown');
  await expect(account.requireForSend('openai')).resolves.toBeUndefined();
});
