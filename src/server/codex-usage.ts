import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Driver } from '../codex/driver.js';
import { AppError, record } from '../shared/errors.js';
import { usageResetOutcomes } from '../shared/codex-usage.js';
import type {
  AccountActivity,
  AccountLimits,
  CodexUsageSnapshot,
  UsageRead,
  UsageResetResult,
  UsageWindow,
} from '../shared/codex-usage.js';

const count = z.number().int().nonnegative();
const timestamp = z.number().int().positive().max(253_402_300_799);
const windowSchema = z.object({
  usedPercent: z.number().nonnegative(),
  windowDurationMins: z.number().int().positive().nullish(),
  resetsAt: timestamp.nullish(),
});
const label = z.string().trim().min(1).max(96);
const bucketSchema = z.object({
  limitId: label.nullish(),
  limitName: label.nullish(),
  planType: label.nullish(),
  primary: windowSchema.nullish(),
  secondary: windowSchema.nullish(),
  credits: z.object({ balance: label.nullish(), unlimited: z.boolean().optional() }).nullish(),
});
const activitySchema = z.object({
  summary: z.object({ lifetimeTokens: count.nullish() }).nullish(),
  dailyUsageBuckets: z.array(z.unknown()).nullish(),
});
const daySchema = z.object({ startDate: z.iso.date(), tokens: count });
const resetCreditSchema = z.object({
  status: z.enum(['available', 'redeeming', 'redeemed', 'unknown']),
  grantedAt: timestamp,
  expiresAt: timestamp.nullish(),
  title: z.string().trim().max(96).nullish().catch(undefined),
});

function usageWindow(
  window: z.infer<typeof windowSchema> | null | undefined,
): UsageWindow | undefined {
  if (!window) return;
  return {
    usedPercent: Math.min(100, window.usedPercent),
    durationMins: window.windowDurationMins ?? undefined,
    resetsAt: window.resetsAt ?? undefined,
  };
}

function accountLimits(raw: unknown): AccountLimits | undefined {
  if (!record(raw)) return;
  const buckets = new Map<string, z.infer<typeof bucketSchema>>();
  const readBucket = (id: string, value: unknown) => {
    const parsed = bucketSchema.safeParse(value);
    if (parsed.success) buckets.set(parsed.data.limitId ?? id, parsed.data);
  };
  readBucket('codex', raw.rateLimits);
  if (record(raw.rateLimitsByLimitId))
    for (const [id, value] of Object.entries(raw.rateLimitsByLimitId).slice(0, 16))
      if (label.safeParse(id).success) readBucket(id, value);
  const preferred = buckets.get('codex') ?? buckets.values().next().value;
  const windows = [...buckets].flatMap(([id, bucket]) =>
    bucket.primary || bucket.secondary
      ? [
          {
            id,
            name: bucket.limitName ?? undefined,
            primary: usageWindow(bucket.primary),
            secondary: usageWindow(bucket.secondary),
          },
        ]
      : [],
  );
  const resetSummary = record(raw.rateLimitResetCredits) ? raw.rateLimitResetCredits : undefined;
  const resets = count.safeParse(resetSummary?.availableCount).data;
  const resetCredits = Array.isArray(resetSummary?.credits)
    ? resetSummary.credits.slice(0, 16).flatMap((entry: unknown) => {
        const parsed = resetCreditSchema.safeParse(entry);
        return parsed.success ? [{ ...parsed.data, title: parsed.data.title || undefined }] : [];
      })
    : undefined;
  if (!preferred && resets === undefined) return;
  return {
    plan: preferred?.planType ?? undefined,
    windows,
    creditBalance: preferred?.credits?.balance ?? undefined,
    unlimitedCredits: preferred?.credits?.unlimited,
    availableResets: resets,
    resetCredits,
  };
}

function accountActivity(raw: unknown): AccountActivity | undefined {
  const parsed = activitySchema.safeParse(raw);
  if (!parsed.success) return;
  const lifetimeTokens = parsed.data.summary?.lifetimeTokens ?? undefined;
  const days = parsed.data.dailyUsageBuckets ?? undefined;
  if (!days && lifetimeTokens === undefined) return;
  const byDay = new Map<string, number>();
  for (const entry of days ?? []) {
    const parsedDay = daySchema.safeParse(entry);
    if (parsedDay.success) byDay.set(parsedDay.data.startDate, parsedDay.data.tokens);
  }
  return {
    days:
      days?.length && !byDay.size
        ? undefined
        : days &&
          [...byDay]
            .sort(([a], [b]) => b.localeCompare(a))
            .slice(0, 7)
            .map(([date, tokens]) => ({ date, tokens })),
    lifetimeTokens,
  };
}

const unavailable = {
  limits: { status: 'unavailable' },
  activity: { status: 'unavailable' },
} as const;
const cacheTtlMs = 30_000;
const refreshCooldownMs = 5000;
const consumeReset = 'account/rateLimitResetCredit/consume';
const nativeResetResult = z.object({ outcome: z.enum(usageResetOutcomes) });
type ResetAttempt = {
  key: string;
  epoch: string;
  retry: boolean;
};

