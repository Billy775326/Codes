import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Action, Message, Question } from '../shared/types.js';

type Entry = {
  id: string;
  threadId: string;
  itemId: string;
  turnId: string;
  questions: string;
  remaining: number;
  closed: 'skipped' | 'expired' | null;
  operationState: string | null;
};

const selection = `SELECT q.id, q.thread_id AS threadId, q.item_id AS itemId, q.turn_id AS turnId,
  q.questions, q.remaining, q.closed, o.state AS operationState
  FROM async_question_items q LEFT JOIN operations o ON o.id=q.reply_operation_id`;

/** Keep nonblocking question attention separate from native callbacks and execution leases. */
export class AsyncQuestions {
  private readonly preparing = new Set<string>();

  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS async_question_items (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      questions TEXT NOT NULL,
      remaining INTEGER NOT NULL,
      closed TEXT,
      reply_operation_id TEXT,
      UNIQUE(thread_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS async_question_attention ON async_question_items(thread_id, remaining)
      WHERE closed IS NULL;
    CREATE TABLE IF NOT EXISTS async_question_replies (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      title TEXT NOT NULL,
      answer TEXT NOT NULL,
      PRIMARY KEY(thread_id, item_id, question_id, title)
    );`);
  }

  observe(threadId: string, message: Message) {
    if (
      !message.asyncQuestions &&
      !message.answeredQuestions?.some((answer) => answer.questionItemId)
    )
      return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const changed = this.record(threadId, message);
      this.db.exec('COMMIT');
      return changed;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private record(threadId: string, message: Message) {
    let changed = false;
    if (message.asyncQuestions) {
      const actionId =
        'async-' +
        createHash('sha256')
          .update(JSON.stringify([threadId, message.id]))
          .digest('hex');
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO async_question_items
        (id, thread_id, item_id, turn_id, questions, remaining) VALUES (?,?,?,?,?,?)`,
        )
        .run(
          actionId,
          threadId,
          message.id,
          message.turnId,
          JSON.stringify(message.asyncQuestions),
          message.asyncQuestions.length,
        );
      if (result.changes) {
        this.refresh(threadId, message.id);
        changed = true;
      }
    }
    for (const { questionItemId, question, answer } of message.answeredQuestions ?? []) {
      if (!questionItemId || !answer.trim()) continue;
      const itemId = this.sourceId(questionItemId);
      if (!itemId) continue;
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO async_question_replies
        (thread_id, item_id, question_id, title, answer) VALUES (?,?,?,?,?)`,
        )
        .run(threadId, itemId, questionItemId, question.slice(0, 4000), answer.slice(0, 4000));
      if (result.changes) {
        this.refresh(threadId, itemId);
        changed = true;
      }
    }
    return changed;
  }

  private sourceId(id: string) {
    if (!id.startsWith('[')) return id;
    try {
      const value: unknown = JSON.parse(id);
      return Array.isArray(value) &&
        value.length === 3 &&
        value[0] === 'request_user_input_async' &&
        typeof value[1] === 'string' &&
        Number.isInteger(value[2]) &&
        value[2] >= 0 &&
        value[2] < 8
        ? value[1]
        : undefined;
    } catch {
      return undefined;
    }
  }

  private answers(threadId: string, itemId: string, questions: Question[]) {
    const rows = this.db
      .prepare(
        `SELECT question_id AS questionId, title, answer FROM async_question_replies
      WHERE thread_id=? AND item_id=?`,
      )
      .all(threadId, itemId) as { questionId: string; title: string; answer: string }[];
    return Object.fromEntries(
      questions.flatMap((question) => {
        const reply =
          rows.find((row) => row.questionId === question.id) ??
          rows.find((row) => row.questionId === itemId && row.title === question.question);
        return reply ? [[question.id, reply.answer]] : [];
      }),
    );
  }

  private refresh(threadId: string, itemId: string) {
    const entry = this.db
      .prepare('SELECT questions FROM async_question_items WHERE thread_id=? AND item_id=?')
      .get(threadId, itemId) as { questions: string } | undefined;
    if (!entry) return;
    const questions: Question[] = JSON.parse(entry.questions);
    const remaining =
      questions.length - Object.keys(this.answers(threadId, itemId, questions)).length;
    this.db
      .prepare('UPDATE async_question_items SET remaining=? WHERE thread_id=? AND item_id=?')
      .run(remaining, threadId, itemId);
  }

  hasOpen(threadId: string) {
    return !!this.db
      .prepare(
        `SELECT 1 FROM async_question_items
      WHERE thread_id=? AND closed IS NULL AND remaining>0 LIMIT 1`,
      )
      .get(threadId);
  }

  action(id: string) {
    const entry = this.db.prepare(selection + ' WHERE q.id=?').get(id) as Entry | undefined;
    return entry ? this.toAction(entry) : undefined;
  }

  actions(threadId: string) {
    const entries = this.db
      .prepare(
        selection +
          ` WHERE q.thread_id=?
      ORDER BY (q.closed IS NULL AND q.remaining>0) DESC, q.rowid DESC LIMIT 40`,
      )
      .all(threadId) as Entry[];
    const actions: Action[] = [];
    let remainingBytes = 192 * 1024;
    for (const entry of entries) {
      const action = this.toAction(entry);
      remainingBytes -= Buffer.byteLength(JSON.stringify(action));
      if (remainingBytes < 0) break;
      actions.push(action);
    }
    return actions.reverse();
  }

  private toAction(entry: Entry): Action {
    const questions: Question[] = JSON.parse(entry.questions);
    const submittedAnswers = this.answers(entry.threadId, entry.itemId, questions);
    const status =
      !entry.remaining || entry.closed === 'skipped'
        ? 'answered'
        : entry.closed === 'expired'
          ? 'expired'
          : this.preparing.has(entry.id) ||
              ['dispatching', 'acknowledged', 'unknown'].includes(entry.operationState ?? '')
            ? 'responding'
            : 'pending';
    return {
      id: entry.id,
      threadId: entry.threadId,
      turnId: entry.turnId,
      afterMessageId: entry.itemId,
      kind: 'questions',
      title: 'Codex question',
      detail: '',
      decisions: [],
      async: true,
      blocking: false,
      status,
      skipped: entry.closed === 'skipped',
      submittedAnswers,
      questions:
        status === 'pending' || status === 'responding'
          ? questions.filter((question) => !Object.hasOwn(submittedAnswers, question.id))
          : questions,
    };
  }

  beginReply(id: string, operationId: string) {
    this.db
      .prepare('UPDATE async_question_items SET reply_operation_id=? WHERE id=?')
      .run(operationId, id);
    this.preparing.add(id);
  }

  finishReply(id: string) {
    this.preparing.delete(id);
  }

  skip(id: string) {
    this.db.prepare("UPDATE async_question_items SET closed='skipped' WHERE id=?").run(id);
  }

  expireTurn(threadId: string, turnId: string) {
    return this.db
      .prepare(
        `UPDATE async_question_items SET closed='expired'
      WHERE thread_id=? AND turn_id=? AND closed IS NULL AND remaining>0`,
      )
      .run(threadId, turnId).changes;
  }
}
