import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function claim(path: string) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, String(process.pid));
  } catch (error) {
    unlinkSync(path);
    throw error;
  } finally {
    closeSync(fd);
  }
}

export function acquireDataDirectoryLock(directory: string) {
  const path = join(directory, 'server.lock');
  try {
    claim(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

    // Serialize stale-lock removal. A starter that wins the subsequent exclusive open
    // owns the directory even if it was another process that reaped the expired lock.
    const recovery = path + '.recovery';
    try {
      claim(recovery);
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('The data directory is already in use.');
      throw failure;
    }
    try {
      let owner: string | undefined;
      try {
        owner = readFileSync(path, 'utf8');
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure;
      }
      if (owner !== undefined) {
        const pid = Number(owner);
        if (!Number.isSafeInteger(pid) || pid <= 0)
          throw new Error('Invalid data directory lock. Inspect it before starting.');
        try {
          process.kill(pid, 0);
          throw new Error('The data directory is already in use.');
        } catch (failure) {
          if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') throw failure;
          unlinkSync(path);
        }
      }
      try {
        claim(path);
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code === 'EEXIST')
          throw new Error('The data directory is already in use.');
        throw failure;
      }
    } finally {
      unlinkSync(recovery);
    }
  }
  return () => unlinkSync(path);
}
