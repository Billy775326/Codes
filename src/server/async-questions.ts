import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Action, Message, Question } from '../shared/types.js';
import { questionSourceItemId } from '../shared/question-replies.js';

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
type QuestionEntry = Entry & { parsed: Question[] };
type QuestionGroup = { primary: QuestionEntry; legacy?: QuestionEntry };

const selection = `SELECT q.id, q.thread_id AS threadId, q.item_id AS itemId, q.turn_id AS turnId,
  q.questions, q.remaining, q.closed, o.state AS operationState
  FROM async_question_items q LEFT JOIN operations o ON o.id=q.reply_operation_id`;
const legacyItem = /^item-\d+$/;
const nativeCall = /^call_[\w-]+$/;
const parseEntry = (entry: Entry): QuestionEntry => ({
  ...entry,
  parsed: JSON.parse(entry.questions),
});

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
    CREATE INDEX IF NOT EXISTS async_question_turn ON async_question_items(thread_id, turn_id);
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
    return this.transaction(() => this.record(threadId, message));
  }

  confirmReply(threadId: string, replies: NonNullable<Message['answeredQuestions']>) {
    return this.transaction(() => this.recordReplies(threadId, replies));
  }

  private transaction(record: () => boolean) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const changed = record();
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
    return this.recordReplies(threadId, message.answeredQuestions ?? []) || changed;
  }

  private recordReplies(threadId: string, replies: NonNullable<Message['answeredQuestions']>) {
    let changed = false;
    for (const { questionItemId, question, answer } of replies) {
      if (!questionItemId || !answer.trim()) continue;
      const itemId = questionSourceItemId(questionItemId);
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
    const candidates = this.db
      .prepare(selection + ' WHERE q.thread_id=? AND q.closed IS NULL AND q.remaining>0')
      .iterate(threadId) as IterableIterator<Entry>;
    const groups = new Map<string, Map<string, QuestionGroup>>();
    for (const entry of candidates) {
      const group = this.group(entry, groups);
      if (!group.legacy) return true;
      const status = this.toAction(group).status;
      if (status === 'pending' || status === 'responding') return true;
    }
    return false;
  }

  action(id: string) {
    const entry = this.db.prepare(selection + ' WHERE q.id=?').get(id) as Entry | undefined;
    return entry ? this.toAction(this.group(entry, new Map())) : undefined;
  }

  actions(threadId: string) {
    const entries = this.db
      .prepare(
        selection +
          ` WHERE q.thread_id=?
      ORDER BY (q.closed IS NULL AND q.remaining>0) DESC, q.rowid DESC LIMIT 80`,
      )
      .all(threadId) as Entry[];
    const actions: Action[] = [];
    const groups = new Map<string, Map<string, QuestionGroup>>();
    const included = new Set<string>();
    let remainingBytes = 192 * 1024;
    for (const entry of entries) {
      const group = this.group(entry, groups);
      if (included.has(group.primary.id)) continue;
      included.add(group.primary.id);
      const action = this.toAction(group);
      remainingBytes -= Buffer.byteLength(JSON.stringify(action));
      if (remainingBytes < 0) break;
      actions.push(action);
      if (actions.length === 40) break;
    }
    return actions.reverse();
  }

  private group(entry: Entry, turns: Map<string, Map<string, QuestionGroup>>): QuestionGroup {
    if (!nativeCall.test(entry.itemId) && !legacyItem.test(entry.itemId))
      return { primary: parseEntry(entry) };
    let groups = turns.get(entry.turnId);
    if (!groups) {
      groups = new Map();
      turns.set(entry.turnId, groups);
      const candidates = this.db
        .prepare(selection + ' WHERE q.thread_id=? AND q.turn_id=?')
        .all(entry.threadId, entry.turnId) as Entry[];
      const byQuestions = new Map<string, QuestionEntry[]>();
      for (const row of candidates) {
        if (!nativeCall.test(row.itemId) && !legacyItem.test(row.itemId)) continue;
        const candidate = parseEntry(row);
        const key = JSON.stringify(candidate.parsed.map(({ id: _, ...question }) => question));
        const matches = byQuestions.get(key);
        if (matches) matches.push(candidate);
        else byQuestions.set(key, [candidate]);
      }
      for (const matches of byQuestions.values()) {
        // History has no call ID. Only join a unique pair across the two ID formats.
        if (matches.length !== 2) continue;
        const primary = matches.find((row) => nativeCall.test(row.itemId));
        const legacy = matches.find((row) => legacyItem.test(row.itemId));
        if (!primary || !legacy) continue;
        const group = { primary, legacy };
        groups.set(primary.id, group);
        groups.set(legacy.id, group);
      }
    }
    return groups.get(entry.id) ?? { primary: parseEntry(entry) };
  }

  private toAction({ primary: entry, legacy }: QuestionGroup): Action {
    const questions = entry.parsed;
    const submittedAnswers = this.answers(entry.threadId, entry.itemId, questions);
    const questionIds: Record<string, string> = {};
    if (legacy) {
      const legacyAnswers = this.answers(legacy.threadId, legacy.itemId, legacy.parsed);
      legacy.parsed.forEach((question, index) => {
        const canonical = questions[index]!.id;
        questionIds[question.id] = canonical;
        if (legacyAnswers[question.id] && !Object.hasOwn(submittedAnswers, canonical))
          submittedAnswers[canonical] = legacyAnswers[question.id]!;
      });
    }
    const related = legacy ? [entry, legacy] : [entry];
    const skipped = related.some((row) => row.closed === 'skipped');
    const expired = related.some((row) => row.closed === 'expired');
    const responding = related.some(
      (row) =>
        this.preparing.has(row.id) ||
        ['dispatching', 'acknowledged', 'unknown'].includes(row.operationState ?? ''),
    );
    const status =
      Object.keys(submittedAnswers).length === questions.length || skipped
        ? 'answered'
        : expired
          ? 'expired'
          : responding
            ? 'responding'
            : 'pending';
    return {
      id: entry.id,
      threadId: entry.threadId,
      turnId: entry.turnId,
      afterMessageId: entry.itemId,
      ...(legacy ? { legacyQuestion: { itemId: legacy.itemId, questionIds } } : {}),
      kind: 'questions',
      title: 'Codex question',
      detail: '',
      decisions: [],
      async: true,
      blocking: false,
      status,
      replyUnconfirmed:
        status === 'responding' && related.some((row) => row.operationState === 'unknown'),
      skipped,
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
