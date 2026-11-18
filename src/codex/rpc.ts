import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { AppError, record } from '../shared/errors.js';

export class Rpc extends EventEmitter {
  private serial = 0;
  private tail = Buffer.alloc(0);
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private failure?: AppError;
  constructor(
    private input: Writable,
    output: Readable,
    private timeoutMs = 30_000,
  ) {
    super();
    output.on('data', (chunk: Buffer) => {
      if (this.failure) return;
      try {
        this.tail = Buffer.concat([this.tail, chunk]);
        let end: number;
        while ((end = this.tail.indexOf(10)) >= 0) {
          if (end > 4 * 1024 * 1024) throw new Error('line limit');
          const line = this.tail.subarray(0, end);
          this.tail = this.tail.subarray(end + 1);
          if (line.length)
            this.receive(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)));
        }
        if (this.tail.length > 4 * 1024 * 1024) throw new Error('line limit');
      } catch {
        this.fail(new AppError('PROTOCOL_ERROR', 'Invalid or oversized CLI response.', 502, true));
      }
    });
    output.on('end', () =>
      this.fail(new AppError('RUNTIME_OFFLINE', 'The CLI connection closed.', 503, true)),
    );
    output.on('error', () =>
      this.fail(new AppError('RUNTIME_OFFLINE', 'The CLI connection failed.', 503, true)),
    );
    input.on('error', () =>
      this.fail(new AppError('RUNTIME_OFFLINE', 'The CLI connection failed.', 503, true)),
    );
  }
  request(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<any> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending.size >= 64)
      return Promise.reject(new AppError('RUNTIME_BUSY', 'Too many CLI requests.', 429));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new AppError(
            'RESULT_UNKNOWN',
            `The CLI did not acknowledge ${method}. Its outcome must be checked.`,
            504,
            true,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params }).catch((error: Error) => {
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(timer);
          this.pending.delete(id);
          pending.reject(error);
        }
      });
    });
  }
  notify(method: string) {
    return this.write({ method });
  }
  answer(id: string | number, result: unknown) {
    return this.write({ id, result });
  }
  reject(id: string | number) {
    return this.write({
      id,
      error: { code: -32601, message: 'This client does not support this interaction.' },
    });
  }
  private write(value: unknown): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.input.writableLength > 1024 * 1024)
      return Promise.reject(new AppError('RUNTIME_BUSY', 'The CLI input buffer is full.', 429));
    return new Promise((resolve, reject) =>
      this.input.write(JSON.stringify(value) + '\n', (error) =>
        error
          ? reject(new AppError('RESULT_UNKNOWN', 'The CLI write failed.', 503, true))
          : resolve(),
      ),
    );
  }
  private receive(value: unknown) {
    if (!record(value)) throw new Error('invalid envelope');
    if (typeof value.method === 'string') {
      this.emit(value.id === undefined ? 'notification' : 'request', value);
      return;
    }
    const pending = this.pending.get(value.id);
    if (!pending) return;
    this.pending.delete(value.id);
    clearTimeout(pending.timer);
    if (value.error)
      pending.reject(
        new AppError(
          'CLI_ERROR',
          typeof value.error.message === 'string'
            ? value.error.message
            : 'The CLI rejected the request.',
          409,
        ),
      );
    else if ('result' in value) pending.resolve(value.result);
    else
      pending.reject(
        new AppError('PROTOCOL_ERROR', 'The CLI returned an invalid receipt.', 502, true),
      );
  }
  fail(error = new AppError('RUNTIME_OFFLINE', 'The CLI stopped.', 503, true)) {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.tail = Buffer.alloc(0);
    this.emit('offline', error);
  }
}
