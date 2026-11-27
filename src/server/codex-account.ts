import type { Driver } from '../codex/driver.js';
import { AppError, record } from '../shared/errors.js';
import type { CodexAccountStatus } from '../shared/types.js';

const accountTtlMs = 60_000;
const unknownTtlMs = 10_000;
export const codexSignInRequired = 'Codex is not signed in.';
export const codexAccountReload = 'Restart Codes to load the updated Codex login.';

type Account = { status: CodexAccountStatus; provider?: string };

export class CodexAccount {
  private revision = 0;
  private cached?: { epoch: string; value: Account; expiresAt: number };
  private checking?: { epoch: string; result: Promise<Account> };

  constructor(private driver: Driver) {}

  invalidate() {
    this.revision++;
    this.cached = undefined;
    this.checking = undefined;
  }

  async status(provider: string | undefined, force = false): Promise<CodexAccountStatus> {
    if (this.driver.state !== 'ready') return 'unknown';
    if (this.driver.mode === 'mock') return 'signed-in';
    const { epoch } = this.driver;
    if (!this.checking || this.checking.epoch !== epoch) {
      if (!force && this.cached?.epoch === epoch && this.cached.expiresAt > Date.now())
        return this.forProvider(this.cached.value, provider);
      const revision = this.revision;
      const result = this.read().then((value): Account => {
        if (revision !== this.revision || epoch !== this.driver.epoch) return { status: 'unknown' };
        this.cached = {
          epoch,
          value,
          expiresAt: Date.now() + (value.status === 'unknown' ? unknownTtlMs : accountTtlMs),
        };
        return value;
      });
      this.checking = { epoch, result };
      void result.then(() => {
        if (this.checking?.result === result) this.checking = undefined;
      });
    }
    return this.forProvider(await this.checking.result, provider);
  }

  async requireForSend(
    provider: string | undefined,
    threadProvider: string | null | undefined = provider,
  ) {
    // Only the built-in OpenAI provider has a verified account contract here.
    if (provider !== 'openai' || threadProvider !== 'openai') return;
    const status = await this.status(provider);
    if (status === 'signed-out')
      throw new AppError('CODEX_SIGN_IN_REQUIRED', codexSignInRequired, 409);
    if (status === 'reload-required')
      throw new AppError('CODEX_ACCOUNT_RELOAD', codexAccountReload, 409);
  }

  private forProvider(account: Account, provider: string | undefined): CodexAccountStatus {
    if (account.status === 'signed-in') return account.status;
    if (!provider || provider !== account.provider) return 'unknown';
    if (provider !== 'openai' && ['signed-out', 'reload-required'].includes(account.status))
      return 'unknown';
    return account.status;
  }

  private async read(): Promise<Account> {
    if (!this.driver.supportsMethod('account/read')) return { status: 'unknown' };
    try {
      const [raw, configuration] = await Promise.all([
        this.driver.call('account/read', { refreshToken: false }, 5000),
        this.driver.call('config/read', { includeLayers: false }, 5000),
      ]);
      const provider = effectiveModelProvider(configuration?.config);
      if (!record(raw) || typeof raw.requiresOpenaiAuth !== 'boolean') return { status: 'unknown' };
      if (!raw.requiresOpenaiAuth) return { status: 'not-required', provider };
      const signedIn = record(raw.account) && typeof raw.account.type === 'string';
      if (!signedIn && raw.account !== null) return { status: 'unknown' };
      // A CLI launched separately re-reads auth changed by terminal login/logout.
      // It can identify a stale App Server without reading or passing around credentials.
      const terminal = await this.driver.terminalLoginStatus();
      if (terminal !== undefined && terminal !== signedIn)
        return { status: 'reload-required', provider };
      return { status: signedIn ? 'signed-in' : 'signed-out', provider };
    } catch {
      // This optional metadata probe must not stop history or dispatch on older CLIs.
      return { status: 'unknown' };
    }
  }
}

export function effectiveModelProvider(config: unknown) {
  if (!record(config)) return;
  if (config.model_provider === null) return 'openai';
  if (typeof config.model_provider === 'string' && config.model_provider)
    return config.model_provider;
}
