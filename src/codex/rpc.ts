import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { AppError, record, cliError } from '../shared/errors.js';

// Native tool results can be larger than the bounded browser transcript.
export const nativeFrameBytes = 16 * 1024 * 1024;
const historyMethods = new Set(['thread/read', 'thread/turns/list', 'thread/items/list']);

export class Rpc extends EventEmitter {
  private serial = 0;
  private fragments: Buffer[] = [];
  private frameBytes = 0;
  // Keep enough IDs to recognize a late oversized reply after a read deadline.
  private historyRequests = new Set<number>();
  private discarding?: { id: number; timer: ReturnType<typeof setTimeout> };
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
        let offset = 0;
        while (offset < chunk.length) {
          const end = chunk.indexOf(10, offset);
          const part = chunk.subarray(offset, end < 0 ? chunk.length : end);
          if (!this.discarding && this.frameBytes + part.length > nativeFrameBytes)
            this.discardHistoryFrame(part);
          if (this.discarding) {
            if (end < 0) break;
            this.finishDiscard();
            offset = end + 1;
            continue;
          }
          if (part.length) this.fragments.push(part);
          this.frameBytes += part.length;
          if (end < 0) break;
          // Concatenate each frame once, rather than copying an ever-growing tail on every chunk.
          const line =
            this.fragments.length === 1
              ? this.fragments[0]!
              : Buffer.concat(this.fragments, this.frameBytes);
          this.fragments = [];
          this.frameBytes = 0;
          if (line.length)
            this.receive(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)));
          offset = end + 1;
        }
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
    if (historyMethods.has(method)) {
      this.historyRequests.add(id);
      if (this.historyRequests.size > 256)
        this.historyRequests.delete(this.historyRequests.values().next().value!);
    }
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
    this.historyRequests.delete(value.id);
    const pending = this.pending.get(value.id);
    if (!pending) return;
    this.pending.delete(value.id);
    clearTimeout(pending.timer);
    if (value.error) pending.reject(cliError(value.error.message));
    else if ('result' in value) pending.resolve(value.result);
    else
      pending.reject(
        new AppError('PROTOCOL_ERROR', 'The CLI returned an invalid receipt.', 502, true),
      );
  }
  private discardHistoryFrame(part: Buffer) {
    // Only a recognizable response to a known history request may be discarded.
    // Unknown frames can carry execution receipts or server interaction requests.
    const head = Buffer.alloc(256);
    let length = 0;
    for (const fragment of this.fragments) {
      length += fragment.copy(head, length, 0, head.length - length);
      if (length >= head.length) break;
    }
    if (length < head.length) length += part.copy(head, length, 0, head.length - length);
    const match =
      /^\s*\{\s*(?:"jsonrpc"\s*:\s*"2\.0"\s*,\s*)?"id"\s*:\s*([1-9]\d{0,14})\s*,\s*"(?:result|error)"\s*:/.exec(
        head.toString('utf8', 0, length),
      );
    const id = Number(match?.[1]);
    if (!this.historyRequests.has(id)) throw new Error('line limit');
    const timer = setTimeout(() => {
      this.fail(
        new AppError('PROTOCOL_ERROR', 'The oversized CLI response did not finish.', 502, true),
      );
    }, this.timeoutMs);
    timer.unref();
    this.discarding = { id, timer };
    this.fragments = [];
    this.frameBytes = 0;
  }
  private finishDiscard() {
    const { id, timer } = this.discarding!;
    clearTimeout(timer);
    this.discarding = undefined;
    this.historyRequests.delete(id);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(
      new AppError('HISTORY_LIMIT', 'A native history item exceeds the preview limit.', 413),
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
    this.historyRequests.clear();
    if (this.discarding) clearTimeout(this.discarding.timer);
    this.fragments = [];
    this.frameBytes = 0;
    this.emit('offline', error);
  }
}
