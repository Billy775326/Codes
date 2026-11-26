import { createHash } from 'node:crypto';
import { constants, existsSync, realpathSync } from 'node:fs';
import { mkdir, open, opendir, realpath, readFile, stat } from 'node:fs/promises';
import { resolve, relative, basename, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import type { Readable } from 'node:stream';
import { documentPreviewFormat } from '../shared/document-previews.js';
import { AppError, record } from '../shared/errors.js';
import {
  limits,
  type FileContent,
  type Project,
  type UploadedFileAttachment,
} from '../shared/types.js';
import { projectImageType } from '../shared/images.js';
import {
  hasHiddenPathSegment,
  projectUploadStagingPrefix,
  type FileBrowserResult,
  type FileEntry,
  type FileLocation,
} from '../shared/project-files.js';
import type { GlobalInstructions, ProjectInstructions } from '../shared/project-instructions.js';
import { openImagePreview } from './images.js';
import { previewDocument, streamPdf } from './document-previews.js';
import {
  globalInstructions,
  instructionsChanged,
  projectInstructions,
} from './project-instructions.js';
import type { Store } from './store.js';

function decodeFileText(bytes: Buffer) {
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AppError('BINARY_FILE', 'Only UTF-8 text files are supported.');
  }
  if (content.includes('\0')) throw new AppError('BINARY_FILE', 'Only text files are supported.');
  return content;
}
function isWithinDirectory(directory: string, path: string) {
  const rel = relative(directory, path);
  return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
}

function browseError(error: unknown): never {
  if (record(error) && ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code))
    throw new AppError(
      'FILE_NOT_FOUND',
      'The selected file or directory no longer exists. Refresh Files.',
      404,
    );
  if (record(error) && ['EACCES', 'EPERM'].includes(error.code))
    throw new AppError('FILE_ACCESS', 'The selected file or directory cannot be accessed.', 403);
  throw error;
}

export class ProjectFiles {
  private readonly privateFileRoots: string[];
  private readonly codexHome = resolve(process.env.CODEX_HOME || resolve(homedir(), '.codex'));
  constructor(
    private readonly store: Store,
    private readonly project: (id: string) => Project,
    private readonly requireProject: (id: string) => Promise<Project>,
  ) {
    this.privateFileRoots = [realpathSync(store.directory), this.codexHome];
    if (existsSync(this.codexHome)) {
      const root = realpathSync(this.codexHome);
      if (root !== this.codexHome) this.privateFileRoots.push(root);
    }
  }
  async projectInstructions(id: string) {
    return projectInstructions((await this.requireProject(id)).path);
  }
  async saveProjectInstructions(id: string, update: ProjectInstructions) {
    const project = await this.requireProject(id);
    return projectInstructions(project.path, update);
  }
  async globalInstructions(update?: GlobalInstructions): Promise<GlobalInstructions> {
    let root: string;
    try {
      if (update?.filename === 'AGENTS.md' && update.revision === null)
        await mkdir(this.codexHome, { recursive: true, mode: 0o700 });
      root = await realpath(this.codexHome);
    } catch (error) {
      if (record(error) && error.code === 'ENOENT') {
        if (update) throw instructionsChanged();
        return { filename: 'AGENTS.md', text: '', revision: null };
      }
      if (
        record(error) &&
        ['ENOTDIR', 'ELOOP', 'EEXIST', 'EACCES', 'EPERM', 'EROFS'].includes(error.code)
      )
        throw new AppError(
          'CODEX_HOME_UNAVAILABLE',
          'The Codex configuration directory is unavailable.',
          409,
        );
      throw error;
    }
    if (!this.privateFileRoots.includes(root)) this.privateFileRoots.push(root);
    return globalInstructions(root, update);
  }
  uploadFile(projectId: string, bytes: Buffer, name: string): UploadedFileAttachment {
    if (!bytes.length || bytes.length > limits.uploadedFile)
      throw new AppError(
        'FILE_LIMIT',
        'Choose a non-empty UTF-8 text file of at most 64 KiB.',
        413,
      );
    const content = decodeFileText(bytes);
    return {
      kind: 'uploaded-file',
      id: this.store.saveUploadedFile(projectId, content),
      name:
        basename(name.replaceAll('\\', '/'))
          .replace(/[\x00-\x1f\x7f]/g, '')
          .slice(0, 160) || 'File',
    };
  }
  async file(projectId: string, path: string, showHidden = false): Promise<FileContent> {
    const absolute = await this.safePath(projectId, path, showHidden);
    const info = await stat(absolute).catch((error) => this.fileError(projectId, error));
    if (!info.isFile() || info.size > limits.file)
      throw new AppError('FILE_LIMIT', 'Choose a text file smaller than 256 KB.');
    const bytes = await readFile(absolute).catch((error) => this.fileError(projectId, error));
    if (bytes.length > limits.file)
      throw new AppError('FILE_LIMIT', 'This file grew beyond the 256 KB limit.');
    const content = decodeFileText(bytes);
    return {
      path,
      text: content,
      sha: createHash('sha256').update(bytes).digest('hex'),
      lines: content.split('\n').length,
    };
  }
  async projectImage(projectId: string, path: string, showHidden = false) {
    const contentType = projectImageType(path);
    if (!contentType)
      throw new AppError('IMAGE_FORMAT', 'Choose a PNG, JPEG, or WebP project image.', 415);
    const absolute = await this.safePath(projectId, path, showHidden);
    const project = this.project(projectId);
    return openImagePreview(absolute, contentType, (opened) => {
      this.requireBrowserPath(project.path, opened, showHidden);
    }).catch((error) => this.fileError(projectId, error));
  }

