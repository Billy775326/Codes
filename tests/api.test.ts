import { afterEach, expect, it, vi } from 'vitest';
import { request, onAuthenticationRequired } from '../src/web/api';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('preserves an HTTP failure when a proxy returns HTML instead of JSON', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
    ),
  );
  await expect(request('/system')).rejects.toMatchObject({
    code: 'HTTP_ERROR',
    status: 502,
    uncertain: false,
  });
  await expect(request('/threads/a/send', { method: 'POST' })).rejects.toMatchObject({
    code: 'HTTP_ERROR',
    status: 502,
    uncertain: true,
  });
});
it('separates an invalid successful payload from an unreachable service', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<html>Wrong service</html>', { status: 200 })),
  );
  await expect(request('/threads/a/snapshot')).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
    status: 200,
    uncertain: false,
  });
});
it('recognizes an expired session even when its HTTP 401 response is not JSON', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('Login required', { status: 401 })),
  );
  const expired = vi.fn(),
    unsubscribe = onAuthenticationRequired(expired);
  try {
    await expect(request('/system')).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
  }
});
it('marks only failed mutations as potentially executed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Network failure');
    }),
  );
  await expect(request('/threads/a/snapshot')).rejects.toMatchObject({
    code: 'CONNECTION',
    uncertain: false,
  });
  await expect(request('/threads/a/send', { method: 'POST' })).rejects.toMatchObject({
    code: 'CONNECTION',
    uncertain: true,
  });
});
it('distinguishes a request deadline from an intentional caller cancellation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new DOMException('Deadline exceeded', 'TimeoutError');
    }),
  );
  await expect(request('/system')).rejects.toMatchObject({ code: 'TIMEOUT', uncertain: false });
  const controller = new AbortController();
  controller.abort();
  const cancelled = new DOMException('Cancelled', 'AbortError');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw cancelled;
    }),
  );
  await expect(request('/system', {}, controller.signal)).rejects.toBe(cancelled);
});

function streamedResponse() {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
        },
      });
      init.signal!.addEventListener('abort', () => stream.error(init.signal!.reason), {
        once: true,
      });
      return new Response(body);
    }),
  );
  return {
    send(bytes: Uint8Array) {
      stream.enqueue(bytes);
    },
    close() {
      stream.close();
    },
    fail(error: Error) {
      stream.error(error);
    },
  };
}
it('finishes a progressing slow read beyond 35 seconds without restarting or corrupting Unicode', async () => {
  vi.useFakeTimers();
  const stream = streamedResponse();
  const bytes = new TextEncoder().encode(JSON.stringify({ text: '你好🙂' }));
  const result = request('/threads/a/snapshot');
  const checked = expect(result).resolves.toEqual({ text: '你好🙂' });
  await vi.advanceTimersByTimeAsync(30_000);
  stream.send(bytes.slice(0, 10));
  await vi.advanceTimersByTimeAsync(30_000);
  stream.send(bytes.slice(10, 11));
  await vi.advanceTimersByTimeAsync(30_000);
  stream.send(bytes.slice(11));
  stream.close();
  await checked;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('times out a stalled response body and distinguishes it from connection setup', async () => {
  vi.useFakeTimers();
  const stream = streamedResponse();
  const result = request('/threads/a/snapshot');
  const checked = expect(result).rejects.toMatchObject({
    code: 'TIMEOUT',
    uncertain: false,
    message: expect.stringContaining('download stopped'),
  });
  await vi.advanceTimersByTimeAsync(30_000);
  stream.send(new TextEncoder().encode('{'));
  await vi.advanceTimersByTimeAsync(35_000);
  await checked;
  expect(vi.getTimerCount()).toBe(0);
});
it('bounds a continuously progressing read by an overall two-minute deadline', async () => {
  vi.useFakeTimers();
  const stream = streamedResponse();
  const checked = expect(request('/threads/a/snapshot')).rejects.toMatchObject({
    code: 'TIMEOUT',
    uncertain: false,
    message: expect.stringContaining('two-minute limit'),
  });
  for (let n = 0; n < 11; n++) {
    await vi.advanceTimersByTimeAsync(10_000);
    stream.send(new TextEncoder().encode(n ? ' ' : '{'));
  }
  await vi.advanceTimersByTimeAsync(10_000);
  await checked;
  expect(vi.getTimerCount()).toBe(0);
});
it('keeps the original write deadline and uncertain receipt even when a response makes progress', async () => {
  vi.useFakeTimers();
  const stream = streamedResponse();
  const checked = expect(request('/threads/a/send', { method: 'POST' })).rejects.toMatchObject({
    code: 'TIMEOUT',
    uncertain: true,
  });
  await vi.advanceTimersByTimeAsync(30_000);
  stream.send(new TextEncoder().encode('{'));
  await vi.advanceTimersByTimeAsync(5_000);
  await checked;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('cancels a slow body immediately when the conversation changes', async () => {
  vi.useFakeTimers();
  streamedResponse();
  const controller = new AbortController();
  const checked = expect(
    request('/threads/a/snapshot', {}, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await checked;
  expect(vi.getTimerCount()).toBe(0);
});
it('times out before response headers without classifying a read as an executed task', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_yes, no) =>
          init.signal!.addEventListener('abort', () => no(init.signal!.reason), { once: true }),
        ),
    ),
  );
  const checked = expect(request('/threads/a/snapshot')).rejects.toMatchObject({
    code: 'TIMEOUT',
    uncertain: false,
    message: expect.stringContaining('before receiving a response'),
  });
  await vi.advanceTimersByTimeAsync(35_000);
  await checked;
  expect(vi.getTimerCount()).toBe(0);
});

it('treats an interrupted response body as a retryable connection failure rather than malformed JSON', async () => {
  const stream = streamedResponse();
  const checked = expect(request('/threads/a/snapshot')).rejects.toMatchObject({
    code: 'CONNECTION',
    uncertain: false,
  });
  await new Promise<void>((yes) => setTimeout(yes, 0));
  stream.send(new TextEncoder().encode('{'));
  stream.fail(new TypeError('Connection closed before the response completed'));
  await checked;
});
