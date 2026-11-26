import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import type { DirectoryStatus, Project } from '../shared/types.js';
import { AppError, record } from '../shared/errors.js';

/** Directory health is separate from saved history and native execution permissions. */
export async function directoryStatus(project: Project): Promise<DirectoryStatus> {
  try {
    const canonical = await realpath(project.path);
    if (canonical !== project.path || !(await stat(canonical)).isDirectory()) return unavailable();
    await access(canonical, constants.X_OK);
    return { available: true };
  } catch (error) {
    if (record(error) && ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return unavailable();
    if (record(error) && ['EACCES', 'EPERM'].includes(error.code))
      return {
        available: false,
        code: 'DIRECTORY_ACCESS',
        message:
          'The working directory cannot be accessed. Check its permissions or choose another directory.',
      };
    throw error;
  }
}
function unavailable(): DirectoryStatus {
  return {
    available: false,
    code: 'DIRECTORY_UNAVAILABLE',
    message: 'The working directory is unavailable. Restore it or choose another directory.',
  };
}
export function directoryError(status: DirectoryStatus) {
  return new AppError(
    status.code!,
    status.message!,
    status.code === 'DIRECTORY_ACCESS' ? 403 : 409,
  );
}
