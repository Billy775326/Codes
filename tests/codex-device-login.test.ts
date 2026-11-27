import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { Driver } from '../src/codex/driver';
import { CodexAccount } from '../src/server/codex-account';
import { CodexDeviceLogin } from '../src/server/codex-device-login';

function fixture() {
  const driver = new Driver('codex', { stateFile: '/unused' });
  driver.state = 'ready';
  vi.spyOn(driver, 'system').mockReturnValue({
    runtime: 'codex',
    state: 'ready',
    version: 'fixture',
    capabilities: {
      deviceLogin: true,
      branch: false,
      itemHistory: false,
      review: false,
      turnSpeed: false,
    },
  });
  const account = new CodexAccount(driver);
  vi.spyOn(account, 'status').mockResolvedValue('signed-out');
  const login = new CodexDeviceLogin(driver, account);
  const challenge = {
    type: 'chatgptDeviceCode',
    loginId: randomUUID(),
    verificationUrl: 'https://auth.openai.com/codex/device',
    userCode: 'ABCD-1234',
  };
  return { driver, login, challenge };
}

it('shares a pending challenge and recognizes only its native completion', async () => {
  const { driver, login, challenge } = fixture();
  const call = vi.spyOn(driver, 'call').mockResolvedValue(challenge);
  const [first, second] = await Promise.all([login.start(), login.start()]);
  expect(first).toEqual(second);
  expect(first).toMatchObject({ status: 'pending', loginId: challenge.loginId });
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith('account/login/start', { type: 'chatgptDeviceCode' }, 15_000);
  login.complete(randomUUID(), true);
  expect(login.current()).toEqual(first);
  login.complete(challenge.loginId, true);
  expect(login.current()).toEqual({ status: 'succeeded' });
});

it('handles completion before the start response and rejects a foreign verification page', async () => {
  const { driver, login, challenge } = fixture();
  vi.spyOn(driver, 'call').mockImplementationOnce(async () => {
    login.complete(challenge.loginId, true);
    return challenge;
  });
  expect(await login.start()).toEqual({ status: 'succeeded' });
  vi.mocked(driver.call)
    .mockResolvedValueOnce({ ...challenge, verificationUrl: 'https://example.invalid' })
    .mockResolvedValueOnce({ status: 'canceled' });
  await expect(login.start()).rejects.toMatchObject({ code: 'CODEX_LOGIN_START' });
  expect(driver.call).toHaveBeenLastCalledWith(
    'account/login/cancel',
    { loginId: challenge.loginId },
    5000,
  );
  expect(login.current()).toEqual({ status: 'idle' });
});