  async workspaceImage(path: string) {
    if (
      !isAbsolute(path) ||
      resolve(path) !== path ||
      /[\\\x00-\x1f\x7f]/.test(path) ||
      path.length > 4096
    )
      throw new AppError('PATH_DENIED', 'Choose an absolute image path on the server.', 403);
    const contentType = projectImageType(path);
    if (!contentType) throw new AppError('IMAGE_FORMAT', 'Choose a PNG, JPEG, or WebP image.', 415);
    const [runtime, ...privateRoots] = this.privateFileRoots;
    const checkPath = (absolute: string) => {
      // Runtime storage is private. Only direct image exports and its media folders are previews.
      const storedMedia =
        runtime &&
        ['images', 'screenshots'].some((folder) =>
          isWithinDirectory(resolve(runtime, folder), absolute),
        );
      if (
        privateRoots.some((root) => isWithinDirectory(root, absolute)) ||
        (runtime &&
          isWithinDirectory(runtime, absolute) &&
          dirname(absolute) !== runtime &&
          !storedMedia)
      )
        throw new AppError('PATH_DENIED', 'This image is outside the preview scope.', 403);
    };
    checkPath(path);
    try {
      const absolute = await realpath(path);
      checkPath(absolute);
      return await openImagePreview(absolute, contentType, checkPath);
    } catch (error) {
      if (record(error) && ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code))
        throw new AppError('IMAGE_NOT_FOUND', 'The image is no longer available.', 404);
      if (record(error) && ['EACCES', 'EPERM'].includes(error.code))
        throw new AppError('FILE_ACCESS', 'The selected image cannot be accessed.', 403);
      throw error;
    }
  }
  async browseDirectory(
    projectId: string | undefined,
    path: string,
    showHidden: boolean,
  ): Promise<FileBrowserResult<FileEntry[]>> {
    const target = await this.browsePath(projectId, path, showHidden);
    return {
      outsideScope: target.outsideScope,
      value: await this.listEntries(target.absolute, path, showHidden).catch(browseError),
    };
  }
  async browseLocation(
    projectId: string | undefined,
    path: string,
    showHidden: boolean,
  ): Promise<FileBrowserResult<FileLocation>> {
    const target = await this.browsePath(projectId, path, showHidden);
    const info = await stat(target.absolute).catch(browseError);
    if (!info.isFile() && !info.isDirectory())
      throw new AppError('FILE_TYPE', 'Choose a regular file or directory.', 415);
    return {
      value: { path: target.requested, directory: info.isDirectory() },
      outsideScope: target.outsideScope,
    };
  }
  async browseFile(
    projectId: string | undefined,
    path: string,
    showHidden: boolean,
  ): Promise<FileBrowserResult<FileContent>> {
    const target = await this.browsePath(projectId, path, showHidden);
    const info = await stat(target.absolute).catch(browseError);
    if (!info.isFile() || info.size > limits.file)
      throw new AppError('FILE_LIMIT', 'Choose a text file smaller than 256 KB.');
    const file = await open(
      target.absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ).catch(browseError);
    try {
      // Bound the read even if the file is replaced or grows after its first stat.
      const opened = await file.stat();
      if ((await realpath(`/proc/self/fd/${file.fd}`)) !== target.absolute)
        throw new AppError('FILE_CHANGED', 'The selected file changed. Open it again.', 409);
      if (!opened.isFile() || opened.size > limits.file)
        throw new AppError('FILE_LIMIT', 'Choose a text file smaller than 256 KB.');
      const buffer = Buffer.alloc(limits.file + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > limits.file)
        throw new AppError('FILE_LIMIT', 'Choose a text file smaller than 256 KB.');
      const bytes = buffer.subarray(0, size);
      const text = decodeFileText(bytes);
      return {
        outsideScope: target.outsideScope,
        value: {
          path:
            target.projectPath && !target.outsideScope
              ? relative(target.projectPath, target.requested)
              : path,
          text,
          sha: createHash('sha256').update(bytes).digest('hex'),
          lines: text.split('\n').length,
        },
      };
    } catch (error) {
      return browseError(error);
    } finally {
      await file.close();
    }
  }
  async browseDocument(
    projectId: string | undefined,
    path: string,
    showHidden: boolean,
    signal: AbortSignal,
    knownVersion?: string,
  ) {
    const format = documentPreviewFormat(path);
    if (!format)
      throw new AppError('DOCUMENT_FORMAT', 'Preview is unavailable for this file type.', 415);
    const target = await this.browsePath(projectId, path, showHidden);
    return {
      value: await previewDocument(
        target.absolute,
        format,
        signal,
        target.outsideScope ? undefined : knownVersion,
      ).catch(browseError),
      outsideScope: target.outsideScope,
    };
  }
  async browsePdf(
    projectId: string | undefined,
    path: string,
    showHidden: boolean,
    send: (stream: Readable, size: number) => Promise<void>,
  ) {
    if (documentPreviewFormat(path) !== 'pdf')
      throw new AppError('DOCUMENT_FORMAT', 'This file is not a valid PDF.', 415);
    const target = await this.browsePath(projectId, path, showHidden);
    await streamPdf(target.absolute, send).catch(browseError);
  }
  async browseImage(projectId: string | undefined, path: string, showHidden: boolean) {
    const contentType = projectImageType(path);
    if (!contentType) throw new AppError('IMAGE_FORMAT', 'Choose a PNG, JPEG, or WebP image.', 415);
    const target = await this.browsePath(projectId, path, showHidden);
    return openImagePreview(target.absolute, contentType, (opened) => {
      if (opened !== target.absolute)
        throw new AppError('FILE_CHANGED', 'The selected file changed. Open it again.', 409);
    }).catch(browseError);
  }
  private async browsePath(projectId: string | undefined, path: string, showHidden: boolean) {
    if (path.length > 4096 || /[\\\x00-\x1f\x7f]/.test(path) || (!projectId && !isAbsolute(path)))
      throw new AppError('FILE_PATH', 'Choose a valid server path.');
    const project = projectId ? this.project(projectId) : undefined;
    const requested = resolve(project?.path ?? '/', path);
    const absolute = await realpath(requested).catch(browseError);
    const outsideScope =
      !project ||
      !isWithinDirectory(project.path, requested) ||
      !isWithinDirectory(project.path, absolute) ||
      this.isPrivateBrowserPath(project.path, absolute) ||
      path.split('/').includes('..') ||
      (!showHidden &&
        (hasHiddenPathSegment(relative(project.path, requested)) ||
          hasHiddenPathSegment(relative(project.path, absolute))));
    return { requested, absolute, outsideScope, projectPath: project?.path };
  }
  async files(projectId: string, path = '', showHidden = false) {
    const absolute = await this.safePath(projectId, path, showHidden);
    const privateEntries = new Set(
      this.privateFileRoots
        .filter((root) => dirname(root) === absolute)
        .map((root) => basename(root)),
    );
    return this.listEntries(absolute, path, showHidden, privateEntries).catch((error) =>
      this.fileError(projectId, error),
    );
  }
  private async listEntries(
    absolute: string,
    path: string,
    showHidden: boolean,
    excluded = new Set<string>(),
  ) {
    const entries: FileEntry[] = [];
    for await (const entry of await opendir(absolute)) {
      if (
        (!showHidden && hasHiddenPathSegment(entry.name)) ||
        excluded.has(entry.name) ||
        entry.name.startsWith(projectUploadStagingPrefix)
      )
        continue;
      entries.push({
        name: entry.name,
        path: path ? `${path.replace(/\/$/, '')}/${entry.name}` : entry.name,
        directory: entry.isDirectory(),
        ...(entry.isSymbolicLink() ? { symbolicLink: true } : {}),
      });
      if (entries.length >= 200) break;
    }
    return entries.sort(
      (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
    );
  }
  private async fileError(projectId: string, error: unknown): Promise<never> {
    await this.requireProject(projectId);
    if (record(error) && ['ENOENT', 'ENOTDIR'].includes(error.code))
      throw new AppError(
        'FILE_NOT_FOUND',
        'The selected file or directory no longer exists. Refresh Files.',
        404,
      );
    if (record(error) && ['EACCES', 'EPERM'].includes(error.code))
      throw new AppError('FILE_ACCESS', 'The selected file or directory cannot be accessed.', 403);
    throw error;
  }
  private isPrivateBrowserPath(projectRoot: string, absolute: string) {
    return this.privateFileRoots.some(
      (root) =>
        root !== projectRoot &&
        isWithinDirectory(projectRoot, root) &&
        isWithinDirectory(root, absolute),
    );
  }
  private requireBrowserPath(projectRoot: string, absolute: string, showHidden: boolean) {
    if (
      !isWithinDirectory(projectRoot, absolute) ||
      this.isPrivateBrowserPath(projectRoot, absolute) ||
      (!showHidden && hasHiddenPathSegment(relative(projectRoot, absolute)))
    )
      throw new AppError('PATH_DENIED', 'This path is outside the file browser scope.', 403);
  }
  private async safePath(projectId: string, path: string, showHidden: boolean) {
    if (
      isAbsolute(path) ||
      path.split(/[\\/]/).includes('..') ||
      (!showHidden && hasHiddenPathSegment(path))
    )
      throw new AppError('PATH_DENIED', 'This path is outside the file browser scope.', 403);
    const project = await this.requireProject(projectId);
    const canonical = await realpath(resolve(project.path, path)).catch((error) =>
      this.fileError(projectId, error),
    );
    this.requireBrowserPath(project.path, canonical, showHidden);
    return canonical;
  }
}
