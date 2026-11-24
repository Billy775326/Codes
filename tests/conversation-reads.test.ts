import { deferred } from '../src/shared/deferred';
import { expect, it } from 'vitest';
import { ConversationReads } from '../src/server/conversation-reads';

it('prioritizes a current snapshot over history prefetch and cancels unused queued work', async () => {
  const pool = new ConversationReads();
  const active = deferred<void>();
  const started: string[] = [];
  const first = pool.run('first', 'history', undefined, async () => {
    started.push('first');
    await active.promise;
  });
  const abandoned = new AbortController();
  const second = pool.run('second', 'history', abandoned.signal, async () => {
    started.push('second');
  });
  const pending = expect(second).rejects.toMatchObject({ name: 'AbortError' });
  await pool.run('selected', 'snapshot', undefined, async () => {
    started.push('selected');
  });
  expect(started).toEqual(['first', 'selected']);
  abandoned.abort();
  await pending;
  active.resolve();
  await first;
  expect(started).toEqual(['first', 'selected']);
});

it('keeps a shared history read until its final consumer disconnects', async () => {
  const pool = new ConversationReads();
  const first = new AbortController();
  const second = new AbortController();
  const active = deferred<AbortSignal>();
  const stopped = deferred<void>();
  const result = pool.run('page', 'history', first.signal, async (signal) => {
    active.resolve(signal);
    await new Promise<void>((done) =>
      signal.addEventListener('abort', () => done(), { once: true }),
    );
    stopped.resolve();
    signal.throwIfAborted();
  });
  const shared = pool.run('page', 'history', second.signal, async () => {
    throw new Error('The second reader must join the original job');
  });
  const firstError = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  const secondError = expect(shared).rejects.toMatchObject({ name: 'AbortError' });
  const jobSignal = await active.promise;
  first.abort();
  await firstError;
  expect(jobSignal.aborted).toBe(false);
  second.abort();
  await secondError;
  await stopped.promise;
  expect(jobSignal.aborted).toBe(true);
});
