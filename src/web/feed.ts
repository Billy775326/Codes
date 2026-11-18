import type { Envelope, Snapshot } from '../shared/types';
import { ApiError, request } from './api';

/** One owner per selected thread. Snapshot + replay cursor also covers tab suspension. */
export class Feed<T extends { cursor: { seq: number; epoch: string } } = Snapshot> {
  private generation = 0;
  private source?: EventSource;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private health?: ReturnType<typeof setInterval>;
  private attempts = 0;
  private alive = 0;
  private ready = false;
  private disposed = false;
  constructor(
    private id: string,
    private snapshot: (snapshot: T) => void,
    private event: (event: Envelope) => void,
    private status: (state: string) => void,
    private scope: 'threads' | 'projects' = 'threads',
    private failure?: (error: unknown) => void,
  ) {}
  async connect() {
    if (this.disposed) return;
    this.cleanup();
    const generation = ++this.generation;
    this.status('Connecting');
    this.ready = false;
    this.controller = new AbortController();
    try {
      const snapshot = await request<T>(
        `/${this.scope}/${this.id}/snapshot`,
        {},
        this.controller.signal,
      );
      if (generation !== this.generation || this.disposed) return;
      this.snapshot(snapshot);
      let seq = snapshot.cursor.seq;
      const source = new EventSource(
        `/api/events?${this.scope === 'projects' ? 'projectId' : 'threadId'}=${encodeURIComponent(this.id)}&after=${seq}&epoch=${snapshot.cursor.epoch}`,
      );
      this.source = source;
      this.alive = Date.now();
      const handshakeAt = Date.now();
      source.addEventListener('ready', () => {
        if (generation !== this.generation) return;
        this.ready = true;
        this.attempts = 0;
        this.alive = Date.now();
        this.status('Connected');
      });
      source.addEventListener('ping', () => {
        this.alive = Date.now();
      });
      source.addEventListener('message', (raw) => {
        if (generation !== this.generation) return;
        this.alive = Date.now();
        try {
          const event = JSON.parse((raw as MessageEvent).data) as Envelope;
          if (event.epoch !== snapshot.cursor.epoch) {
            this.retry();
            return;
          }
          if (event.seq <= seq) return;
          seq = event.seq;
          this.event(event);
        } catch {
          this.retry();
        }
      });
      source.addEventListener('reset', () => {
        if (generation === this.generation) this.retry();
      });
      source.onerror = () => {
        if (generation === this.generation) this.retry();
      };
      this.health = setInterval(() => {
        if ((!this.ready && Date.now() - handshakeAt > 5000) || Date.now() - this.alive > 35_000)
          this.retry();
      }, 1000);
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      if (
        error instanceof ApiError &&
        (error.code === 'AUTH_REQUIRED' ||
          (!!error.status &&
            error.status >= 400 &&
            error.status < 500 &&
            ![408, 429].includes(error.status)))
      ) {
        this.cleanup();
        ++this.generation;
        this.status(
          error.status === 401 || error.code === 'AUTH_REQUIRED'
            ? 'Sign in required'
            : 'Unavailable',
        );
        this.failure?.(error);
        return;
      }
      this.retry(error);
    }
  }
  private retry(error?: unknown) {
    this.cleanup();
    ++this.generation;
    if (this.disposed) return;
    this.status('Reconnecting');
    if (++this.attempts > 8) {
      this.status('Disconnected');
      this.failure?.(
        error ?? new Error('The connection was lost. Retry to load the latest conversation.'),
      );
      return;
    }
    this.timer = setTimeout(
      () => {
        void this.connect();
      },
      Math.min(800 * 2 ** (this.attempts - 1), 10_000),
    );
  }
  private cleanup() {
    this.source?.close();
    this.source = undefined;
    this.controller?.abort();
    clearTimeout(this.timer);
    clearInterval(this.health);
  }
  close() {
    this.disposed = true;
    ++this.generation;
    this.cleanup();
  }
}
