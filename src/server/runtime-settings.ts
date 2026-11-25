import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.js';
import {
  runtimeRequestTimeout,
  runtimeSettingsSchema,
  type RuntimeSettingsSnapshot,
} from '../shared/runtime-settings.js';
import { readSettingsFile, writeSettingsFile } from './settings-file.js';

const update = z
  .object({ revision: z.number().int().nonnegative(), settings: runtimeSettingsSchema })
  .strict();
const file = update.extend({ version: z.literal(1) });

export class RuntimeConfiguration {
  readonly active;
  private saved: z.infer<typeof update>;
  private readonly path: string;
  private readonly executable: string;

  constructor(
    private readonly directory: string,
    env: NodeJS.ProcessEnv,
  ) {
    this.path = join(directory, 'runtime-settings.json');
    this.executable = env.CODES_CODEX_BINARY ?? 'codex';
    const content = readSettingsFile(this.path);
    if (content === undefined) {
      this.saved = {
        revision: 0,
        settings: runtimeSettingsSchema.parse({
          codeQuestions: true,
          requestTimeoutMs: Number(
            env.CODES_CODEX_REQUEST_TIMEOUT_MS ?? runtimeRequestTimeout.default,
          ),
        }),
      };
    } else {
      const { revision, settings } = file.parse(content);
      this.saved = { revision, settings };
    }
    this.active = this.saved.settings;
  }

  snapshot(): RuntimeSettingsSnapshot {
    return {
      ...this.saved,
      active: this.active,
      restartRequired: this.saved.settings.requestTimeoutMs !== this.active.requestTimeoutMs,
      dataDirectory: this.directory,
      executable: this.executable,
    };
  }

  save(input: unknown) {
    const parsed = update.safeParse(input);
    if (!parsed.success)
      throw new AppError('RUNTIME_SETTINGS_INVALID', parsed.error.issues[0]!.message);
    if (parsed.data.revision !== this.saved.revision)
      throw new AppError(
        'RUNTIME_SETTINGS_CONFLICT',
        'Runtime settings changed. Reload before saving.',
        409,
      );
    const { settings } = parsed.data;
    if (
      settings.codeQuestions === this.saved.settings.codeQuestions &&
      settings.requestTimeoutMs === this.saved.settings.requestTimeoutMs
    )
      return this.snapshot();
    const saved = { revision: this.saved.revision + 1, settings };
    writeSettingsFile(this.path, { version: 1, ...saved });
    this.saved = saved;
    return this.snapshot();
  }
}
