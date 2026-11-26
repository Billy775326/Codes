import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import {
  link,
  mkdir,
  open,
  opendir,
  realpath,
  statfs,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { AppError, record } from '../shared/errors.js';
import {
  hasHiddenPathSegment,
  composerAttachmentDirectory,
  projectFileLimits,
  projectUploadStagingPrefix,
  type FileEntry,
  type ProjectFilePage,
  type ProjectFileReferenceAttachment,
} from '../shared/project-files.js';
import type { Project } from '../shared/types.js';

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const readFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const fdPath = (handle: FileHandle) => '/proc/self/fd/' + handle.fd;
const diskReserve = 256n * 1024n * 1024n;

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
};

function denied() {
  return new AppError('FILE_MANAGEMENT_SCOPE', 'Choose a file inside the project folder.', 403);
}

function fileError(error: unknown): never {
  if (record(error)) {
    if (error.code === 'EEXIST')
      throw new AppError('FILE_EXISTS', 'That name is already in use. Choose another name.', 409);
    if (['ELOOP', 'ENOTDIR', 'EXDEV'].includes(error.code)) throw denied();
    if (error.code === 'ENOENT')
      throw new AppError('FILE_NOT_FOUND', 'The selected file or directory no longer exists.', 404);
    if (['EACCES', 'EPERM', 'EROFS'].includes(error.code))
      throw new AppError('FILE_ACCESS', 'The selected file or directory cannot be accessed.', 403);
    if (['ENOSPC', 'EDQUOT'].includes(error.code))
      throw new AppError(
        'FILE_DISK_SPACE',
        'There is not enough disk space to save this file.',
        507,
      );
  }
  throw error;
}

function pathParts(path: string) {
  if (!path) return [];
  const parts = path.split('/');
  if (
    path.length > projectFileLimits.pathLength ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[\\\x00-\x1f\x7f]/.test(part) ||
        Buffer.byteLength(part) > 255,
    )
  )
    throw denied();
  return parts;
}

