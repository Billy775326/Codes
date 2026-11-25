import { z } from 'zod';
import { AppError } from '../../shared/errors.js';
import { imageId, imageLimits } from '../../shared/images.js';
import { settingsSchema as settings } from '../../shared/settings.js';
import { body, json, untilClosed, type HttpRequest, type RouteResult } from '../http-io.js';
import { traceRead, type ReadDiagnostics } from '../read-diagnostics.js';
import type { Service } from '../service.js';

const sha256 = /^[a-f0-9]{64}$/;
const fileAttachment = z
  .object({
    kind: z.literal('file').optional(),
    path: z.string().min(1).max(1024),
    showHidden: z.literal(true).optional(),
    sha: z.string().regex(sha256),
    fromLine: z.number().int().positive(),
    toLine: z.number().int().positive(),
  })
  .strict();
const attachment = z.union([
  fileAttachment,
  z
    .object({
      kind: z.literal('uploaded-file'),
      id: z.string().regex(sha256),
      name: z.string().min(1).max(160),
    })
    .strict(),
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

export async function conversationRoutes(
  { request, response, url, method }: HttpRequest,
  segments: string[],
  service: Service,
  diagnostics: ReadDiagnostics,
): RouteResult {
  if (segments[1] === 'threads' && segments[2]) {
    const id = segments[2];
    if (segments[3] === 'context' && method === 'GET')
      return json(response, await service.conversationContext(id));
    if (segments[3] === 'files' && method === 'GET')
      return json(
        response,
        await service.conversationFiles(
          id,
          url.searchParams.get('path') ?? '',
          url.searchParams.get('showHidden') === 'true',
        ),
      );
    if (segments[3] === 'file' && method === 'GET')
      return json(
        response,
        await service.conversationFile(
          id,
          url.searchParams.get('path') ?? '',
          url.searchParams.get('showHidden') === 'true',
        ),
      );
    if (segments[3] === 'settings' && !segments[4]) {
      if (method === 'GET') return json(response, service.store.settingsProfile(id));
      if (method === 'PUT')
        throw new AppError('SETTINGS_RETIRED', 'Edit the native Codex configuration.', 410);
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
        return json(response, await service.steerQueued(id, segments[4], input.expectedTurnId));
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
      return traceRead(
        response,
        'snapshot',
        id,
        () =>
          untilClosed(response, async (signal) => {
            const thread = await service.read(id, signal);
            // Cached history stays readable while native execution is offline.
            const context = await service.projectContext(thread.projectId);
            return json(response, {
              thread: {
                ...service.withSidebarActivity(thread),
                actions: service.conversationActions(id),
              },
              context,
              cursor: { seq: service.events.seq, epoch: service.events.epoch },
            });
          }),
        () => diagnostics.verbose(),
      );
    }
    if (segments[3] === 'history' && method === 'GET') {
      return traceRead(
        response,
        'history',
        id,
        () =>
          untilClosed(response, async (signal) => {
            const cursor = url.searchParams.get('cursor');
            if (!cursor || cursor.length > 4096)
              throw new AppError('HISTORY_CURSOR', 'A valid history cursor is required.');
            return json(response, await service.history(id, cursor, signal));
          }),
        () => diagnostics.verbose(),
      );
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
  return false;
}
