import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';

export function fileVersion(stats: BigIntStats) {
  return createHash('sha256')
    .update([stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(':'))
    .digest('hex');
}
