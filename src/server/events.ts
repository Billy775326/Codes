import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { limits, type Envelope } from '../shared/types.js';
import { AppError } from '../shared/errors.js';

export class Events {
  epoch = randomUUID();
  seq = 0;
  private bytes = 0;
  private discarded = 0;
  private ring: { value: Envelope; bytes: number }[] = [];
  private clients = new Set<{ threadId: string; response: ServerResponse }>();
  checkCapacity() {
    if (this.clients.size >= 32)
      throw new AppError('CONNECTION_LIMIT', 'Too many browser connections.', 429);
  }
  publish(kind: string, data: unknown, threadId?: string) {
    const value: Envelope = { kind, data, threadId, seq: ++this.seq, epoch: this.epoch };
    const bytes = Buffer.byteLength(JSON.stringify(value));
    this.ring.push({ value, bytes });
    this.bytes += bytes;
    while (this.ring.length > limits.events || this.bytes > limits.eventBytes) {
      const old = this.ring.shift()!;
      this.bytes -= old.bytes;
      this.discarded = old.value.seq;
    }
    for (const client of this.clients)
      if (!threadId || client.threadId === threadId || kind === 'summary')
        this.send(client.response, 'message', value);
  }
  subscribe(threadId: string, seq: number, epoch: string, response: ServerResponse) {
    const client = { threadId, response };
    this.clients.add(client);
    const timer = setInterval(() => this.send(response, 'ping', {}), 10_000);
    response.once('close', () => {
      clearInterval(timer);
      this.clients.delete(client);
    });
    if (epoch !== this.epoch || seq < this.discarded || seq > this.seq)
      this.send(response, 'reset', {});
    else {
      for (const { value } of this.ring)
        if (
          value.seq > seq &&
          (!value.threadId || value.threadId === threadId || value.kind === 'summary')
        )
          this.send(response, 'message', value);
      this.send(response, 'ready', { epoch: this.epoch });
    }
  }
  private send(response: ServerResponse, event: string, value: unknown) {
    if (response.destroyed) return;
    if (response.writableLength > 512 * 1024) {
      response.destroy();
      return;
    }
    response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  }
  close() {
    for (const c of this.clients) c.response.end();
    this.clients.clear();
  }
}
