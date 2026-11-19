import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { WriteBoundary } from '../codex/write-boundary.js';
import { AppError } from '../shared/errors.js';

export function taskWriteBoundary(directory: string, environmentRoot?: string) {
  const path = join(directory, 'task-policy.json');
  let fileRoot: string | undefined;
  if (existsSync(path)) {
    const parsed = z
      .object({ version: z.literal(1), writeRoot: z.string().min(1) })
      .strict()
      .safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success)
      throw new AppError(
        'TASK_POLICY',
        'Invalid task-policy.json; startup stopped without changing it.',
      );
    fileRoot = parsed.data.writeRoot;
  }
  if (
    fileRoot &&
    environmentRoot &&
    new WriteBoundary(fileRoot).root !== new WriteBoundary(environmentRoot).root
  )
    throw new AppError('TASK_POLICY', 'Task write root conflicts with the persisted owner policy.');
  const root = fileRoot ?? environmentRoot;
  return root ? new WriteBoundary(root) : undefined;
}
