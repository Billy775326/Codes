import { z } from 'zod';
import type { Driver } from '../codex/driver.js';
import { record } from '../shared/errors.js';
import type {
  AccountActivity,
  AccountLimits,
  CodexUsageSnapshot,
  UsageRead,
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

export class CodexUsage {
  private revision = 0;
  private cached?: { epoch: string; value: CodexUsageSnapshot; expiresAt: number };
  private pending?: { epoch: string; value: Promise<CodexUsageSnapshot> };

  constructor(private driver: Driver) {}

  invalidate() {
    this.revision++;
    this.cached = undefined;
    this.pending = undefined;
  }

  async read(refresh = false): Promise<CodexUsageSnapshot> {
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
