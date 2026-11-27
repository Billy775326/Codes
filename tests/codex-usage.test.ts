import { expect, it, vi } from 'vitest';
import { Driver } from '../src/codex/driver';
import { CodexUsage } from '../src/server/codex-usage';

function fixture() {
  const driver = new Driver('codex', { stateFile: '/unused' });
  driver.state = 'ready';
  return { driver, usage: new CodexUsage(driver), call: vi.spyOn(driver, 'call') };
}

it('shares read-only queries and returns only supported account usage fields', async () => {
  const { usage, call } = fixture();
  call.mockImplementation(async (method) =>
    method === 'account/rateLimits/read'
      ? {
          accountId: 'must-not-be-exposed',
          rateLimits: { limitId: 'codex', primary: { usedPercent: 15 } },
          rateLimitsByLimitId: {
            codex: {
              planType: 'plus',
              primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 },
              secondary: { usedPercent: 110, windowDurationMins: 10080 },
              credits: { balance: '10.5', hasCredits: true, unlimited: false },
            },
            invalid: { primary: { usedPercent: -1 } },
          },
          rateLimitResetCredits: {
            availableCount: 2,
            credits: [
              {
                id: 'private-reset',
                status: 'available',
                grantedAt: 1_799_000_000,
                expiresAt: null,
                title: 'Codex reset',
              },
              { id: 'invalid', status: 'invented', grantedAt: 1_799_000_000 },
            ],
          },
        }
      : {
          summary: { lifetimeTokens: 1000 },
          dailyUsageBuckets: [
            { startDate: '2026-11-25', tokens: 0 },
            { startDate: 'invalid', tokens: 10 },
            { startDate: '2026-11-27', tokens: 100 },
          ],
        },
  );
  const [first, second] = await Promise.all([usage.read(), usage.read()]);
  expect(second).toEqual(first);
  expect(await usage.read()).toEqual(first);
  expect(call.mock.calls.map(([method]) => method)).toEqual([
    'account/rateLimits/read',
    'account/usage/read',
  ]);
  expect(first).toEqual({
    reset: { key: expect.any(String), retry: false },
    limits: {
      status: 'reported',
      value: {
        plan: 'plus',
        creditBalance: '10.5',
        unlimitedCredits: false,
        availableResets: 2,
        resetCredits: [
          { status: 'available', grantedAt: 1_799_000_000, expiresAt: null, title: 'Codex reset' },
        ],
        windows: [
          {
            id: 'codex',
            primary: { usedPercent: 25, durationMins: 300, resetsAt: 1_800_000_000 },
            secondary: { usedPercent: 100, durationMins: 10080 },
          },
        ],
      },
    },
    activity: {
      status: 'reported',
      value: {
        lifetimeTokens: 1000,
        days: [
          { date: '2026-11-27', tokens: 100 },
          { date: '2026-11-25', tokens: 0 },
        ],
      },
    },
  });
});

it('redeems one earned reset across concurrent callers and rereads the native limits', async () => {
  const { usage, call } = fixture();
  const method = 'account/rateLimitResetCredit/consume';
  let available = 1;
  call.mockImplementation(async (rpc) => {
    if (rpc === method) {
      available--;
      return { outcome: 'reset' };
    }
    if (rpc === 'account/rateLimits/read')
      return {
        rateLimits: { primary: { usedPercent: available ? 90 : 0 } },
        rateLimitResetCredits: { availableCount: available },
      };
    return {};
  });
  const { key } = (await usage.read()).reset!;
  const [first, second] = await Promise.all([usage.redeem(key), usage.redeem(key)]);
  expect(first).toEqual(second);
  expect(await usage.redeem(key)).toEqual(first);
  expect(first.outcome).toBe('reset');
  expect(first.usage.reset).toBeUndefined();
  expect(first.usage.limits).toMatchObject({
    status: 'reported',
    value: { availableResets: 0, windows: [{ primary: { usedPercent: 0 } }] },
  });
  expect(call.mock.calls.filter(([rpc]) => rpc === method)).toEqual([
    [method, { idempotencyKey: key }, 15_000],
  ]);
});

it('keeps the native key after an uncertain response and rejects that key after an account change', async () => {
  const { driver, usage, call } = fixture();
  const method = 'account/rateLimitResetCredit/consume';
  let attempts = 0;
  call.mockImplementation(async (rpc) => {
    if (rpc === method) {
      if (++attempts === 1) throw new Error('provider details');
      return { outcome: 'alreadyRedeemed' };
    }
    if (rpc === 'account/rateLimits/read')
      return { rateLimitResetCredits: { availableCount: attempts ? 0 : 1 } };
    return {};
  });
  const { key } = (await usage.read()).reset!;
  await expect(usage.redeem(key)).rejects.toMatchObject({
    code: 'RESET_UNCERTAIN',
    uncertain: true,
    message: 'Codex could not confirm the reset. Retrying uses the same request.',
  });
  expect((await usage.read()).reset).toEqual({ key, retry: true });
  expect((await usage.redeem(key)).outcome).toBe('alreadyRedeemed');
  usage.invalidate();
  await expect(usage.redeem(key)).rejects.toMatchObject({ code: 'RESET_STALE' });
  vi.spyOn(driver, 'supportsMethod').mockImplementation((rpc) => rpc !== method);
  await expect(usage.redeem(key)).rejects.toMatchObject({ code: 'RESET_UNAVAILABLE' });
  expect(call.mock.calls.filter(([rpc]) => rpc === method).map(([, params]) => params)).toEqual([
    { idempotencyKey: key },
    { idempotencyKey: key },
  ]);
});

it('separates unsupported and failed reads and drops replies from an old account', async () => {
  const { driver, usage, call } = fixture();
  vi.spyOn(driver, 'supportsMethod').mockImplementation(
    (method) => method !== 'account/usage/read',
  );
  call.mockRejectedValueOnce(new Error('Account metadata unavailable'));
  expect(await usage.read()).toEqual({
    limits: { status: 'unavailable' },
    activity: { status: 'unsupported' },
  });
  usage.invalidate();
  let resolve!: (value: unknown) => void;
  const result = new Promise<unknown>((done) => {
    resolve = done;
  });
  call.mockReturnValueOnce(result);
  const pending = usage.read();
  usage.invalidate();
  resolve({ rateLimits: { primary: { usedPercent: 70 } } });
  expect((await pending).limits).toEqual({ status: 'unavailable' });
  expect(call.mock.calls.map(([method]) => method)).toEqual([
    'account/rateLimits/read',
    'account/rateLimits/read',
  ]);
});
