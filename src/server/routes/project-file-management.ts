import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from '../../shared/errors.js';
import { projectFileLimits } from '../../shared/project-files.js';
import { body, json, type HttpRequest, type RouteResult } from '../http-io.js';
import type { ProjectFileManagement } from '../project-file-management.js';

export async function projectFileRoutes(
  { request, response, url, method }: HttpRequest,
  projectId: string,
  operation: string | undefined,
  files: ProjectFileManagement,
): RouteResult {
  const path = url.searchParams.get('path') ?? '';
  const showHidden = url.searchParams.get('showHidden') === 'true';
  if (!operation && method === 'GET') {
    const page = z
      .object({
        offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
        revision: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .parse(Object.fromEntries(url.searchParams));
    return json(
      response,
      await files.list(projectId, path, showHidden, page.offset, page.revision),
    );
  }
  if (operation === 'directory' && method === 'POST') {
    const { name } = z
      .object({ name: z.string().min(1).max(255) })
      .strict()
      .parse(await body(request));
    return json(response, await files.makeDirectory(projectId, path, name, showHidden), 201);
  }
  if ((operation === 'upload' || operation === 'attach') && method === 'POST') {
    try {
      if (Number(request.headers['content-length'] ?? 0) > projectFileLimits.uploadBytes)
        throw new AppError('PROJECT_FILE_LIMIT', 'Project uploads must be at most 64 MiB.', 413);
      const name = z.string().min(1).max(255).parse(url.searchParams.get('name'));
      const content = request.iterator({ destroyOnReturn: false });
      const cancelled = () => !request.complete || response.destroyed;
      if (operation === 'attach')
        return json(
          response,
          await files.uploadAttachment(projectId, name, content, cancelled),
          201,
        );
      const { path: uploadedPath, size } = await files.upload(
        projectId,
        path,
        name,
        showHidden,
        content,
        cancelled,
      );
      return json(response, { path: uploadedPath, size }, 201);
    } catch (error) {
      request.resume();
      throw error;
    }
  }
  if (operation === 'reference' && method === 'GET')
    return json(response, await files.reference(projectId, path, showHidden));
  if (operation === 'download' && method === 'GET') {
    return files.download(projectId, path, showHidden, async (file, size) => {
      const name = path.split('/').at(-1)!;
      const encoded = encodeURIComponent(name).replace(
        /['()*]/g,
        (character) => '%' + character.charCodeAt(0).toString(16),
      );
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': size.toString(),
        'content-disposition': "attachment; filename*=UTF-8''" + encoded,
        'cache-control': 'private,no-store',
      });
      await pipeline(file.createReadStream({ autoClose: false }), response);
    });
  }
  return false;
}
