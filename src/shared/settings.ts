import { z } from 'zod';

export const settingsSchema = z
  .object({
    model: z.string().min(1).max(150).optional(),
    effort: z.string().min(1).max(80).optional(),
    fast: z.boolean().optional(),
    mode: z.enum(['default', 'plan']).optional(),
    permission: z.enum(['read-only', 'workspace-write', 'danger-full-access']),
  })
  .strict();
export const settingsProfileInput = z
  .object({
    revision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
    settings: settingsSchema,
  })
  .strict();
export const settingsProfileSchema = settingsProfileInput.extend({
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
