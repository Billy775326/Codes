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
          rateLimitResetCredits: { availableCount: 0, credits: [{ id: 'private-reset' }] },
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
    limits: {
      status: 'reported',
      value: {
        plan: 'plus',
        creditBalance: '10.5',
        unlimitedCredits: false,
        availableResets: 0,
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
