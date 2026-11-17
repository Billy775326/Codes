export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly uncertain = false,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  try {
    const response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.any([AbortSignal.timeout(35_000), ...(signal ? [signal] : [])]),
    });
    const data = await response.json();
    if (!response.ok)
      throw new ApiError(
        data.error?.message ?? 'The request failed.',
        data.error?.code ?? 'HTTP_ERROR',
        data.error?.uncertain === true,
      );
    return data as T;
  } catch (error) {
    if (error instanceof ApiError || signal?.aborted) throw error;
    throw new ApiError(
      'The server could not be reached. Check the result before sending again.',
      'CONNECTION',
      true,
    );
  }
}
export const post = <T>(path: string, data: unknown = {}) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(data) });
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong.';
