import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, relative } from 'node:path';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { z } from 'zod';
import { AppError, asError } from '../shared/errors.js';
import { imageId, imageLimits, imageTypes } from '../shared/images.js';
import { limits } from '../shared/types.js';
import { Service } from './service.js';
import { settingsSchema as settings, settingsProfileInput } from '../shared/settings.js';

const fileAttachment = z
  .object({
    kind: z.literal('file').optional(),
    path: z.string().min(1).max(1024),
    sha: z.string().regex(/^[a-f0-9]{64}$/),
    fromLine: z.number().int().positive(),
    toLine: z.number().int().positive(),
  })
  .strict();
const attachment = z.union([
  fileAttachment,
  z
    .object({
      kind: z.literal('image'),
      id: z.string().regex(imageId),
      name: z.string().min(1).max(160),
    })
    .strict(),
]);
const messageInput = z
  .object({
    operationId: z.uuid(),
    text: z.string().trim().max(50_000),
    attachments: z.array(attachment).max(imageLimits.attachments).default([]),
  })
  .strict();
const nonemptyMessage = (value: z.infer<typeof messageInput>) =>
  !!value.text || value.attachments.some((item) => item.kind === 'image');
const sendInput = messageInput
  .extend({ settings })
  .refine(nonemptyMessage, 'Enter a message or attach an image.');
const answerInput = z
  .object({
    operationId: z.uuid(),
    decision: z.string().max(50).optional(),
    answers: z.record(z.string(), z.string().max(4000)).optional(),
  })
  .strict();
