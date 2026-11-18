import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, onAuthenticationRequired } from '../src/web/api';
import { Feed } from '../src/web/feed';
class Source extends EventTarget {
  static instances: Source[] = [];
  closed = false;
  constructor(readonly url: string) {
    super();
    Source.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}
const snapshot = { cursor: { seq: 0, epoch: 'test-epoch' } };
const response = (status: number, code = 'TEST_ERROR') =>
  new Response(
    JSON.stringify(status === 200 ? snapshot : { error: { code, message: 'Fixture failure' } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
beforeEach(() => {
  vi.useFakeTimers();
  Source.instances = [];
  vi.stubGlobal('EventSource', Source);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('reports expired authentication once and never retries its snapshot', async () => {
  const fetch = vi.fn().mockResolvedValue(response(401, 'AUTH_REQUIRED'));
  vi.stubGlobal('fetch', fetch);
  const expired = vi.fn();
  const unsubscribe = onAuthenticationRequired(expired);
  const failure = vi.fn();
  const status = vi.fn();
  const feed = new Feed('a', vi.fn(), vi.fn(), status, 'threads', failure);
  try {
    await feed.connect();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledWith(
      expect.objectContaining({ status: 401, code: 'AUTH_REQUIRED' }),
    );
    expect(status).toHaveBeenLastCalledWith('Sign in required');
    expect(Source.instances).toHaveLength(0);
  } finally {
    feed.close();
    unsubscribe();
  }
});
for (const code of [403, 404, 413])
  it(`stops automatic retry for HTTP ${code} while allowing an explicit retry`, async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(code))
      .mockResolvedValueOnce(response(200));
    vi.stubGlobal('fetch', fetch);
    const failure = vi.fn(),
      received = vi.fn(),
      status = vi.fn();
    const feed = new Feed('a', received, vi.fn(), status, 'threads', failure);
    try {
      await feed.connect();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(status).toHaveBeenLastCalledWith('Unavailable');
      await feed.connect();
      expect(received).toHaveBeenCalledWith(snapshot);
      Source.instances[0]!.dispatchEvent(new Event('ready'));
      expect(status).toHaveBeenLastCalledWith('Connected');
      expect(failure).toHaveBeenCalledTimes(1);
    } finally {
      feed.close();
    }
  });
it('recovers from a transient snapshot error using the existing bounded retry', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200));
  vi.stubGlobal('fetch', fetch);
  const failure = vi.fn(),
    received = vi.fn(),
    status = vi.fn();
  const feed = new Feed('a', received, vi.fn(), status, 'threads', failure);
  try {
    await feed.connect();
    expect(status).toHaveBeenLastCalledWith('Reconnecting');
    await vi.advanceTimersByTimeAsync(800);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(received).toHaveBeenCalledWith(snapshot);
    Source.instances[0]!.dispatchEvent(new Event('ready'));
    expect(status).toHaveBeenLastCalledWith('Connected');
    expect(failure).not.toHaveBeenCalled();
  } finally {
    feed.close();
  }
});
it('reports the final failure after exhausting retries', async () => {
  const fetch = vi.fn().mockImplementation(async () => response(503));
  vi.stubGlobal('fetch', fetch);
  const failure = vi.fn(),
    status = vi.fn();
  const feed = new Feed('a', vi.fn(), vi.fn(), status, 'threads', failure);
  try {
    await feed.connect();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(9);
    expect(status).toHaveBeenLastCalledWith('Disconnected');
    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure.mock.calls[0]![0]).toBeInstanceOf(ApiError);
  } finally {
    feed.close();
  }
});
it('ignores a closed subscription and its late authentication failure', async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((yes) => {
          resolve = yes;
        }),
    ),
  );
  const expired = vi.fn(),
    failure = vi.fn(),
    received = vi.fn();
  const unsubscribe = onAuthenticationRequired(expired);
  const feed = new Feed('a', received, vi.fn(), vi.fn(), 'threads', failure);
  try {
    const pending = feed.connect();
    feed.close();
    resolve(response(401, 'AUTH_REQUIRED'));
    await pending;
    expect(expired).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
    expect(received).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
  }
});