export class CodexUsage {
  private revision = 0;
  private cached?: { epoch: string; value: CodexUsageSnapshot; expiresAt: number };
  private pending?: { epoch: string; value: Promise<CodexUsageSnapshot> };
  private reset?: ResetAttempt;
  private lastReset?: Pick<ResetAttempt, 'key' | 'epoch'> & {
    outcome: UsageResetResult['outcome'];
  };
  private pendingReset?: { attempt: ResetAttempt; result: Promise<UsageResetResult> };

  constructor(private driver: Driver) {}

  get redeeming() {
    return !!this.pendingReset;
  }

  invalidate() {
    this.reset = undefined;
    this.lastReset = undefined;
    this.clearReads();
  }

  private clearReads() {
    this.revision++;
    this.cached = undefined;
    this.pending = undefined;
  }

  async read(refresh = false): Promise<CodexUsageSnapshot> {
    const revision = this.revision;
    const epoch = this.driver.epoch;
    const value = await this.readSnapshot(refresh);
    if (this.revision !== revision || this.driver.epoch !== epoch) return unavailable;
    if (!this.canReset()) return value;
    const hasCredit =
      value.limits.status === 'reported' && (value.limits.value.availableResets ?? 0) > 0;
    if (this.reset?.epoch !== epoch) this.reset = undefined;
    if (hasCredit && !this.reset) this.reset = { epoch, key: randomUUID(), retry: false };
    if (!this.reset || (!hasCredit && !this.reset.retry)) return value;
    return { ...value, reset: { key: this.reset.key, retry: this.reset.retry } };
  }

  async redeem(key: string): Promise<UsageResetResult> {
    if (!this.canReset())
      throw new AppError('RESET_UNAVAILABLE', 'Reset redemption is unavailable.', 412);
    const epoch = this.driver.epoch;
    if (this.lastReset?.key === key && this.lastReset.epoch === epoch)
      return { outcome: this.lastReset.outcome, usage: await this.read() };
    const attempt = this.reset;
    if (!attempt || attempt.key !== key || attempt.epoch !== epoch)
      throw new AppError('RESET_STALE', 'Usage has changed. Review the current limits.', 409);
    if (this.pendingReset?.attempt === attempt) return this.pendingReset.result;
    if (this.pendingReset) throw new AppError('RESET_BUSY', 'A reset is already in progress.', 409);
    const result = this.consume(attempt).finally(() => {
      this.pendingReset = undefined;
    });
    this.pendingReset = { attempt, result };
    return result;
  }

  private canReset() {
    return (
      this.driver.state === 'ready' &&
      this.driver.mode !== 'mock' &&
      this.driver.supportsMethod(consumeReset)
    );
  }

  private async consume(attempt: ResetAttempt): Promise<UsageResetResult> {
    let outcome: UsageResetResult['outcome'];
    try {
      const result = await this.driver.call(consumeReset, { idempotencyKey: attempt.key }, 15_000);
      outcome = nativeResetResult.parse(result).outcome;
      if (this.reset !== attempt || this.driver.epoch !== attempt.epoch)
        throw new Error('The Codex account changed during redemption.');
    } catch {
      attempt.retry = true;
      this.clearReads();
      throw new AppError(
        'RESET_UNCERTAIN',
        'Codex could not confirm the reset. Retrying uses the same request.',
        502,
        true,
      );
    }
    this.lastReset = { key: attempt.key, epoch: attempt.epoch, outcome };
    this.reset = undefined;
    this.clearReads();
    return { outcome, usage: await this.read() };
  }

  private async readSnapshot(refresh: boolean): Promise<CodexUsageSnapshot> {
    if (this.driver.state !== 'ready' || this.driver.mode === 'mock') return unavailable;
    const { epoch } = this.driver;
    const now = Date.now();
    if (this.pending?.epoch === epoch) return this.pending.value;
    if (
      this.cached?.epoch === epoch &&
      this.cached.expiresAt > now &&
      (!refresh || this.cached.expiresAt - now > cacheTtlMs - refreshCooldownMs)
    )
      return this.cached.value;
    const revision = this.revision;
    const value = Promise.all([
      this.readMetric('account/rateLimits/read', accountLimits),
      this.readMetric('account/usage/read', accountActivity),
    ])
      .then(([limits, activity]) => {
        if (revision !== this.revision || epoch !== this.driver.epoch) return unavailable;
        const value = { limits, activity };
        this.cached = { epoch, value, expiresAt: Date.now() + cacheTtlMs };
        return value;
      })
      .finally(() => {
        if (this.pending?.value === value) this.pending = undefined;
      });
    this.pending = { epoch, value };
    return value;
  }

  private async readMetric<T>(
    method: string,
    map: (raw: unknown) => T | undefined,
  ): Promise<UsageRead<T>> {
    if (!this.driver.supportsMethod(method)) return { status: 'unsupported' };
    try {
      const value = map(await this.driver.call(method, undefined, 5000));
      return value === undefined ? { status: 'unavailable' } : { status: 'reported', value };
    } catch {
      // Account metadata failures must stay out of task dispatch and can contain private provider details.
      return { status: 'unavailable' };
    }
  }
}
