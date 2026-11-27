export interface UsageWindow {
  usedPercent: number;
  durationMins?: number;
  resetsAt?: number;
}

export interface UsageLimit {
  id: string;
  name?: string;
  primary?: UsageWindow;
  secondary?: UsageWindow;
}

export interface UsageResetCredit {
  status: 'available' | 'redeeming' | 'redeemed' | 'unknown';
  grantedAt: number;
  expiresAt?: number | null;
  title?: string;
}

export interface AccountLimits {
  plan?: string;
  windows: UsageLimit[];
  creditBalance?: string;
  unlimitedCredits?: boolean;
  availableResets?: number;
  resetCredits?: UsageResetCredit[];
}

export interface AccountActivity {
  days?: { date: string; tokens: number }[];
  lifetimeTokens?: number;
}

export type UsageRead<T> =
  { status: 'reported'; value: T } | { status: 'unsupported' | 'unavailable' };

export interface CodexUsageSnapshot {
  limits: UsageRead<AccountLimits>;
  activity: UsageRead<AccountActivity>;
}
