import { createWriteStream } from 'node:fs';
import { mkdtemp, rename, rm, stat } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../shared/errors.js';
import { databaseBackupLimitBytes, type RestoreStatus } from '../shared/workspace-settings.js';
import { pendingRestoreFile, validateRestoreFile } from './restore-database.js';

export class RestoreStaging {
  private operation?: Promise<RestoreStatus>;
  private readonly shutdown = new AbortController();
  private readonly path: string;

  constructor(private readonly directory: string) {
    this.path = join(directory, pendingRestoreFile);
  }

  async status(): Promise<RestoreStatus> {
    try {
      const { mtimeMs, size } = await stat(this.path);
      return { pending: { bytes: size, stagedAt: Math.round(mtimeMs) } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { pending: null };
      throw error;
    }
  }

  stage(request: IncomingMessage) {
    return this.exclusive(async () => {
      if ((await this.status()).pending)
        throw new AppError(
          'RESTORE_PENDING',
          'Remove the prepared backup before choosing another.',
          409,
        );
      const limit = () =>
        new AppError('RESTORE_LIMIT', 'Choose a SQLite backup up to 64 MiB.', 413);
      if (Number(request.headers['content-length']) > databaseBackupLimitBytes) throw limit();
      const scratch = await mkdtemp(join(this.directory, '.restore-upload-'));
      let bytes = 0;
      try {
        const path = join(scratch, pendingRestoreFile);
        const bounds = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            bytes += chunk.length;
            if (bytes > databaseBackupLimitBytes) done(limit());
            else done(null, chunk);
          },
        });
        const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(120_000)]);
        await pipeline(request, bounds, createWriteStream(path, { flags: 'wx', mode: 0o600 }), {
          signal,
        });
        await validateRestoreFile(path);
        signal.throwIfAborted();
        await rename(path, this.path);
        return await this.status();
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    });
  }

  clear(expected: NonNullable<RestoreStatus['pending']>) {
    return this.exclusive(async () => {
      const { pending } = await this.status();
      if (pending && (pending.stagedAt !== expected.stagedAt || pending.bytes !== expected.bytes))
        throw new AppError(
          'RESTORE_CHANGED',
          'The prepared backup changed. Refresh the restore status.',
          409,
        );
      await rm(this.path, { force: true });
      return { pending: null };
    });
  }

  async close() {
    this.shutdown.abort();
    if (this.operation) await Promise.allSettled([this.operation]);
  }

  private async exclusive(work: () => Promise<RestoreStatus>) {
    if (this.operation || this.shutdown.signal.aborted)
      throw new AppError('RESTORE_BUSY', 'A backup restore request is already in progress.', 409);
    this.operation = work();
    try {
      return await this.operation;
    } finally {
      this.operation = undefined;
    }
  }
}
