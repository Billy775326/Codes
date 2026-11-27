export type CodexLoginState =
  | { status: 'idle' | 'starting' | 'succeeded' | 'failed' }
  | { status: 'pending'; loginId: string; verificationUrl: string; userCode: string };
