import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.js';
import {
  loopbackHosts,
  type NetworkSettings,
  type NetworkSettingsSnapshot,
} from '../shared/network-settings.js';

function normalizeOrigin(value: string) {
  // Check the input before URL parsing can discard a path, credentials or an empty query.
  if (!/^https?:\/\/[^\s/\\?\x23@%]+\/?$/i.test(value)) return undefined;
  const url = URL.parse(value);
  if (!url || url.hostname.includes('*')) return undefined;
  return url.origin;
}

const settingsSchema = z
  .object({
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
    authMode: z.literal('local'),
  })
  .strict();
const updateSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    settings: settingsSchema,
  })
  .strict();
const fileSchema = updateSchema.extend({ version: z.literal(1) });

export class NetworkConfiguration {
  readonly active: NetworkSettings;
  private saved: z.infer<typeof updateSchema>;
  private readonly path: string;

  constructor(directory: string, env: NodeJS.ProcessEnv) {
    this.path = join(directory, 'network-settings.json');
    let contents: string | undefined;
    try {
      contents = readFileSync(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (contents !== undefined) {
      const { revision, settings } = fileSchema.parse(JSON.parse(contents));
      this.saved = { revision, settings };
    } else {
      const port = Number(env.CODES_PORT ?? 6670);
      this.saved = {
        revision: 0,
        settings: settingsSchema.parse({
          host: env.CODES_HOST ?? '127.0.0.1',
          port,
          origins:
            env.CODES_PUBLIC_ORIGIN === undefined
              ? [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]
              : [env.CODES_PUBLIC_ORIGIN],
          authMode: 'local',
        }),
      };
    }
    this.active = this.saved.settings;
  }

  snapshot(): NetworkSettingsSnapshot {
    return {
      ...this.saved,
      active: this.active,
      restartRequired: JSON.stringify(this.saved.settings) !== JSON.stringify(this.active),
    };
  }

  save(input: unknown) {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError('NETWORK_SETTINGS_INVALID', parsed.error.issues[0]!.message);
    if (parsed.data.revision !== this.saved.revision)
      throw new AppError(
        'NETWORK_SETTINGS_CONFLICT',
        'Network settings changed. Reload before saving.',
        409,
      );
    if (JSON.stringify(parsed.data.settings) === JSON.stringify(this.saved.settings))
      return this.snapshot();

    const saved = { ...parsed.data, revision: parsed.data.revision + 1 };
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, ...saved }, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx',
      });
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
    this.saved = saved;
    return this.snapshot();
  }
}
