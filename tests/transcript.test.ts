import { expect, it } from 'vitest';
import { nativeMessage, nativeTurn } from '../src/server/transcript';
it('retains native agent phases, treating missing and future phases as unknown', () => {
  for (const phase of ['commentary', 'partial_answer', 'final_answer'])
    expect(nativeMessage({ id: 'a', type: 'agentMessage', text: 'reply', phase }, 't')?.phase).toBe(
      phase,
    );
  for (const phase of [undefined, null, 'future'])
    expect(
      nativeMessage({ id: 'a', type: 'agentMessage', text: 'reply', phase }, 't')?.phase,
    ).toBeUndefined();
});
it('normalizes optional native timestamps without making up timing for legacy turns', () => {
  expect(
    nativeTurn({
      id: 't',
      status: 'completed',
      startedAt: 1000,
      completedAt: 1125,
      durationMs: 125000,
    }),
  ).toEqual({
    id: 't',
    status: 'completed',
    startedAtMs: 1000000,
    completedAtMs: 1125000,
    durationMs: 125000,
  });
  expect(nativeTurn({ id: 'legacy', startedAt: null, completedAt: '123', durationMs: -1 })).toEqual(
    { id: 'legacy' },
  );
  expect(nativeTurn({ id: 'invalid', startedAt: Infinity, completedAt: NaN })).toEqual({
    id: 'invalid',
  });
});
it('retains safe integration, dynamic tool and search summaries while excluding payloads and reasoning', () => {
  expect(
    nativeMessage(
      {
        id: 'mcp',
        type: 'mcpToolCall',
        appContext: { appName: 'GitHub' },
        server: 'connector',
        tool: 'search',
        status: 'completed',
        arguments: { token: 'private-fixture' },
        result: 'private-output',
      },
      't',
    ),
  ).toEqual({
    id: 'mcp',
    turnId: 't',
    kind: 'tool',
    text: 'Used GitHub: search',
    status: 'completed',
  });
  expect(
    nativeMessage(
      {
        id: 'dynamic',
        type: 'dynamicToolCall',
        tool: 'inspect',
        namespace: 'workspace',
        status: 'failed',
      },
      't',
    )?.text,
  ).toBe('Used workspace: inspect');
  expect(
    nativeMessage({ id: 'search', type: 'webSearch', query: 'synthetic query' }, 't')?.status,
  ).toBeUndefined();
  expect(
    nativeMessage({ id: 'reasoning', type: 'reasoning', summary: ['private reasoning'] }, 't'),
  ).toBeUndefined();
});

it('preserves terminal review output and a failed dynamic tool result', () => {
  expect(
    nativeMessage({ id: 'review', type: 'exitedReviewMode', review: 'Review result' }, 't'),
  ).toMatchObject({ kind: 'notice', phase: 'final_answer', text: 'Review result' });
  expect(
    nativeMessage(
      {
        id: 'dynamic',
        type: 'dynamicToolCall',
        tool: 'inspect',
        status: 'completed',
        success: false,
      },
      't',
    )?.status,
  ).toBe('failed');
});

it('formats answered Covro question envelopes without creating live questions or losing native identity', () => {
  const payload =
    '<send_user_message_question_reply>' +
    JSON.stringify([
      {
        questionItemId: 'opaque-private-id',
        question: 'Which scope?',
        answer: 'Imported conversations only',
      },
      { question: 'Next step?', answer: 'Keep\nall history' },
    ]) +
    '</send_user_message_question_reply>';
  const result = nativeMessage(
    {
      id: 'reply',
      clientId: 'receipt',
      type: 'userMessage',
      content: [{ type: 'text', text: payload }],
    },
    'turn',
  );
  expect(result).toMatchObject({
    id: 'reply',
    clientId: 'receipt',
    kind: 'user',
    text: 'Question: Which scope?\n\nAnswer: Imported conversations only\n\nQuestion: Next step?\n\nAnswer: Keep\nall history',
  });
  expect(result?.text).not.toContain('opaque-private-id');
  for (const input of [
    '<send_user_message_question_reply>bad JSON</send_user_message_question_reply>',
    '<send_user_message_question_reply>[{"answer":"missing question"}]</send_user_message_question_reply>',
    'Example: ' + payload,
    payload + ' after',
  ])
    expect(nativeMessage({ id: 'raw', type: 'userMessage', text: input }, 't')?.text).toBe(input);
});
