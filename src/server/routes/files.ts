import { createReadStream } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from '../../shared/errors.js';
import { imageLimits, imageTypes } from '../../shared/images.js';
import { limits } from '../../shared/types.js';
import { htmlPreviewDocument, htmlPreviewPolicy } from '../html-preview.js';
import {
  fileDisposition,
  json,
  untilClosed,
  type HttpRequest,
  type RouteResult,
} from '../http-io.js';
import type { openImagePreview } from '../images.js';
import type { Service } from '../service.js';

export async function serveImagePreview(
  response: ServerResponse,
  { stream, size, contentType }: Awaited<ReturnType<typeof openImagePreview>>,
) {
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': size,
    'cache-control': 'private,no-store',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
  });
  await pipeline(stream, response);
}

export async function workspaceFileRoutes(
  { response, url, method }: HttpRequest,
  service: Service,
): RouteResult {
  if (url.pathname === '/api/file-browser' && method === 'GET') {
    const projectId = url.searchParams.get('projectId') || undefined;
    const path = url.searchParams.get('path') ?? '';
    const showHidden = url.searchParams.get('showHidden') === 'true';
    const kind = z
      .enum(['directory', 'location', 'file', 'image', 'document', 'pdf'])
      .parse(url.searchParams.get('kind'));
    if (kind === 'image')
      return await serveImagePreview(
        response,
        await service.browseImage(projectId, path, showHidden),
      );
    if (kind === 'document')
      return untilClosed(response, async (signal) => {
        const document = await service.browseDocument(projectId, path, showHidden, signal);
        if (!signal.aborted) return json(response, document);
      });
    if (kind === 'pdf')
      return service.browsePdf(projectId, path, showHidden, async (stream, size) => {
        response.writeHead(200, {
          'content-type': 'application/pdf',
          'content-length': size,
          'content-disposition': fileDisposition('inline', path.split('/').at(-1)!),
          'cache-control': 'private,no-store',
          'content-security-policy': "default-src 'none'; frame-ancestors 'self'",
          'x-frame-options': 'SAMEORIGIN',
          'cross-origin-resource-policy': 'same-origin',
        });
        await pipeline(stream, response);
      });
    if (kind === 'directory')
      return json(response, await service.browseDirectory(projectId, path, showHidden));
    if (kind === 'location')
      return json(response, await service.browseLocation(projectId, path, showHidden));
    return json(response, await service.browseFile(projectId, path, showHidden));
  }
  if (url.pathname === '/api/image-preview' && method === 'GET')
    return await serveImagePreview(
      response,
      await service.workspaceImage(url.searchParams.get('path') ?? ''),
    );
  if (url.pathname === '/api/html-preview' && method === 'GET') {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': htmlPreviewPolicy,
      'x-frame-options': 'SAMEORIGIN',
      'cache-control': 'no-store',
    });
    response.end(htmlPreviewDocument);
    return;
  }
  return false;
}

export function createProjectAttachmentRoutes(service: Service) {
  let attachmentUploads = 0;
  return async function projectAttachments(
    { request, response, method }: HttpRequest,
    projectId: string,
    segments: string[],
  ) {
    const image = segments[3] === 'images';
    service.project(projectId);
    if (method === 'POST' && !segments[4]) {
      try {
        await service.requireProject(projectId);
      } catch (error) {
        request.resume();
        throw error;
      }
      const contentType = request.headers['content-type'] ?? '';
      if (image && !imageTypes.includes(contentType as (typeof imageTypes)[number])) {
        request.resume();
        throw new AppError('IMAGE_FORMAT', 'Choose a PNG, JPEG, or WebP image.', 415);
      }
      const maxBytes = image ? imageLimits.bytes : limits.uploadedFile;
      const limitError = image
        ? new AppError('IMAGE_LIMIT', 'Images must be at most 8 MiB.', 413)
        : new AppError('FILE_LIMIT', 'Text files must be at most 64 KiB.', 413);
      if (Number(request.headers['content-length'] ?? 0) > maxBytes) {
        request.resume();
        throw limitError;
      }
      if (attachmentUploads >= 4) {
        request.resume();
        throw new AppError(
          image ? 'IMAGE_UPLOAD_BUSY' : 'FILE_UPLOAD_BUSY',
          'Attachment uploads are busy. Try again shortly.',
          429,
        );
      }
      attachmentUploads++;
      try {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > maxBytes) throw limitError;
          chunks.push(chunk);
        }
        const encodedName = z
          .string()
          .max(1500)
          .parse(
            request.headers[image ? 'x-image-name' : 'x-file-name'] ?? (image ? 'Image' : 'File'),
          );
        let name: string;
        try {
          name = decodeURIComponent(encodedName);
        } catch {
          throw new AppError(image ? 'IMAGE_NAME' : 'FILE_NAME', 'Invalid attachment filename.');
        }
        const buffer = Buffer.concat(chunks);
        return json(
          response,
          image
            ? await service.images.save(projectId, buffer, name, contentType)
            : service.uploadFile(projectId, buffer, name),
        );
      } finally {
        attachmentUploads--;
      }
    }
    if (image && method === 'GET' && segments[4] && !segments[5]) {
      const image = await service.images.file(projectId, segments[4]);
      response.writeHead(200, {
        'content-type': image.contentType,
        'cache-control': 'private,no-store',
        'content-length': image.size,
      });
      await pipeline(createReadStream(image.path), response);
      return;
    }
    throw new AppError('NOT_FOUND', 'Attachment endpoint not found.', 404);
  };
}
