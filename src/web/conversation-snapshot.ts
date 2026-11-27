import { limits, type Envelope, type Snapshot } from '../shared/types';
import { ApiError, request } from './api';

type Cursor = Snapshot['cursor'];

/** Buffers only the selected conversation while its snapshot catches up to the workspace stream. */
export class ConversationSnapshot {
  private controller?: AbortController;
  private epoch?: string;
  private cursor?: Cursor;
  private buffered: Envelope[] = [];
  private bytes = 0;
  private discarded = 0;

  constructor(
    private id: string,
    private applySnapshot: (snapshot: Snapshot) => void,
    private applyEvent: (event: Envelope) => void,
    private status: (status: 'Connecting' | 'Connected' | 'Unavailable', error?: unknown) => void,
  ) {}

  prepare(epoch: string) {
    this.close();
    this.epoch = epoch;
    this.status('Connecting');
  }

  receive(event: Envelope) {
    if (event.epoch !== this.epoch) return;
    if (this.cursor) {
      if (event.seq > this.cursor.seq) this.applyEvent(event);
    } else if (this.controller) {
      this.bytes += JSON.stringify(event).length;
      if (this.bytes > limits.eventBytes || this.buffered.length >= limits.events) {
        this.buffered = [];
        this.bytes = 0;
        this.discarded = event.seq;
      } else this.buffered.push(event);
    }
  }

  async refresh() {
    if (!this.epoch) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.cursor = undefined;
    this.status('Connecting');
    try {
      const snapshot = await request<Snapshot>(
        '/threads/' + encodeURIComponent(this.id) + '/snapshot',
        {},
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (
        snapshot.thread?.id !== this.id ||
        snapshot.cursor?.epoch !== this.epoch ||
        !Number.isSafeInteger(snapshot.cursor?.seq)
      )
        throw new ApiError(
          'The service returned an invalid conversation snapshot.',
          'INVALID_RESPONSE',
        );
      if (snapshot.cursor.seq < this.discarded)
        throw new ApiError(
          'The conversation changed while loading. Retry loading.',
          'SNAPSHOT_STALE',
        );
      this.applySnapshot(snapshot);
      this.cursor = snapshot.cursor;
      for (const event of this.buffered) this.receive(event);
      this.status('Connected');
    } catch (error) {
      if (!controller.signal.aborted) this.status('Unavailable', error);
    } finally {
      if (!controller.signal.aborted) {
        this.controller = undefined;
        this.buffered = [];
        this.bytes = 0;
      }
    }
  }

  close() {
    this.controller?.abort();
    this.controller = undefined;
    this.epoch = undefined;
    this.cursor = undefined;
    this.buffered = [];
    this.bytes = 0;
    this.discarded = 0;
  }
}
