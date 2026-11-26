import type { IncomingMessage, ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { AppError } from '../shared/errors.js';
import { limits } from '../shared/types.js';
import { readPhase, readResult } from './read-diagnostics.js';

export interface HttpRequest {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  method: string | undefined;
}

// A feature route returns false if its path or method was not matched.
export type RouteResult = Promise<void | false>;

export function fileDisposition(mode: 'inline' | 'attachment', name: string) {
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => '%' + character.charCodeAt(0).toString(16),
  );
  return mode + "; filename*=UTF-8''" + encoded;
}

export async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limits.body) throw new AppError('BODY_LIMIT', 'Request exceeds 256 KB.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('INVALID_JSON', 'Expected a JSON request.');
  }
}
const compress = promisify(gzip);
const compressionThresholdBytes = 16 * 1024;
function acceptsGzip(header: string | undefined) {
  const offers = new Map(
    (header ?? '').split(',').map((offer) => {
      const [name = '', ...parameters] = offer.split(';').map((part) => part.trim());
      const quality = parameters.find((part) => /^q=/i.test(part));
      const q = quality ? Number(quality.slice(2)) : 1;
      return [name.toLowerCase(), Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0];
    }),
  );
  return (offers.get('gzip') ?? offers.get('*') ?? 0) > 0;
}
export async function json(response: ServerResponse, data: unknown, status = 200) {
  const startedAt = performance.now();
  let bytes = Buffer.from(JSON.stringify(data));
  let encoding: string | undefined;
  if (
    bytes.length >= compressionThresholdBytes &&
    acceptsGzip(response.req.headers['accept-encoding'])
  ) {
    // Compression runs off the event loop. The event
    // cursor is captured before compression, so replay still covers this delay.
    const compressed = await compress(bytes, { level: 4 });
    if (compressed.length < bytes.length) {
      bytes = compressed;
      encoding = 'gzip';
    }
  }
  readPhase('serialize', startedAt);
  readResult(bytes.length);
  if (response.destroyed) return;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': bytes.length,
    vary: 'Accept-Encoding',
    ...(encoding ? { 'content-encoding': encoding } : {}),
  });
  response.end(bytes);
}
export async function untilClosed<T>(
  response: ServerResponse,
  read: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const close = () => controller.abort();
  response.once('close', close);
  if (response.destroyed) close();
  try {
    return await read(controller.signal);
  } finally {
    response.removeListener('close', close);
  }
}
