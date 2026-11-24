import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { asError } from '../shared/errors.js';

interface ReadTrace {
  id: string;
  phases: Record<string, { count: number; ms: number }>;
  bytes?: number;
  waiting?: number;
  active?: number;
  replay?: string;
}
const traces = new AsyncLocalStorage<ReadTrace>();

export async function traceRead<T>(
  response: ServerResponse,
  route: 'snapshot' | 'history' | 'project-snapshot' | 'events',
  threadId: string | undefined,
  work: () => Promise<T>,
) {
  const trace: ReadTrace = { id: randomUUID(), phases: {} };
  response.setHeader('x-request-id', trace.id);
  const start = performance.now();
  let error: string | undefined;
  try {
    return await traces.run(trace, work);
  } catch (failure) {
    error = response.destroyed ? 'CLIENT_DISCONNECTED' : asError(failure).code;
    throw failure;
  } finally {
    const ms = performance.now() - start;
    if (
      error ||
      trace.replay?.startsWith('reset') ||
      ms >= 750 ||
      process.env.CODES_READ_DIAGNOSTICS === '1'
    ) {
      console.info(
        JSON.stringify({
          event: 'workspace-read',
          requestId: trace.id,
          route,
          threadId: /^[0-9a-f-]{36}$/i.test(threadId ?? '') ? threadId : undefined,
          ms: Math.round(ms),
          error,
          bytes: trace.bytes,
          waiting: trace.waiting,
          active: trace.active,
          replay: trace.replay,
          phases: trace.phases,
        }),
      );
    }
  }
}

export function readPhase(name: string, startedAt: number) {
  const trace = traces.getStore();
  if (!trace) return;
  const phase = (trace.phases[name] ??= { count: 0, ms: 0 });
  phase.count++;
  phase.ms += Math.round(performance.now() - startedAt);
}

export function readResult(bytes: number) {
  const trace = traces.getStore();
  if (trace) trace.bytes = bytes;
}

export function readReplay(result: 'ready' | 'reset-epoch' | 'reset-cursor') {
  const trace = traces.getStore();
  if (trace) trace.replay = result;
}

export function readQueue(waiting: number, active: number) {
  const trace = traces.getStore();
  if (trace) {
    trace.waiting = waiting;
    trace.active = active;
  }
}
