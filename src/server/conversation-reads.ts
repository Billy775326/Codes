import { deferred } from '../shared/deferred.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from '../shared/errors.js';
import { readPhase, readQueue } from './read-diagnostics.js';

const maxConcurrent = 2;
const maxWaiting = 24;
const maxWaitMs = 5_000;

interface ReadJob {
  key: string;
  priority: number;
  controller: AbortController;
  consumers: number;
  result: Promise<unknown>;
  start: () => Promise<void>;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  started: boolean;
}

/** Share reads by key and reserve a native request slot for interactive work. */
export class ConversationReads {
  private jobs = new Map<string, ReadJob>();
  private waiting: ReadJob[] = [];
  private active = new Set<ReadJob>();
  private stopped = false;
  private background = 0;

  run<T>(
    key: string,
    priority: 'operation' | 'snapshot' | 'history',
    signal: AbortSignal | undefined,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.stopped)
      return Promise.reject(new AppError('RUNTIME_OFFLINE', 'The workspace is stopping.', 503));
    if (signal?.aborted) return Promise.reject(signal.reason);
    readQueue(this.waiting.length, this.active.size);
    const rank = priority === 'operation' ? 2 : priority === 'snapshot' ? 1 : 0;
    let job = this.jobs.get(key);
    const joinedAt = job ? performance.now() : undefined;
    if (job) job.priority = Math.max(job.priority, rank);
    else {
      if (this.waiting.length >= maxWaiting)
        return Promise.reject(
          new AppError('HISTORY_BUSY', 'Too many conversation reads. Try again.', 429),
        );
      const controller = new AbortController();
      const context = AsyncLocalStorage.snapshot();
      const queuedAt = performance.now();
      const { promise, resolve, reject } = deferred<unknown>();
      const queued: ReadJob = {
        key,
        priority: rank,
        controller,
        consumers: 0,
        result: promise,
        start: async () => {
          try {
            resolve(
              await context(() => {
                readPhase('read-queue', queuedAt);
                return work(controller.signal);
              }),
            );
          } catch (error) {
            reject(error);
          }
        },
        reject,
        started: false,
        timer: setTimeout(() => {
          this.cancel(
            queued,
            new AppError('HISTORY_BUSY', 'The conversation read queue is busy. Try again.', 429),
          );
        }, maxWaitMs),
      };
      queued.timer.unref();
      this.jobs.set(key, queued);
      this.waiting.push(queued);
      job = queued;
    }
    if (job.consumers >= 64)
      return Promise.reject(
        new AppError('HISTORY_BUSY', 'Too many consumers for this conversation read.', 429),
      );
    const subscribed = job;
    subscribed.consumers++;
    const result = new Promise<T>((resolve, reject) => {
      const abort = () => {
        unsubscribe();
        reject(signal!.reason);
      };
      const unsubscribe = () => {
        signal?.removeEventListener('abort', abort);
        subscribed.consumers--;
        if (joinedAt !== undefined) readPhase('shared-read', joinedAt);
        if (!subscribed.consumers && signal?.aborted) this.cancel(subscribed, signal.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
      subscribed.result.then(
        (value) => {
          if (signal?.aborted) return;
          unsubscribe();
          resolve(value as T);
        },
        (error) => {
          if (signal?.aborted) return;
          unsubscribe();
          reject(error);
        },
      );
    });
    this.pump();
    return result;
  }

  private cancel(job: ReadJob, reason: unknown) {
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    job.controller.abort(reason);
    if (!job.started) {
      clearTimeout(job.timer);
      this.waiting.splice(this.waiting.indexOf(job), 1);
      job.reject(reason);
      this.pump();
    }
  }

  async close() {
    this.stopped = true;
    const reason = new AppError('RUNTIME_OFFLINE', 'The workspace is stopping.', 503);
    for (const job of this.jobs.values()) this.cancel(job, reason);
    await Promise.allSettled([...this.active].map((job) => job.result));
  }

  private pump() {
    while (!this.stopped && this.active.size < maxConcurrent) {
      let next: ReadJob | undefined;
      for (const job of this.waiting)
        if ((job.priority || !this.background) && (!next || job.priority > next.priority))
          next = job;
      if (!next) return;
      const job = next;
      const background = job.priority === 0;
      this.waiting.splice(this.waiting.indexOf(job), 1);
      clearTimeout(job.timer);
      job.started = true;
      this.active.add(job);
      if (background) this.background++;
      void job.start().finally(() => {
        this.active.delete(job);
        if (background) this.background--;
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        this.pump();
      });
    }
  }
}
