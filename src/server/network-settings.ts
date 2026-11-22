import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.js';
import {
  networkSettingsSchema,
  type NetworkSettings,
  type NetworkSettingsSnapshot,
} from '../shared/network-settings.js';
import { readSettingsFile, writeSettingsFile } from './settings-file.js';

const updateSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    settings: networkSettingsSchema,
  })
  .strict();
const fileSchema = updateSchema.extend({ version: z.literal(1) });

export class NetworkConfiguration {
  readonly active: NetworkSettings;
  private saved: z.infer<typeof updateSchema>;
  private readonly path: string;

  constructor(directory: string, env: NodeJS.ProcessEnv) {
    this.path = join(directory, 'network-settings.json');
    const contents = readSettingsFile(this.path);
    if (contents !== undefined) {
      const { revision, settings } = fileSchema.parse(contents);
      this.saved = { revision, settings };
    } else {
      const port = Number(env.CODES_PORT ?? 6670);
      this.saved = {
        revision: 0,
        settings: networkSettingsSchema.parse({
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
    writeSettingsFile(this.path, { version: 1, ...saved });
    this.saved = saved;
    return this.snapshot();
  }
}
