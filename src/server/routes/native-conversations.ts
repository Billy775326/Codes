import { z } from 'zod';
import { body, json, untilClosed, type HttpRequest, type RouteResult } from '../http-io.js';
import { traceRead, type ReadDiagnostics } from '../read-diagnostics.js';
import type { Service } from '../service.js';

export async function nativeConversationRoutes(
  { request, response, url, method }: HttpRequest,
  service: Service,
  diagnostics: ReadDiagnostics,
): RouteResult {
  if (url.pathname === '/api/conversations' && method === 'GET') {
    const options = z
      .object({
        cwd: z.string().max(4096).optional(),
        search: z.string().max(120).optional(),
        cursor: z.string().max(8192).optional(),
        archived: z.enum(['true', 'false']).optional(),
        sort: z.enum(['updated_at', 'created_at']).optional(),
      })
      .parse(Object.fromEntries(url.searchParams));
    return traceRead(
      response,
      'conversation-list',
      undefined,
      () =>
        untilClosed(response, async (signal) => {
          const page = await service.nativeConversations(
            {
              ...options,
              archived: options.archived === 'true',
            },
            signal,
          );
          if (!signal.aborted) return json(response, page);
        }),
      () => diagnostics.verbose(),
    );
  }
  if (url.pathname === '/api/conversations/directory' && method === 'POST') {
    const { path } = z
      .object({ path: z.string().min(1).max(4096) })
      .strict()
      .parse(await body(request));
    return json(response, await service.addProject(path));
  }
  if (url.pathname === '/api/conversations/snapshot' && method === 'GET')
    return json(response, { cursor: { seq: service.events.seq, epoch: service.events.epoch } });
  return false;
}
