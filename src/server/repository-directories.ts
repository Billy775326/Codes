import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** Resolve linked Git worktrees for the native Repo filter. */
export async function repositoryDirectories(cwd: string) {
  try {
    const { stdout } = await execute('git', ['worktree', 'list', '--porcelain', '-z'], {
      cwd,
      timeout: 1500,
      maxBuffer: 64 * 1024,
    });
    const directories = new Set<string>();
    for (const line of stdout.split('\0')) {
      if (!line.startsWith('worktree ')) continue;
      const path = await realpath(line.slice('worktree '.length)).catch(() => undefined);
      if (path) directories.add(path);
    }
    return [...directories].sort();
  } catch {
    // A missing directory, missing Git, or a non-repository only removes the Repo option.
    return [];
  }
}
