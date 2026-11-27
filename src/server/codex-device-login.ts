import { z } from 'zod';
import type { Driver } from '../codex/driver.js';
import type { CodexLoginState } from '../shared/codex-login.js';
import { AppError, record } from '../shared/errors.js';
import type { CodexAccount } from './codex-account.js';

const loginUnavailable = 'Browser sign-in is unavailable with this Codex CLI.';
const loginFailed = 'Could not start Codex sign-in. Check that device code login is enabled.';
const deviceChallenge = z.object({
  type: z.literal('chatgptDeviceCode'),
  loginId: z.uuid(),
  verificationUrl: z.literal('https://auth.openai.com/codex/device'),
  userCode: z.string().regex(/^[A-Z0-9-]{4,32}$/i),
});
type Attempt = {
  result: Promise<CodexLoginState>;
  completion?: { id: string; success: boolean };
};

/** Keeps the one active native sign-in attempt in memory for this workspace. */
export class CodexDeviceLogin {
  private state: CodexLoginState = { status: 'idle' };
  private starting?: Attempt;

  constructor(
    private driver: Driver,
    private account: CodexAccount,
  ) {}

  current(): CodexLoginState {
    return this.state;
  }

  reset() {
    this.starting = undefined;
    this.state = { status: 'idle' };
  }

  start(): Promise<CodexLoginState> {
    if (this.driver.state !== 'ready' || !this.driver.system().capabilities?.deviceLogin)
      throw new AppError('CODEX_LOGIN_UNAVAILABLE', loginUnavailable, 412);
    if (this.starting) return this.starting.result;
    if (this.state.status === 'pending') return Promise.resolve(this.state);
    this.state = { status: 'starting' };
    const attempt: Attempt = { result: this.startNative() };
    this.starting = attempt;
    attempt.result = attempt.result.finally(() => {
      if (this.starting === attempt) {
        this.starting = undefined;
        if (this.state.status === 'starting') this.state = { status: 'idle' };
      }
    });
    return attempt.result;
  }

  private async startNative(): Promise<CodexLoginState> {
    const epoch = this.driver.epoch;
    if ((await this.account.status('openai', true)) !== 'signed-out')
      throw new AppError('CODEX_LOGIN_STATE', 'Check Codex login status before signing in.', 409);
    if (this.driver.epoch !== epoch || this.driver.state !== 'ready')
      throw new AppError('CODEX_LOGIN_UNAVAILABLE', loginUnavailable, 412);
    const attempt = this.starting;
    let raw: unknown;
    try {
      raw = await this.driver.call('account/login/start', { type: 'chatgptDeviceCode' }, 15_000);
    } catch {
      throw new AppError('CODEX_LOGIN_START', loginFailed, 502);
    }
    if (this.starting !== attempt || this.driver.epoch !== epoch)
      throw new AppError('CODEX_LOGIN_UNAVAILABLE', loginUnavailable, 412);
    const challenge = deviceChallenge.safeParse(raw);
    if (!challenge.success) {
      if (record(raw) && z.uuid().safeParse(raw.loginId).success)
        await this.cancelNative(raw.loginId);
      throw new AppError('CODEX_LOGIN_START', loginFailed, 502);
    }
    const { loginId, userCode, verificationUrl } = challenge.data;
    this.state = { status: 'pending', loginId, userCode, verificationUrl };
    if (attempt?.completion?.id === loginId) this.complete(loginId, attempt.completion.success);
    return this.state;
  }

  complete(id: string, success: boolean) {
    if (this.state.status === 'pending' && this.state.loginId === id)
      this.state = { status: success ? 'succeeded' : 'failed' };
    else if (this.starting) this.starting.completion = { id, success };
  }

  async cancel(id: string) {
    if (this.state.status !== 'pending' || this.state.loginId !== id) return this.state;
    const state = this.state;
    const result = await this.cancelNative(id);
    if (this.state === state && result === 'canceled') this.state = { status: 'idle' };
    return this.state;
  }

  private async cancelNative(loginId: string) {
    try {
      const result = await this.driver.call('account/login/cancel', { loginId }, 5000);
      return result.status as unknown;
    } catch {
      throw new AppError('CODEX_LOGIN_CANCEL', 'Could not cancel Codex sign-in. Try again.', 502);
    }
  }
}
