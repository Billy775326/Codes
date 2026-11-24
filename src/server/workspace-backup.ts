import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, type DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../shared/errors.js';

import { databaseBackupLimitBytes } from '../shared/workspace-settings.js';
const exportDeadlineMs = 120_000;

export class WorkspaceBackup {
  private pending?: Promise<void>;
  private readonly shutdown = new AbortController();

  constructor(private readonly db: DatabaseSync) {}

  async download(response: ServerResponse) {
    if (this.pending || this.shutdown.signal.aborted)
      throw new AppError('BACKUP_BUSY', 'A database export is already in progress.', 409);
    this.pending = this.streamSnapshot(response);
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  async close() {
    this.shutdown.abort();
    // The request handler owns user-facing errors. Wait for SQLite before closing its connection.
    await Promise.allSettled(this.pending ? [this.pending] : []);
  }

  private async streamSnapshot(response: ServerResponse) {
    const oversized = () =>
      new AppError(
        'BACKUP_LIMIT',
        'This database exceeds the 64 MB download limit. Back it up on the server.',
        413,
      );
    const { size } = this.db
      .prepare('SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()')
      .get() as { size: number };
    if (size > databaseBackupLimitBytes) throw oversized();

    const directory = await mkdtemp(join(tmpdir(), 'codes-db-export-'));
    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(exportDeadlineMs)]);
    try {
      signal.throwIfAborted();
      if (response.destroyed) return;
      const path = join(directory, 'codes.sqlite');
      await backup(this.db, path);
      if (response.destroyed) return;
      const snapshot = await stat(path);
      signal.throwIfAborted();
      if (response.destroyed) return;
      if (snapshot.size > databaseBackupLimitBytes) throw oversized();
      const date = new Date().toISOString().slice(0, 10);
      response.writeHead(200, {
        'content-type': 'application/vnd.sqlite3',
        'content-disposition': `attachment; filename="codes-db-${date}.sqlite"`,
        'cache-control': 'private,no-store',
        'content-length': snapshot.size,
      });
      await pipeline(createReadStream(path), response, { signal });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
