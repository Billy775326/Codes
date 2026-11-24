import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { AsyncQuestions } from '../src/server/async-questions';
import { nativeMessage } from '../src/server/transcript';

const title = 'Which direction should I use?';
const questionId = (itemId: string) => JSON.stringify(['request_user_input_async', itemId, 0]);
const message = (id: string, turnId = 'turn', options = ['One', 'Two']) =>
  nativeMessage({ id, type: 'agentMessage', text: '', questions: [{ title, options }] }, turnId)!;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE threads (id TEXT PRIMARY KEY);
    CREATE TABLE operations (id TEXT PRIMARY KEY, state TEXT NOT NULL);
    INSERT INTO threads VALUES ('thread');
  `);
  return db;
}

it.each(['call_live', 'item-3'])(
  'preserves the answer stored under %s across history replay',
  (id) => {
    using db = fixture();
    const before = new AsyncQuestions(db);
    before.observe('thread', message(id));
    const original = before.actions('thread')[0]!;
    before.confirmReply('thread', [
      { questionItemId: questionId(id), question: title, answer: 'One' },
    ]);
    const after = new AsyncQuestions(db);
    const otherId = id === 'call_live' ? 'item-3' : 'call_live';
    after.observe('thread', message(otherId));
    expect(after.actions('thread')).toMatchObject([
      {
        afterMessageId: 'call_live',
        legacyQuestion: {
          itemId: 'item-3',
          questionIds: { [questionId('item-3')]: questionId('call_live') },
        },
        status: 'answered',
        submittedAnswers: { [questionId('call_live')]: 'One' },
      },
    ]);
    expect(after.action(original.id)?.status).toBe('answered');
    expect(after.hasOpen('thread')).toBe(false);
  },
);

it('shares the original receipt between live and historical entries', () => {
  using db = fixture();
  const questions = new AsyncQuestions(db);
  questions.observe('thread', message('item-3'));
  const historical = questions.actions('thread')[0]!;
  questions.beginReply(historical.id, 'receipt');
  db.exec("INSERT INTO operations VALUES ('receipt', 'unknown')");
  questions.observe('thread', message('call_live'));
  expect(questions.actions('thread')).toMatchObject([
    { afterMessageId: 'call_live', status: 'responding', replyUnconfirmed: true },
  ]);
  expect(questions.hasOpen('thread')).toBe(true);
});

it('keeps similar requests separate when the match is ambiguous or belongs to another turn', () => {
  using db = fixture();
  const questions = new AsyncQuestions(db);
  for (const item of [
    message('call_first'),
    message('call_second'),
    message('item-3'),
    message('item-8', 'different-turn'),
    message('item-9', 'turn', ['Different choice']),
  ])
    questions.observe('thread', item);
  expect(questions.actions('thread').map((action) => action.afterMessageId)).toEqual([
    'call_first',
    'call_second',
    'item-3',
    'item-8',
    'item-9',
  ]);
});