async function body(request: IncomingMessage) {
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
async function json(response: ServerResponse, data: unknown, status = 200) {
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
export async function application(
  service: Service,
  options: {
    host: string;
    port: number;
    origin: string;
    token: string;
    dev?: boolean;
    test?: boolean;
    staticDir?: string;
  },
) {
  const origin = new URL(options.origin);
  const sessions = new Map<string, number>();
  const attempts = new Map<string, { count: number; until: number }>();
  const server = createServer();
  const vite = options.dev
    ? await (
        await import('vite')
      ).createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' })
    : undefined;
  const sessionId = (request: IncomingMessage) =>
    request.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('codes_session='))
      ?.slice('codes_session='.length);
  const authenticated = (request: IncomingMessage) => {
    const cookie = sessionId(request);
    const expiry = cookie ? sessions.get(cookie) : undefined;
    return !!expiry && expiry > Date.now();
  };
  let imageUploads = 0;
  server.on('request', (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-frame-options', 'DENY');
    if (!options.dev)
      response.setHeader(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    void (async () => {
      if (request.headers.host !== origin.host)
        throw new AppError('HOST_DENIED', 'Host not allowed.', 403);
      const url = new URL(request.url ?? '/', options.origin);
      const method = request.method;
      if (
        url.pathname.startsWith('/api/') &&
        method !== 'GET' &&
        request.headers.origin !== options.origin
      )
        throw new AppError('ORIGIN_DENIED', 'Request origin not allowed.', 403);
      if (url.pathname === '/api/login' && method === 'POST') {
        for (const [key, value] of attempts) if (value.until < Date.now()) attempts.delete(key);
        const ip = request.socket.remoteAddress ?? 'unknown';
        const attempt = attempts.get(ip);
        if ((attempt?.count ?? 0) >= 5 || attempts.size > 100)
          throw new AppError(
            'LOGIN_RATE',
            'Too many sign-in attempts. Try again in a minute.',
            429,
          );
        const input = z
          .object({ token: z.string().max(256) })
          .strict()
          .parse(await body(request));
        const supplied = Buffer.from(input.token);
        const expected = Buffer.from(options.token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          attempts.set(ip, { count: (attempt?.count ?? 0) + 1, until: Date.now() + 60_000 });
          throw new AppError('AUTH_REQUIRED', 'The access token is incorrect.', 401);
        }
        attempts.delete(ip);
        for (const [id, expiry] of sessions) if (expiry < Date.now()) sessions.delete(id);
        if (sessions.size >= 32) sessions.delete(sessions.keys().next().value!);
        const session = randomBytes(32).toString('hex');
        sessions.set(session, Date.now() + 12 * 3600_000);
        response.setHeader(
          'set-cookie',
          `codes_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${origin.protocol === 'https:' ? '; Secure' : ''}`,
        );
        return json(response, { ok: true });
      }
      if (url.pathname.startsWith('/api/')) {
        if (!authenticated(request))
          throw new AppError('AUTH_REQUIRED', 'Sign in to your workspace.', 401);
        if (url.pathname === '/api/logout' && method === 'POST') {
          sessions.delete(sessionId(request) ?? '');
          response.setHeader(
            'set-cookie',
            'codes_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
          );
          return json(response, { ok: true });
        }
        if (url.pathname === '/api/system' && method === 'GET')
          return json(response, service.system());
        if (url.pathname === '/api/maintenance' && method === 'POST') {
          const { action } = z
            .object({ action: z.enum(['start', 'cancel']) })
            .strict()
            .parse(await body(request));
          return json(
            response,
            action === 'start' ? service.startMaintenance() : service.cancelMaintenance(),
          );
        }
        if (url.pathname === '/api/models' && method === 'GET')
          return json(response, await service.modelSettings.models());
        if (url.pathname === '/api/permissions' && method === 'GET')
          return json(response, await service.modelSettings.permissions());
        if (url.pathname === '/api/modes' && method === 'GET')
          return json(response, await service.modelSettings.modes());
        if (url.pathname === '/api/settings/defaults' && method === 'GET')
          return json(response, service.store.settingsProfile());
        if (url.pathname === '/api/settings/defaults' && method === 'PUT') {
          const input = settingsProfileInput.parse(await body(request));
          return json(response, service.saveDefaultSettings(input.revision, input.settings));
        }
        if (url.pathname === '/api/projects' && method === 'GET')
          return json(response, service.store.projects());
        if (url.pathname === '/api/projects' && method === 'POST') {
          const p = z
            .object({
              path: z.string().min(1).max(2048),
              name: z.string().trim().min(1).max(80).optional(),
            })
            .strict()
            .parse(await body(request));
          return json(response, await service.addProject(p.path, p.name));
        }
        const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        if (segments[1] === 'projects' && segments[2]) {
          const projectId = segments[2];
          if (segments[3] === 'context' && method === 'GET')
            return json(response, await service.projectContext(projectId));
          if (segments[3] === 'images') {
            service.project(projectId);
            if (method === 'POST' && !segments[4]) {
              try {
                await service.requireProject(projectId);
              } catch (error) {
                request.resume();
                throw error;
              }
              const contentType = request.headers['content-type'] ?? '';
              if (!imageTypes.includes(contentType as (typeof imageTypes)[number]))
                throw new AppError('IMAGE_FORMAT', 'Choose a PNG, JPEG, or WebP image.', 415);
              if (Number(request.headers['content-length'] ?? 0) > imageLimits.bytes) {
                request.resume();
                throw new AppError('IMAGE_LIMIT', 'Images must be at most 8 MiB.', 413);
              }
              if (imageUploads >= 4) {
                request.resume();
                throw new AppError(
                  'IMAGE_UPLOAD_BUSY',
                  'Image uploads are busy. Try again shortly.',
                  429,
                );
              }
              imageUploads++;
              try {
                const chunks: Buffer[] = [];
                let bytes = 0;
                for await (const chunk of request) {
                  bytes += chunk.length;
                  if (bytes > imageLimits.bytes)
                    throw new AppError('IMAGE_LIMIT', 'Images must be at most 8 MiB.', 413);
                  chunks.push(chunk);
                }
                const encodedName = z
                  .string()
                  .max(1500)
                  .parse(request.headers['x-image-name'] ?? 'Image');
                let name: string;
                try {
                  name = decodeURIComponent(encodedName);
                } catch {
                  throw new AppError('IMAGE_NAME', 'Invalid image filename.');
                }
                return json(
                  response,
                  await service.images.save(projectId, Buffer.concat(chunks), name, contentType),
                );
              } finally {
                imageUploads--;
              }
            }
            if (method === 'GET' && segments[4] && !segments[5]) {
              const image = await service.images.file(projectId, segments[4]);
              response.writeHead(200, {
                'content-type': image.contentType,
                'cache-control': 'private,no-store',
                'content-length': image.size,
              });
              await pipeline(createReadStream(image.path), response);
              return;
            }
            throw new AppError('NOT_FOUND', 'Image endpoint not found.', 404);
          }
          if (segments[3] === 'snapshot' && method === 'GET') {
            await service.list(projectId);
            return json(response, {
              threads: service.summaries(projectId),
              cursor: { seq: service.events.seq, epoch: service.events.epoch },
            });
          }
          if (segments[3] === 'conversations' && method === 'GET') {
            const options = z
              .object({
                search: z.string().max(120).default(''),
                archived: z.enum(['true', 'false']).default('false'),
                cursor: z.string().max(4096).optional(),
              })
              .parse(Object.fromEntries(url.searchParams));
            return json(
              response,
              await service.conversations(projectId, {
                ...options,
                archived: options.archived === 'true',
              }),
            );
          }
          if (segments[3] === 'threads' && method === 'GET')
            return json(response, await service.list(projectId));
          if (segments[3] === 'threads' && method === 'POST')
            return json(
              response,
              await service.create(
                projectId,
                settings
                  .or(
                    z
                      .object({})
                      .strict()
                      .transform(() => service.store.settingsProfile().settings),
                  )
                  .parse(await body(request)),
              ),
            );
          if (segments[3] === 'files' && method === 'GET')
            return json(
              response,
              await service.files(projectId, url.searchParams.get('path') ?? ''),
            );
          if (segments[3] === 'file' && method === 'GET')
            return json(
              response,
              await service.file(projectId, url.searchParams.get('path') ?? ''),
            );
          if (
            segments[3] === 'seed-conversations' &&
            method === 'POST' &&
            options.test &&
            service.driver.mode === 'mock'
          ) {
            const p = service.project(projectId);
            const input = z
              .object({ count: z.number().int().min(1).max(400) })
              .strict()
              .parse(await body(request));
            await service.driver.call('test/seedConversations', {
              cwd: p.path,
              count: input.count,
            });
            return json(response, await service.conversations(projectId));
          }
          if (
            segments[3] === 'seed' &&
            method === 'POST' &&
            options.test &&
            service.driver.mode === 'mock'
          ) {
            const p = service.project(projectId);
            await service.driver.call('test/seed', {
              cwd: p.path,
              count: 100,
              foreignWriter: ['busy', 'once'].includes(url.searchParams.get('writer') ?? ''),
              releaseWriterOnRetry: url.searchParams.get('writer') === 'once',
            });
            return json(response, await service.list(projectId));
          }
        }
        if (segments[1] === 'threads' && segments[2]) {
          const id = segments[2];
          if (segments[3] === 'context' && method === 'GET')
            return json(response, await service.conversationContext(id));
          if (segments[3] === 'files' && method === 'GET')
            return json(
              response,
              await service.conversationFiles(id, url.searchParams.get('path') ?? ''),
            );
          if (segments[3] === 'file' && method === 'GET')
            return json(
              response,
              await service.conversationFile(id, url.searchParams.get('path') ?? ''),
            );
          if (segments[3] === 'settings' && !segments[4]) {
            if (method === 'GET') return json(response, service.store.settingsProfile(id));
            if (method === 'PUT') {
              const input = settingsProfileInput.parse(await body(request));
              return json(
                response,
                service.saveConversationSettings(id, input.revision, input.settings),
              );
            }
          }
          if (segments[3] === 'branch-point' && method === 'GET')
            return json(response, await service.branchPoint(id));
          if (segments[3] === 'retry-writer' && method === 'POST') {
            z.object({})
              .strict()
              .parse(await body(request));
            return json(response, await service.retryWriter(id));
          }
          if (segments[3] === 'source' && method === 'GET')
            return json(response, await service.source(id));
          if (segments[3] === 'fork' && method === 'POST') {
            const input = z
              .object({ operationId: z.uuid(), lastTurnId: z.string().min(1).max(200) })
              .strict()
              .parse(await body(request));
            return json(response, await service.fork(id, input.operationId, input.lastTurnId));
          }
          if (segments[3] === 'queue') {
            if (method === 'GET' && !segments[4]) return json(response, service.queueState(id));
            if (segments[4] === 'control' && method === 'POST') {
              const input = z
                .object({ paused: z.boolean() })
                .strict()
                .parse(await body(request));
              return json(response, service.controlQueue(id, input.paused));
            }
            if (segments[4] && segments[5] === 'steer' && method === 'POST') {
              const input = z
                .object({ expectedTurnId: z.string().min(1).max(200) })
                .strict()
                .parse(await body(request));
              return json(
                response,
                await service.steerQueued(id, segments[4], input.expectedTurnId),
              );
            }
            if (segments[4] && method === 'GET') {
              service.queueState(id);
              const item = service.store.queue.get(segments[4]);
              if (!item || item.threadId !== id)
                throw new AppError('NOT_FOUND', 'Queued message not found.', 404);
              return json(response, item);
            }
            if (segments[4] && method === 'PATCH') {
              const input = z
                .object({ text: z.string().trim().max(50_000) })
                .strict()
                .parse(await body(request));
              return json(response, service.editQueued(id, segments[4], input.text));
            }
            if (segments[4] && method === 'DELETE')
              return json(response, service.cancelQueued(id, segments[4]));
            if (method === 'POST') {
              const input = sendInput.parse(await body(request));
              return json(
                response,
                await service.enqueue(id, input.operationId, {
                  text: input.text,
                  settings: input.settings,
                  attachments: input.attachments,
                }),
              );
            }
          }
          if (segments[3] === 'rename' && method === 'POST') {
            const p = z
              .object({ operationId: z.uuid(), name: z.string().trim().min(1).max(80) })
              .strict()
              .parse(await body(request));
            return json(response, await service.rename(id, p.operationId, p.name));
          }
          if (segments[3] === 'archive' && method === 'POST') {
            const p = z
              .object({ operationId: z.uuid(), archived: z.boolean() })
              .strict()
              .parse(await body(request));
            return json(response, await service.archive(id, p.operationId, p.archived));
          }
          if (segments[3] === 'management-status' && method === 'POST')
            return json(response, await service.checkManagement(id));
          if (segments[3] === 'snapshot' && method === 'GET') {
            const thread = await service.read(id);
            return json(response, {
              thread,
              // Cached history stays readable while native execution is offline.
              context: await service.projectContext(thread.projectId),
              cursor: { seq: service.events.seq, epoch: service.events.epoch },
            });
          }
          if (segments[3] === 'history' && method === 'GET') {
            const cursor = url.searchParams.get('cursor');
            if (!cursor || cursor.length > 4096)
              throw new AppError('HISTORY_CURSOR', 'A valid history cursor is required.');
            return json(response, await service.history(id, cursor));
          }
          if (segments[3] === 'send' && method === 'POST') {
            const p = sendInput.parse(await body(request));
            return json(
              response,
              await service.send(id, p.operationId, p.text, p.settings, p.attachments),
            );
          }
          if (segments[3] === 'steer' && method === 'POST') {
            const input = messageInput
              .extend({ expectedTurnId: z.string().min(1).max(200) })
              .strict()
              .refine(nonemptyMessage, 'Enter a message or attach an image.')
              .parse(await body(request));
            return json(
              response,
              await service.steer(
                id,
                input.operationId,
                input.expectedTurnId,
                input.text,
                input.attachments,
              ),
            );
          }
          if (segments[3] === 'review' && method === 'POST') {
            const input = z
              .object({
                operationId: z.uuid(),
                settings,
                target: z.discriminatedUnion('type', [
                  z.object({ type: z.literal('uncommittedChanges') }).strict(),
                  z
                    .object({
                      type: z.literal('baseBranch'),
                      branch: z.string().trim().min(1).max(200),
                    })
                    .strict(),
                  z
                    .object({
                      type: z.literal('commit'),
                      sha: z.string().regex(/^[a-fA-F0-9]{7,64}$/),
                    })
                    .strict(),
                  z
                    .object({
                      type: z.literal('custom'),
                      instructions: z.string().trim().min(1).max(4000),
                    })
                    .strict(),
                ]),
              })
              .strict()
              .parse(await body(request));
            return json(
              response,
              await service.review(id, input.operationId, input.target, input.settings),
            );
          }
          if (segments[3] === 'interrupt' && method === 'POST')
            return json(response, await service.interrupt(id));
          if (segments[3] === 'reconcile' && method === 'POST')
            return json(response, await service.reconcile(id));
        }
        if (segments[1] === 'operations' && segments[2] && method === 'GET') {
          const op = service.store.operation(segments[2]);
          if (!op) throw new AppError('NOT_FOUND', 'Operation not found.', 404);
          return json(response, op);
        }
        if (segments[1] === 'actions' && segments[2] && method === 'POST') {
          const { operationId, ...resolution } = answerInput.parse(await body(request));
          return json(response, await service.answer(segments[2], operationId, resolution));
        }
        if (url.pathname === '/api/events' && method === 'GET') {
          const id = url.searchParams.get('threadId') ?? '';
          if (id) {
            const thread = service.store.thread(id);
            if (!thread) throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
            service.project(thread.projectId);
          } else service.project(url.searchParams.get('projectId') ?? '');
          service.events.checkCapacity();
          response.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          });
          response.flushHeaders();
          const expiry = setInterval(() => {
            if (!authenticated(request)) response.end();
          }, 30_000);
          response.once('close', () => clearInterval(expiry));
          service.events.subscribe(
            id,
            Number(url.searchParams.get('after') ?? -1),
            url.searchParams.get('epoch') ?? '',
            response,
          );
          return;
        }
        throw new AppError('NOT_FOUND', 'API endpoint not found.', 404);
      }
      if (vite)
        return vite.middlewares(request, response, () => {
          response.writeHead(404);
          response.end();
        });
      if (method !== 'GET' && method !== 'HEAD')
        throw new AppError('METHOD', 'Method not allowed.', 405);
      const directory = resolve(options.staticDir ?? 'dist/web');
      const path = resolve(directory, '.' + decodeURIComponent(url.pathname));
      if (relative(directory, path).startsWith('..'))
        throw new AppError('PATH_DENIED', 'Path not allowed.', 403);
      let file = path;
      try {
        if (!(await stat(file)).isFile()) file = join(directory, 'index.html');
      } catch {
        file = join(directory, 'index.html');
      }
      const bytes = await readFile(file);
      const mime: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      };
      response.writeHead(200, {
        'content-type': mime[extname(file)] ?? 'application/octet-stream',
        'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public,max-age=3600',
      });
      response.end(method === 'HEAD' ? undefined : bytes);
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      const problem =
        error instanceof z.ZodError
          ? new AppError('VALIDATION', 'Some request fields are invalid.')
          : asError(error);
      return json(
        response,
        { error: { code: problem.code, message: problem.message, uncertain: problem.uncertain } },
        problem.status,
      );
    });
  });
  return {
    server,
    close: async () => {
      const closed = new Promise<void>((yes) => server.close(() => yes()));
      service.events.close();
      await vite?.close();
      await service.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
