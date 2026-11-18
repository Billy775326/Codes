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
/** One workspace owner listens while signed in; token values never enter this signal. */
export function onAuthenticationRequired(listener: (error: ApiError) => void) {
  authenticationListeners.add(listener);
  return () => {
    authenticationListeners.delete(listener);
  };
}
export async function request<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const writing = !['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase());
  const timeout = AbortSignal.timeout(35_000);
  const uncertainty = writing ? ' Check the result before sending again.' : '';
  try {
    const response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.any([timeout, ...(signal ? [signal] : [])]),
    });
    let data: any;
    try {
      data = await response.json();
    } catch (error) {
      if (signal?.aborted || timeout.aborted) throw error;
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
      if (unauthenticated && !signal?.aborted)
        authenticationListeners.forEach((listener) => listener(failure));
      throw failure;
    }
    if (!response.ok) {
      const error = new ApiError(
        typeof data?.error?.message === 'string' ? data.error.message : 'The request failed.',
        typeof data?.error?.code === 'string' ? data.error.code : 'HTTP_ERROR',
        data?.error?.uncertain === true,
        response.status,
      );
      if (response.status === 401 && !signal?.aborted)
        authenticationListeners.forEach((listener) => listener(error));
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
    const timedOut = timeout.aborted || (error instanceof Error && error.name === 'TimeoutError');
    throw new ApiError(
      timedOut
        ? 'The request timed out. Check the connection or port forwarding.' + uncertainty
        : 'The request could not reach this service address. Check the connection or port forwarding.' +
            uncertainty,
      timedOut ? 'TIMEOUT' : 'CONNECTION',
      writing,
    );
  }
}
export const post = <T>(path: string, data: unknown = {}) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(data) });
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong.';
