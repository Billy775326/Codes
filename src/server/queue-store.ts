import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { QueueItem, QueuePayload, QueueState } from '../shared/types.js';
import { AppError } from '../shared/errors.js';

export const queueSchema = `
 CREATE TABLE IF NOT EXISTS queued_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
  thread_id TEXT NOT NULL REFERENCES threads(id), digest TEXT NOT NULL,
  payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', error TEXT,
  created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS queue_thread ON queued_messages(thread_id,seq);
 CREATE TABLE IF NOT EXISTS queue_controls (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id), paused INTEGER NOT NULL DEFAULT 0, reason TEXT);
`;
export class QueueStore {
  constructor(private db: DatabaseSync) {}
  count(threadId: string) {
    return (
      this.db
        .prepare(
          "SELECT count(*) AS count FROM queued_messages WHERE thread_id=? AND state NOT IN ('completed','cancelled')",
        )
        .get(threadId) as any
    ).count as number;
  }
  /** Sidebar metadata never reads or broadcasts queued message bodies. */
  summary(threadId: string) {
    const row = this.db
      .prepare(
        `
      SELECT count(*) AS count,
        coalesce(max(state='unknown'),0) AS unknown_result,
        coalesce(max(state='failed'),0) AS failed,
        coalesce((SELECT paused FROM queue_controls WHERE thread_id=?),0) AS paused
      FROM queued_messages WHERE thread_id=? AND state NOT IN ('completed','cancelled')
    `,
      )
      .get(threadId, threadId) as {
      count: number;
      unknown_result: number;
      failed: number;
      paused: number;
    };
    return {
      queueCount: row.count,
      queuePaused: !!row.paused,
      queueIssue: row.unknown_result
        ? ('unknown' as const)
        : row.failed
          ? ('failed' as const)
          : undefined,
    };
  }
  state(threadId: string): QueueState {
    const control = this.db
      .prepare('SELECT paused,reason FROM queue_controls WHERE thread_id=?')
      .get(threadId) as any;
    const rows = this.db
      .prepare(
        "SELECT * FROM queued_messages WHERE thread_id=? AND state NOT IN ('completed','cancelled') ORDER BY seq LIMIT 10",
      )
      .all(threadId) as any[];
    return {
      paused: !!control?.paused,
      reason: control?.reason ?? undefined,
      items: rows.map((row) => {
        const entry = this.map(row);
        return {
          ...entry,
          text: entry.text.slice(0, 2000),
          textTruncated: entry.text.length > 2000,
        };
      }),
    };
  }
  private map(row: any): QueueItem {
    return {
      id: row.id,
      threadId: row.thread_id,
      ...JSON.parse(row.payload),
      state: row.state,
      error: row.error ?? undefined,
      createdAt: row.created_at,
    };
  }
  get(id: string): QueueItem | undefined {
    const row = this.db.prepare('SELECT * FROM queued_messages WHERE id=?').get(id);
    return row ? this.map(row) : undefined;
  }
  add(id: string, threadId: string, payload: QueuePayload) {
    const digest = createHash('sha256')
      .update(JSON.stringify({ threadId, ...payload }))
      .digest('hex');
    const existing = this.db
      .prepare('SELECT digest FROM queued_messages WHERE id=?')
      .get(id) as any;
    if (existing) {
      if (existing.digest !== digest)
        throw new AppError(
          'OPERATION_CONFLICT',
          'This queue ID was already used for different input.',
          409,
        );
      return this.get(id)!;
    }
    const total = (
      this.db
        .prepare(
          "SELECT count(*) AS count FROM queued_messages WHERE state NOT IN ('completed','cancelled')",
        )
        .get() as any
    ).count;
    if (this.count(threadId) >= 10 || total >= 100)
      throw new AppError(
        'QUEUE_LIMIT',
        'The queue is full. Remove a waiting message before adding another.',
        429,
      );
    this.db
      .prepare(
        'INSERT INTO queued_messages(id,thread_id,digest,payload,created_at) VALUES(?,?,?,?,?)',
      )
      .run(id, threadId, digest, JSON.stringify(payload), Date.now());
    return this.get(id)!;
  }
  pendingThreads(): string[] {
    return (
      this.db
        .prepare(
          "SELECT DISTINCT thread_id FROM queued_messages WHERE state='queued' ORDER BY seq LIMIT 100",
        )
        .all() as any[]
    ).map((row) => row.thread_id);
  }
  edit(id: string, threadId: string, text: string) {
    if (Buffer.byteLength(text) > 100_000)
      throw new AppError('INPUT_LIMIT', 'The queued text exceeds 100 KB.');
    const entry = this.get(id);
    if (!entry || entry.threadId !== threadId)
      throw new AppError('NOT_FOUND', 'Queued message not found.', 404);
    if (!text.trim() && !entry.attachments.some((item) => item.kind === 'image'))
      throw new AppError('INPUT_REQUIRED', 'Enter a message or attach an image.');
    if (entry.state !== 'queued')
      throw new AppError('QUEUE_STARTED', 'Only a waiting message can be edited.', 409);
    this.db
      .prepare("UPDATE queued_messages SET payload=? WHERE id=? AND state='queued'")
      .run(JSON.stringify({ text, settings: entry.settings, attachments: entry.attachments }), id);
  }
  cancel(id: string, threadId: string) {
    const entry = this.get(id);
    if (!entry || entry.threadId !== threadId)
      throw new AppError('NOT_FOUND', 'Queued message not found.', 404);
    if (!['queued', 'failed', 'cancelled'].includes(entry.state))
      throw new AppError(
        'QUEUE_STARTED',
        'This message may already be executing. Check its result or stop the task.',
        409,
      );
    this.set(id, 'cancelled');
  }
  set(id: string, state: QueueItem['state'], error?: string) {
    this.db
      .prepare('UPDATE queued_messages SET state=?,error=? WHERE id=?')
      .run(state, error ?? null, id);
  }
  pause(threadId: string, reason?: string) {
    this.db
      .prepare(
        'INSERT INTO queue_controls VALUES(?,1,?) ON CONFLICT(thread_id) DO UPDATE SET paused=1,reason=excluded.reason',
      )
      .run(threadId, reason ?? 'Paused by you.');
  }
  resume(threadId: string) {
    this.db
      .prepare(
        'INSERT INTO queue_controls VALUES(?,0,NULL) ON CONFLICT(thread_id) DO UPDATE SET paused=0,reason=NULL',
      )
      .run(threadId);
  }
  pauseAll(reason: string) {
    for (const row of this.db
      .prepare(
        "SELECT DISTINCT thread_id FROM queued_messages WHERE state NOT IN ('completed','cancelled')",
      )
      .all() as any[])
      this.pause(row.thread_id, reason);
  }
  recover() {
    this.db
      .exec(`UPDATE queued_messages SET state='unknown',error='Check the execution receipt before continuing.' WHERE state IN ('dispatching','sent');
   INSERT INTO queue_controls SELECT DISTINCT thread_id,1,'Service restarted. Review and resume waiting messages.' FROM queued_messages WHERE state NOT IN ('completed','cancelled')
    ON CONFLICT(thread_id) DO UPDATE SET paused=1,reason='Service restarted. Review and resume waiting messages.';`);
  }
  prune() {
    this.db
      .prepare(
        "DELETE FROM queued_messages WHERE state IN ('completed','cancelled') AND created_at<?",
      )
      .run(Date.now() - 30 * 86400_000);
  }
}
