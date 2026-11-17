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
