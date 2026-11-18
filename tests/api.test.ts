import { afterEach, expect, it, vi } from 'vitest';
import { request, onAuthenticationRequired } from '../src/web/api';
afterEach(() => vi.unstubAllGlobals());
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