function version(stats: BigIntStats) {
  return createHash('sha256')
    .update([stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(':'))
    .digest('hex');
}

/** Project writes use directory descriptors and reject symbolic-link components. */
export class ProjectFileManagement {
  private uploads = 0;
  private readonly codexHome = resolve(process.env.CODEX_HOME || resolve(homedir(), '.codex'));

  constructor(
    private readonly dataDirectory: string,
    private readonly requireProject: (id: string) => Promise<Project>,
  ) {}

  private async privateRoots() {
    const roots = [this.dataDirectory, this.codexHome];
    const canonical = await Promise.all(
      roots.map((root) =>
        realpath(root).catch((error) => {
          if (record(error) && error.code === 'ENOENT') return root;
          throw error;
        }),
      ),
    );
    return [...roots, ...canonical];
  }

  private permitted(root: string, parts: string[], privateRoots: string[]) {
    const target = resolve(root, ...parts);
    return (
      !target
        .split('/')
        .some(
          (part) =>
            part === '.git' || part === '.codex' || part.startsWith(projectUploadStagingPrefix),
        ) && !privateRoots.some((path) => inside(path, target))
    );
  }

  private async directory<T>(
    projectId: string,
    path: string,
    showHidden: boolean,
    work: (handle: FileHandle, project: Project, privateRoots: string[]) => Promise<T>,
  ) {
    const project = await this.requireProject(projectId);
    const parts = pathParts(path);
    const roots = await this.privateRoots();
    if (!this.permitted(project.path, parts, roots) || (!showHidden && hasHiddenPathSegment(path)))
      throw denied();
    let handle: FileHandle | undefined;
    try {
      handle = await open(project.path, directoryFlags);
      for (const part of parts) {
        const parent = handle;
        handle = await open(fdPath(parent) + '/' + part, directoryFlags);
        await parent.close();
      }
      await this.checkDirectory(handle, resolve(project.path, ...parts));
      return await work(handle, project, roots);
    } catch (error) {
      return fileError(error);
    } finally {
      await handle?.close();
    }
  }

  private async checkDirectory(handle: FileHandle, expected: string) {
    if ((await realpath(fdPath(handle))) !== expected)
      throw new AppError(
        'FILE_CHANGED',
        'The directory changed. Refresh Files and try again.',
        409,
      );
  }

  private checkWrite(project: Project) {
    if (project.path === '/') throw denied();
  }

  private child(
    project: Project,
    directory: string,
    name: string,
    showHidden: boolean,
    roots: string[],
  ) {
    const path = directory ? directory + '/' + name : name;
    if (
      pathParts(name).length !== 1 ||
      !this.permitted(project.path, pathParts(path), roots) ||
      (!showHidden && hasHiddenPathSegment(name))
    )
      throw denied();
    return path;
  }

  list(projectId: string, path: string, showHidden: boolean, offset: number, revision?: string) {
    return this.directory(
      projectId,
      path,
      showHidden,
      async (handle, project, roots): Promise<ProjectFilePage> => {
        const current = version(await handle.stat({ bigint: true }));
        const changed = () =>
          new AppError(
            'FILE_LIST_CHANGED',
            'The directory changed. Refresh Files to continue.',
            409,
          );
        if (offset && revision !== current) throw changed();
        const entries: FileEntry[] = [];
        let seen = 0;
        let more = false;
        for await (const entry of await opendir(fdPath(handle))) {
          const child = path ? path + '/' + entry.name : entry.name;
          if (
            (!showHidden && hasHiddenPathSegment(entry.name)) ||
            !this.permitted(project.path, child.split('/'), roots)
          )
            continue;
          if (seen++ < offset) continue;
          if (entries.length === projectFileLimits.pageSize) {
            more = true;
            break;
          }
          entries.push({
            name: entry.name,
            path: child,
            directory: entry.isDirectory(),
            ...(entry.isSymbolicLink() ? { symbolicLink: true } : {}),
          });
        }
        if (current !== version(await handle.stat({ bigint: true }))) throw changed();
        entries.sort(
          (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
        );
        return {
          entries,
          ...(more ? { next: { offset: offset + entries.length, revision: current } } : {}),
        };
      },
    );
  }

  makeDirectory(projectId: string, directory: string, name: string, showHidden: boolean) {
    return this.directory(projectId, directory, showHidden, async (handle, project, roots) => {
      const path = this.child(project, directory, name, showHidden, roots);
      await this.checkDirectory(handle, resolve(project.path, directory));
      this.checkWrite(project);
      await mkdir(fdPath(handle) + '/' + name, { mode: 0o700 });
      return { path };
    });
  }

  async uploadAttachment(
    projectId: string,
    name: string,
    content: AsyncIterable<Buffer>,
    cancelled: () => boolean,
  ): Promise<ProjectFileReferenceAttachment> {
    if (pathParts(name).length !== 1) throw denied();
    const showHidden = hasHiddenPathSegment(name);
    const { path, version } = await this.upload(
      projectId,
      composerAttachmentDirectory,
      name,
      showHidden,
      content,
      cancelled,
      true,
    );
    return { kind: 'file-reference', path, version, ...(showHidden ? { showHidden: true } : {}) };
  }

  async upload(
    projectId: string,
    directory: string,
    name: string,
    showHidden: boolean,
    content: AsyncIterable<Buffer>,
    cancelled: () => boolean,
    composerAttachment = false,
  ) {
    if (this.uploads >= projectFileLimits.concurrentUploads)
      throw new AppError(
        'FILE_UPLOAD_BUSY',
        'Two project uploads are already running. Try again shortly.',
        429,
      );
    this.uploads++;
    try {
      if (composerAttachment)
        await this.makeDirectory(projectId, '', directory, false).catch((error) => {
          if (!(error instanceof AppError) || error.code !== 'FILE_EXISTS') throw error;
        });
      return await this.directory(
        projectId,
        directory,
        showHidden,
        async (handle, project, roots) => {
          let path = this.child(project, directory, name, showHidden, roots);
          this.checkWrite(project);
          const fd = fdPath(handle);
          const { bavail, bsize } = await statfs(fd, { bigint: true });
          if (
            bavail * bsize <
            diskReserve +
              BigInt(projectFileLimits.uploadBytes * projectFileLimits.concurrentUploads)
          )
            throw new AppError(
              'FILE_DISK_SPACE',
              'There is not enough disk space to save this file.',
              507,
            );
          const staged = fd + '/' + projectUploadStagingPrefix + randomUUID();
          const file = await open(staged, 'wx', 0o600);
          let size = 0;
          try {
            try {
              for await (const chunk of content) {
                size += chunk.length;
                if (size > projectFileLimits.uploadBytes)
                  throw new AppError(
                    'PROJECT_FILE_LIMIT',
                    'Project uploads must be at most 64 MiB.',
                    413,
                  );
                await file.writeFile(chunk);
              }
              await file.sync();
              await this.checkDirectory(handle, resolve(project.path, directory));
              this.checkWrite(project);
              if (cancelled()) throw new AppError('UPLOAD_CANCELLED', 'Upload cancelled.', 409);
              // Publish the complete file without replacing an existing name.
              try {
                await link(staged, fd + '/' + name);
              } catch (error) {
                if (!composerAttachment || !record(error) || error.code !== 'EEXIST') throw error;
                const id = randomUUID();
                const prefix = id.slice(0, 8) + '-';
                const extension = extname(name);
                const alternative =
                  Buffer.byteLength(prefix + name) <= 255
                    ? prefix + name
                    : id + (Buffer.byteLength(extension) <= 32 ? extension : '');
                path = this.child(project, directory, alternative, showHidden, roots);
                await this.checkDirectory(handle, resolve(project.path, directory));
                this.checkWrite(project);
                if (cancelled()) throw new AppError('UPLOAD_CANCELLED', 'Upload cancelled.', 409);
                await link(staged, fd + '/' + alternative);
              }
            } finally {
              await unlink(staged);
            }
            // Removing the staging link updates ctime. Capture the version after that change.
            return { path, size, version: version(await file.stat({ bigint: true })) };
          } finally {
            await file.close();
          }
        },
      );
    } finally {
      this.uploads--;
    }
  }

  private openFile<T>(
    projectId: string,
    path: string,
    showHidden: boolean,
    work: (file: FileHandle, stats: BigIntStats) => Promise<T>,
  ) {
    const parts = pathParts(path);
    const name = parts.pop();
    if (!name) throw denied();
    const directory = parts.join('/');
    return this.directory(projectId, directory, showHidden, async (handle, project, roots) => {
      this.child(project, directory, name, showHidden, roots);
      const file = await open(fdPath(handle) + '/' + name, readFlags);
      try {
        const stats = await file.stat({ bigint: true });
        if (!stats.isFile() || (await realpath(fdPath(file))) !== resolve(project.path, path))
          throw denied();
        return await work(file, stats);
      } finally {
        await file.close();
      }
    });
  }

  reference(projectId: string, path: string, showHidden: boolean) {
    return this.openFile(
      projectId,
      path,
      showHidden,
      async (_file, stats): Promise<ProjectFileReferenceAttachment> => ({
        kind: 'file-reference',
        path,
        version: version(stats),
        ...(showHidden ? { showHidden: true } : {}),
      }),
    );
  }

  async verifyReference(projectId: string, entry: ProjectFileReferenceAttachment) {
    const changed = () =>
      new AppError(
        'FILE_REFERENCE_CHANGED',
        'A referenced file changed. Remove the reference or select the file again.',
        409,
      );
    let current: ProjectFileReferenceAttachment;
    try {
      current = await this.reference(projectId, entry.path, !!entry.showHidden);
    } catch (error) {
      if (
        error instanceof AppError &&
        ['FILE_NOT_FOUND', 'FILE_CHANGED', 'FILE_MANAGEMENT_SCOPE'].includes(error.code)
      )
        throw changed();
      throw error;
    }
    if (current.version !== entry.version) throw changed();
  }

  download(
    projectId: string,
    path: string,
    showHidden: boolean,
    send: (file: FileHandle, size: bigint) => Promise<void>,
  ) {
    return this.openFile(projectId, path, showHidden, (file, stats) => send(file, stats.size));
  }
}
