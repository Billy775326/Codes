import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

export function readSettingsFile(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function writeSettingsFile(path: string, value: unknown) {
  writePrivateFile(path, JSON.stringify(value, null, 2) + '\n');
}

export function writePrivateFile(path: string, value: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, value, {
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
