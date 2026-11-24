import { expect, it } from 'vitest';
import type { Message, Thread } from '../src/shared/types';
import { ConversationViewCache } from '../src/web/conversation-view-cache';

function conversation(id: string, messages: Message[], projectId = 'project'): Thread {
  return {
    id,
    projectId,
    title: id,
    state: 'running',
    updatedAt: 0,
    olderCursor: null,
    messages,
    turns: [{ id: 'first' }, { id: 'latest' }],
    actions: [],
    diff: 'Live patch',
    pending: { id: 'operation', text: 'Pending send', state: 'acknowledged' },
    settings: { permission: 'read-only' },
  };
}

it('bounds the transcript preview and keeps it separate from live operations', () => {
  const cache = new ConversationViewCache();
  const first = {
    id: 'older',
    turnId: 'first',
    kind: 'assistant',
    text: 'x'.repeat(512 * 1024),
  } as const;
  const latest = {
    id: 'answer',
    turnId: 'latest',
    kind: 'assistant',
    text: 'Latest answer',
  } as const;
  cache.remember(conversation('chat', [first, latest]));
  expect(cache.peek('chat', 'project')).toEqual({
    id: 'chat',
    projectId: 'project',
    title: 'chat',
    messages: [latest],
    turns: [{ id: 'latest' }],
  });
  expect(cache.peek('chat', 'another project')).toBeUndefined();
  cache.forget('chat');
  expect(cache.peek('chat', 'project')).toBeUndefined();
});

it('keeps six recent views and clears them between login sessions', () => {
  const cache = new ConversationViewCache();
  const prompt = { id: 'prompt', turnId: 'latest', kind: 'user', text: 'Original prompt' } as const;
  for (let i = 0; i < 6; i++) cache.remember(conversation(String(i), [prompt]));
  cache.refreshRecency('0', 'project');
  cache.remember(conversation('6', [prompt]));
  expect(cache.peek('0', 'project')).toBeDefined();
  expect(cache.peek('1', 'project')).toBeUndefined();
  cache.clear();
  expect(cache.peek('0', 'project')).toBeUndefined();
  expect(cache.peek('6', 'project')).toBeUndefined();
});
