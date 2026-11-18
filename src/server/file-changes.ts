import { limits, type FileChange } from '../shared/types.js';
import { record } from '../shared/errors.js';

/** A single item has one shared patch budget, including multi-file edits. */
export function fileChanges(raw: unknown): { files: FileChange[]; truncated: boolean } {
  const files: FileChange[] = [];
  let remaining = limits.item;
  let truncated = false;
  if (!Array.isArray(raw)) return { files, truncated };
  for (const value of raw) {
    if (!record(value) || typeof value.path !== 'string' || typeof value.diff !== 'string')
      continue;
    if (files.length >= 100) {
      truncated = true;
      break;
    }
    const diff = value.diff.slice(0, remaining);
    remaining -= diff.length;
    const clipped = diff.length < value.diff.length;
    truncated ||= clipped;
    const kind = record(value.kind) ? value.kind : {};
    files.push({
      path: value.path.slice(0, 2048),
      kind: kind.type === 'add' || kind.type === 'delete' ? kind.type : 'update',
      movePath: typeof kind.movePath === 'string' ? kind.movePath.slice(0, 2048) : undefined,
      diff,
      truncated: clipped,
    });
  }
  return { files, truncated };
}
