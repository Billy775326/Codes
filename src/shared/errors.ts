export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public uncertain = false,
  ) {
    super(message);
  }
}
export function asError(error: unknown): AppError {
  return error instanceof AppError
    ? error
    : new AppError('INTERNAL_ERROR', 'The operation could not be completed.', 500);
}
export function record(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function cliError(message: unknown): AppError {
  const detail = typeof message === 'string' ? message : 'The CLI rejected the request.';
  if (/(?:^|:\s*)thread [0-9a-f-]{36} already has an active writer$/i.test(detail))
    return new AppError(
      'THREAD_WRITER_BUSY',
      'This conversation is open for writing in another Codex client. Close or unload it there, then check availability, or continue in a new branch.',
      409,
    );
  return new AppError('CLI_ERROR', detail, 409);
}
