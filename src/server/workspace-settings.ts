import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.js';
import {
  workspaceSettingsPatch,
  workspaceSettingsUpdate,
  type WorkspaceSettingsSnapshot,
} from '../shared/workspace-settings.js';
import { readSettingsFile, writeSettingsFile } from './settings-file.js';

const schema = workspaceSettingsUpdate.extend({ version: z.literal(1) });

export class WorkspaceConfiguration {
  private saved: WorkspaceSettingsSnapshot;
  private readonly path: string;

  constructor(directory: string) {
    this.path = join(directory, 'workspace-settings.json');
    const content = readSettingsFile(this.path);
    if (content === undefined) {
      this.saved = { revision: 0, settings: { defaultProjectDirectory: '', sessionHours: 12 } };
    } else {
      const { revision, settings } = schema.parse(content);
      this.saved = { revision, settings };
    }
  }

  snapshot() {
    return this.saved;
  }

  async save(input: unknown) {
    const patch = workspaceSettingsPatch.parse(input);
    const checkExpected = () => {
      if (patch.expected !== this.saved.settings[patch.field])
        throw new AppError(
          'WORKSPACE_SETTINGS_CONFLICT',
          'Workspace settings changed. Reload before saving.',
          409,
        );
    };
    checkExpected();
    if (patch.value === patch.expected) return this.snapshot();
    if (patch.field === 'defaultProjectDirectory' && patch.value) {
      if (!isAbsolute(patch.value))
        throw new AppError('PROJECT_DIRECTORY', 'Enter an absolute path to an existing directory.');
      try {
        patch.value = await realpath(patch.value);
        if (!(await stat(patch.value)).isDirectory()) throw new Error('Expected a directory.');
      } catch {
        throw new AppError('PROJECT_DIRECTORY', 'Enter an absolute path to an existing directory.');
      }
    }
    checkExpected();
    if (patch.value === patch.expected) return this.snapshot();
    const saved = {
      revision: this.saved.revision + 1,
      settings: { ...this.saved.settings, [patch.field]: patch.value },
    };
    writeSettingsFile(this.path, { version: 1, ...saved });
    this.saved = saved;
    return this.snapshot();
  }
}
