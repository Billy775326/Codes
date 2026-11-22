import { z } from 'zod';

export const runtimeRequestTimeout = { min: 1_000, max: 300_000, default: 30_000 } as const;
export const runtimeSettingsSchema = z
  .object({
    codeQuestions: z.boolean(),
    requestTimeoutMs: z
      .number()
      .int()
      .min(runtimeRequestTimeout.min, 'Enter a timeout of at least 1,000 milliseconds.')
      .max(runtimeRequestTimeout.max, 'Enter a timeout of at most 300,000 milliseconds.'),
  })
  .strict();
export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>;

export type RuntimeSettingsSnapshot = {
  revision: number;
  settings: RuntimeSettings;
  active: RuntimeSettings;
  restartRequired: boolean;
  dataDirectory: string;
  executable: string;
};
