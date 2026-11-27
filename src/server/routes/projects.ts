import { z } from 'zod';
import { nativeConfigurationEdits } from '../../shared/native-configuration.js';
import { settingsSchema as settings } from '../../shared/settings.js';
import { body, json, type HttpRequest, type RouteResult } from '../http-io.js';
import { traceRead, type ReadDiagnostics } from '../read-diagnostics.js';
import type { Service } from '../service.js';
import { createProjectAttachmentRoutes, serveImagePreview } from './files.js';
import { instructionsUpdate } from './instructions-input.js';
import { projectFileRoutes } from './project-file-management.js';

export async function projectCollection(
  { request, response, url, method }: HttpRequest,
  service: Service,
): RouteResult {
  if (url.pathname === '/api/projects' && method === 'GET')
    return json(response, service.store.projectsWithActivity());
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
  return false;
}

export function createProjectRoutes(service: Service, diagnostics: ReadDiagnostics, test = false) {
  const projectAttachments = createProjectAttachmentRoutes(service);

  return async function projectRoutes(context: HttpRequest, segments: string[]): RouteResult {
    const { request, response, url, method } = context;
    if (segments[1] === 'projects' && segments[2]) {
      const projectId = segments[2];
      if (segments[3] === 'file-management' && segments.length <= 5)
        return projectFileRoutes(context, projectId, segments[4], service.fileManagement);
      if (segments.length === 4 && segments[3] === 'instructions') {
        if (method === 'GET') return json(response, await service.projectInstructions(projectId));
        if (method === 'PUT') {
          const update = instructionsUpdate.strict().parse(await body(request));
          return json(response, await service.saveProjectInstructions(projectId, update));
        }
      }
      if (segments.length === 3 && method === 'PUT') {
        const { name, expectedName } = z
          .object({
            name: z.string().trim().min(1).max(80),
            expectedName: z.string().max(2048),
          })
          .strict()
          .parse(await body(request));
        return json(response, service.renameProject(projectId, name, expectedName));
      }
      if (segments.length === 4 && segments[3] === 'archive' && method === 'PUT') {
        const { archived } = z
          .object({ archived: z.boolean() })
          .strict()
          .parse(await body(request));
        return json(response, service.archiveProject(projectId, archived));
      }
      if (segments[3] === 'context' && method === 'GET')
        return json(response, await service.projectContext(projectId));
      if (segments[3] === 'images' || segments[3] === 'uploaded-files')
        return projectAttachments(context, projectId, segments);
      if (segments[3] === 'snapshot' && method === 'GET') {
        return traceRead(
          response,
          'project-snapshot',
          undefined,
          async () => {
            await service.list(projectId);
            return json(response, {
              threads: service.summaries(projectId),
              cursor: { seq: service.events.seq, epoch: service.events.epoch },
            });
          },
          () => diagnostics.verbose(),
        );
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
      if (segments[3] === 'codex-defaults' && !segments[4] && method === 'GET') {
        const project = await service.requireProject(projectId);
        return json(response, await service.modelSettings.defaults(project.path));
      }
      if (segments[3] === 'codex-configuration' && !segments[4]) {
        const project = await service.requireProject(projectId);
        const configuration = service.modelSettings.configuration;
        if (method === 'GET') return json(response, await configuration.overview(project.path));
        if (method === 'PUT') {
          const saved = await configuration.save(
            project.path,
            nativeConfigurationEdits.parse(await body(request)),
          );
          service.events.publish('codex-configuration', {});
          return json(response, saved);
        }
      }
      if (segments[3] === 'threads' && method === 'POST')
        return json(
          response,
          await service.create(projectId, settings.parse(await body(request)), true),
        );
      if (segments[3] === 'files' && method === 'GET')
        return json(
          response,
          await service.files(
            projectId,
            url.searchParams.get('path') ?? '',
            url.searchParams.get('showHidden') === 'true',
          ),
        );
      if (segments[3] === 'file' && method === 'GET')
        return json(
          response,
          await service.file(
            projectId,
            url.searchParams.get('path') ?? '',
            url.searchParams.get('showHidden') === 'true',
          ),
        );
      if (segments[3] === 'image-preview' && !segments[4] && method === 'GET') {
        return await serveImagePreview(
          response,
          await service.projectImage(
            projectId,
            url.searchParams.get('path') ?? '',
            url.searchParams.get('showHidden') === 'true',
          ),
        );
      }
      if (
        segments[3] === 'seed-conversations' &&
        method === 'POST' &&
        test &&
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
      if (segments[3] === 'seed' && method === 'POST' && test && service.driver.mode === 'mock') {
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
    return false;
  };
}
