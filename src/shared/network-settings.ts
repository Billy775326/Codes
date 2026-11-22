import { z } from 'zod';

export const loopbackHosts = ['127.0.0.1', 'localhost', '::1'] as const;

export type CloudflareAccess = { authMode: 'cloudflare-access'; issuer: string; audience: string };

export type NetworkSettings = {
  host: (typeof loopbackHosts)[number];
  port: number;
  origins: string[];
} & ({ authMode: 'local' } | CloudflareAccess);

export type NetworkSettingsSnapshot = {
  revision: number;
  settings: NetworkSettings;
  active: NetworkSettings;
  restartRequired: boolean;
};

function normalizeOrigin(value: string) {
  // Check the input before URL parsing can discard a path, credentials or an empty query.
  if (!/^https?:\/\/[^\s/\\?\x23@%]+\/?$/i.test(value)) return undefined;
  const url = URL.parse(value);
  if (!url || url.hostname.includes('*')) return undefined;
  return url.origin;
}

const listenerSchema = z.object({
  host: z.enum(loopbackHosts, { message: 'Choose 127.0.0.1, localhost, or ::1.' }),
  port: z.number().int().min(1).max(65535, { message: 'Choose a port from 1 to 65535.' }),
  origins: z
    .array(z.string().trim().max(512))
    .min(1, 'Enter at least one allowed address.')
    .max(32)
    .transform((values, context) => {
      const origins = new Set<string>();
      for (const [index, value] of values.entries()) {
        const origin = normalizeOrigin(value);
        if (!origin) {
          context.addIssue({
            code: 'custom',
            message: `Allowed address ${index + 1} must contain only an HTTP(S) scheme, host, and optional port.`,
          });
          return z.NEVER;
        }
        origins.add(origin);
      }
      return [...origins];
    }),
});
export const networkSettingsSchema = z.discriminatedUnion('authMode', [
  listenerSchema.extend({ authMode: z.literal('local') }).strict(),
  listenerSchema
    .extend({
      authMode: z.literal('cloudflare-access'),
      issuer: z
        .string()
        .trim()
        .regex(
          /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com\/?$/i,
          'Enter a team URL like https://your-team.cloudflareaccess.com.',
        )
        .transform((value) => new URL(value).origin),
      audience: z
        .string()
        .trim()
        .regex(/^[a-f0-9]{64}$/i, 'Enter the 64-character Application Audience (AUD) tag.'),
    })
    .strict()
    .refine((value) => value.origins.every((origin) => origin.startsWith('https://')), {
      message: 'All allowed addresses must use HTTPS in Cloudflare Access mode.',
      path: ['origins'],
    }),
]);
export const networkSettingsTransferSchema = z
  .object({
    format: z.literal('codes-network-settings'),
    version: z.literal(1),
    settings: networkSettingsSchema,
  })
  .strict();
