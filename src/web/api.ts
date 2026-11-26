export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly uncertain = false,
    readonly status?: number,
  ) {
    super(message);
  }
}
const authenticationListeners = new Set<(error: ApiError) => void>();
export function reportAuthenticationError(error: ApiError) {
  authenticationListeners.forEach((listener) => listener(error));
}
/** One workspace owner listens while signed in; token values never enter this signal. */
export function onAuthenticationRequired(listener: (error: ApiError) => void) {
  authenticationListeners.add(listener);
  return () => {
    authenticationListeners.delete(listener);
  };
}
const inactivityTimeoutMs = 35_000;
const readDeadlineMs = 120_000;
async function sendRequest<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
  readDownload?: (response: Response) => Promise<T>,
  idleTimeoutMs = inactivityTimeoutMs,
): Promise<T> {
  const writing = !['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase());
  const timeout = new AbortController();
  let phase: 'headers' | 'body' = 'headers';
  let deadlineReached = false;
  const expire = () => timeout.abort(new DOMException('Request deadline exceeded', 'TimeoutError'));
  let idleTimer = setTimeout(expire, idleTimeoutMs);
  const deadline = writing
    ? undefined
    : setTimeout(() => {
        deadlineReached = true;
        expire();
      }, readDeadlineMs);
  const progress = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(expire, idleTimeoutMs);
  };
  const uncertainty = writing ? ' Check the result before sending again.' : '';
  try {
    const response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.any([timeout.signal, ...(signal ? [signal] : [])]),
    });
    let data: any;
    try {
      phase = 'body';
      if (readDownload && response.ok) return await readDownload(response);
      if (!writing && response.body) {
        progress();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const chunks: string[] = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value.byteLength) {
              progress();
              chunks.push(decoder.decode(value, { stream: true }));
            }
          }
          chunks.push(decoder.decode());
          data = JSON.parse(chunks.join(''));
        } finally {
          reader.releaseLock();
        }
      } else data = await response.json();
    } catch (error) {
      if (signal?.aborted || timeout.signal.aborted || !(error instanceof SyntaxError)) throw error;
      const unauthenticated = response.status === 401;
      const failure = new ApiError(
        unauthenticated
          ? 'Sign in to your workspace.'
          : response.ok
            ? 'The service returned an invalid response. Check the service address or port forwarding.' +
              uncertainty
            : `The service returned HTTP ${response.status} without a valid API response. Check the service or port forwarding.` +
              (response.status >= 500 ? uncertainty : ''),
        unauthenticated ? 'AUTH_REQUIRED' : response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR',
        writing && (response.ok || response.status >= 500),
        response.status,
      );
      if (unauthenticated && !signal?.aborted) reportAuthenticationError(failure);
      throw failure;
    }
    if (!response.ok) {
      const error = new ApiError(
        typeof data?.error?.message === 'string' ? data.error.message : 'The request failed.',
        typeof data?.error?.code === 'string' ? data.error.code : 'HTTP_ERROR',
        data?.error?.uncertain === true,
        response.status,
      );
      if (response.status === 401 && !signal?.aborted) reportAuthenticationError(error);
      throw error;
    }
    if (!data || typeof data !== 'object')
      throw new ApiError(
        'The service returned an invalid API response.' + uncertainty,
        'INVALID_RESPONSE',
        writing,
        response.status,
      );
    return data as T;
  } catch (error) {
    if (error instanceof ApiError || signal?.aborted) throw error;
    const timedOut =
      timeout.signal.aborted || (error instanceof Error && error.name === 'TimeoutError');
    throw new ApiError(
      timedOut
        ? (writing
            ? 'The request timed out. Check the connection or port forwarding.'
            : phase === 'headers'
              ? 'The request timed out before receiving a response. Check the connection or port forwarding.'
              : deadlineReached
                ? 'The response download exceeded the two-minute limit. Check the connection or port forwarding.'
                : 'The response download stopped making progress. Check the connection or port forwarding.') +
            uncertainty
        : (phase === 'body'
            ? 'The response download was interrupted. Check the connection or port forwarding.'
            : 'The request could not reach this service address. Check the connection or port forwarding.') +
            uncertainty,
      timedOut ? 'TIMEOUT' : 'CONNECTION',
      writing,
    );
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(deadline);
  }
}
export function request<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
  idleTimeoutMs?: number,
) {
  return sendRequest<T>(path, init, signal, undefined, idleTimeoutMs);
}
export function downloadDatabaseBackup(signal: AbortSignal) {
  return sendRequest('/settings/backup', { method: 'POST' }, signal, async (response) => {
    const name = response.headers
      .get('content-disposition')
      ?.match(/^attachment; filename="(codes-db-\d{4}-\d{2}-\d{2}\.sqlite)"$/)?.[1];
    if (!name || response.headers.get('content-type') !== 'application/vnd.sqlite3')
      throw new ApiError('The service returned an invalid backup.', 'INVALID_RESPONSE');
    return { name, file: await response.blob() };
  });
}
export const post = <T>(path: string, data: unknown = {}) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(data) });
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong.';
