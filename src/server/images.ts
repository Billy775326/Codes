import { mkdir, readdir, stat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, basename } from 'node:path';
import { imageSize } from 'image-size';
import { AppError } from '../shared/errors.js';
import { imageId, imageLimits } from '../shared/images.js';
import type { ImageAttachment } from '../shared/types.js';

const formats = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;
export class Images {
  private root: string;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(directory: string) {
    this.root = resolve(directory, 'images');
  }
  private directory(projectId: string) {
    if (!/^[a-f0-9-]{36}$/.test(projectId))
      throw new AppError('PROJECT_NOT_FOUND', 'Project not found.', 404);
    return join(this.root, projectId);
  }
  private path(projectId: string, id: string) {
    if (!imageId.test(id)) throw new AppError('IMAGE_NOT_FOUND', 'Image not found.', 404);
    return join(this.directory(projectId), id);
  }
  private inspect(bytes: Buffer) {
    if (!bytes.length || bytes.length > imageLimits.bytes)
      throw new AppError('IMAGE_LIMIT', 'Images must be at most 8 MiB.', 413);
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp =
      bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!png && !jpeg && !webp)
      throw new AppError('IMAGE_FORMAT', 'Choose a valid PNG, JPEG, or WebP image.');
    let header: ReturnType<typeof imageSize>;
    try {
      header = imageSize(bytes);
    } catch {
      throw new AppError('IMAGE_FORMAT', 'Choose a valid PNG, JPEG, or WebP image.');
    }
    if (
      !header.type ||
      !Object.hasOwn(formats, header.type) ||
      !header.width ||
      !header.height ||
      header.width * header.height > imageLimits.pixels
    )
      throw new AppError(
        'IMAGE_FORMAT',
        'Choose a PNG, JPEG, or WebP image of at most 24 megapixels.',
      );
    return header.type as keyof typeof formats;
  }
  async save(
    projectId: string,
    bytes: Buffer,
    name: string,
    contentType: string,
  ): Promise<ImageAttachment> {
    const kind = this.inspect(bytes);
    if (contentType !== formats[kind])
      throw new AppError('IMAGE_FORMAT', 'The image format does not match its content type.');
    const id = createHash('sha256').update(bytes).digest('hex') + '.' + kind;
    const filename = this.path(projectId, id);
    // Capacity accounting and writes share one admission queue, including different projects.
    const writing = this.writes.then(async () => {
      await mkdir(this.directory(projectId), { recursive: true, mode: 0o700 });
      try {
        await stat(filename);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      let count = 0,
        size = 0;
      for (const directory of await readdir(this.root, { withFileTypes: true })) {
        if (!directory.isDirectory()) continue;
        for (const entry of await readdir(join(this.root, directory.name))) {
          count++;
          size += (await stat(join(this.root, directory.name, entry))).size;
        }
      }
      if (count >= imageLimits.files || size + bytes.length > imageLimits.storageBytes)
        throw new AppError(
          'IMAGE_STORAGE_FULL',
          'Image storage is full (128 MiB or 512 images). Text messages remain available.',
          413,
        );
      const temporary = filename + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
        await rename(temporary, filename);
      } catch (error) {
        try {
          await unlink(temporary);
        } catch (cleanup) {
          if ((cleanup as NodeJS.ErrnoException).code !== 'ENOENT')
            console.error('Unable to remove an incomplete image upload.');
        }
        throw error;
      }
    });
    this.writes = writing.catch(() => undefined); // A rejected upload must not block later admissions.
    await writing;
    return {
      kind: 'image',
      id,
      name:
        basename(name)
          .replace(/[\x00-\x1f\x7f]/g, '')
          .slice(0, 160) || 'Image',
    };
  }
  async file(projectId: string, id: string) {
    const path = this.path(projectId, id);
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > imageLimits.bytes)
        throw new AppError('IMAGE_LIMIT', 'Image exceeds the supported size.', 413);
      return {
        path,
        size: info.size,
        contentType: formats[id.split('.').at(-1) as keyof typeof formats],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new AppError(
          'IMAGE_NOT_FOUND',
          'The attached image is no longer available. Attach it again.',
          404,
        );
      throw error;
    }
  }
  async read(projectId: string, id: string) {
    const { path } = await this.file(projectId, id);
    const bytes = await readFile(path);
    const kind = this.inspect(bytes);
    if (id !== createHash('sha256').update(bytes).digest('hex') + '.' + kind)
      throw new AppError('IMAGE_CHANGED', 'The attached image changed. Attach it again.', 409);
    return { path, bytes, contentType: formats[kind] };
  }
  reference(projectId: string, path: string): ImageAttachment | undefined {
    const id = basename(path);
    if (!imageId.test(id) || resolve(path) !== this.path(projectId, id)) return;
    return { kind: 'image', id, name: 'Attached image' };
  }
}
