import { z } from 'zod';

export const sessionHours = [1, 4, 12, 24, 72, 168] as const;
const projectDirectory = z.string().trim().max(2048);
const sessionValidity = z.literal(sessionHours);
export const workspaceSettingsSchema = z
  .object({
    defaultProjectDirectory: projectDirectory,
    sessionHours: sessionValidity,
  })
  .strict();
export const workspaceSettingsUpdate = z
  .object({
    revision: z.number().int().nonnegative(),
    settings: workspaceSettingsSchema,
  })
  .strict();
export const workspaceSettingsPatch = z.discriminatedUnion('field', [
  z
    .object({
      field: z.literal('defaultProjectDirectory'),
      expected: projectDirectory,
      value: projectDirectory,
    })
    .strict(),
  z
    .object({ field: z.literal('sessionHours'), expected: sessionValidity, value: sessionValidity })
    .strict(),
]);
export type WorkspaceSettingsSnapshot = z.infer<typeof workspaceSettingsUpdate>;
export const diagnosticMinutes = [5, 15, 30] as const;
export type DiagnosticsStatus = { expiresAt: number | null; serverOverride: boolean };
export const databaseBackupLimitBytes = 64 * 1024 * 1024;
export type RestoreStatus = { pending: null | { bytes: number; stagedAt: number } };
