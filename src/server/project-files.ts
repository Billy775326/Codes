import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, realpath, readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, basename, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { AppError, record } from '../shared/errors.js';
import {
  limits,
  type FileContent,
  type Project,
  type UploadedFileAttachment,
} from '../shared/types.js';
import { projectImageType } from '../shared/images.js';
import { hasHiddenPathSegment } from '../shared/project-files.js';
import type { GlobalInstructions, ProjectInstructions } from '../shared/project-instructions.js';
import { openImagePreview } from './images.js';
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
    if (this.project(id).archived)
      throw new AppError('PROJECT_ARCHIVED', 'Restore this project before editing AGENTS.md.', 409);
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
  async files(projectId: string, path = '', showHidden = false) {
    const absolute = await this.safePath(projectId, path, showHidden);
    const privateEntries = new Set(
      this.privateFileRoots
        .filter((root) => dirname(root) === absolute)
        .map((root) => basename(root)),
    );
    return (
      await readdir(absolute, { withFileTypes: true }).catch((error) =>
        this.fileError(projectId, error),
      )
    )
      .filter(
        (entry) =>
          (showHidden || !hasHiddenPathSegment(entry.name)) && !privateEntries.has(entry.name),
      )
      .slice(0, 200)
      .map((x) => ({
        name: x.name,
        path: path ? `${path}/${x.name}` : x.name,
        directory: x.isDirectory(),
      }))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
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
