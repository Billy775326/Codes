import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, realpath, rename, rm } from 'node:fs/promises';
import { AppError, record } from '../shared/errors.js';
import {
  projectInstructionsLimit as limit,
  type ProjectInstructions,
} from '../shared/project-instructions.js';

const changed = () =>
  new AppError('INSTRUCTIONS_CONFLICT', 'AGENTS.md changed on disk. Reload before saving.', 409);
const tooLarge = () => new AppError('INSTRUCTIONS_LIMIT', 'AGENTS.md must be at most 64 KiB.', 413);

function document(bytes: Buffer): ProjectInstructions {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new AppError('INSTRUCTIONS_FORMAT', 'AGENTS.md must be a UTF-8 text file.');
  }
  if (text.includes('\0'))
    throw new AppError('INSTRUCTIONS_FORMAT', 'AGENTS.md must be a UTF-8 text file.');
  return { text, revision: createHash('sha256').update(bytes).digest('hex') };
}

async function read(path: string) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch((error: unknown) => {
    if (record(error) && error.code === 'ENOENT') return;
    throw error;
  });
  if (!file) return { current: { text: '', revision: null }, mode: undefined };
  try {
    const info = await file.stat();
    if (!info.isFile())
      throw new AppError('INSTRUCTIONS_PATH', 'AGENTS.md must be a regular file.', 403);
    if (info.size > limit) throw tooLarge();
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) throw tooLarge();
    return { current: document(buffer.subarray(0, size)), mode: info.mode & 0o777 };
  } finally {
    await file.close();
  }
}

/** The open directory descriptor keeps all operations in the same verified project. */
export async function projectInstructions(
  root: string,
  update?: ProjectInstructions,
): Promise<ProjectInstructions> {
  try {
    const directory = await open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      const anchor = `/proc/self/fd/${directory.fd}`;
      const verifyRoot = async () => {
        if ((await realpath(anchor)) !== root)
          throw new AppError(
            'DIRECTORY_UNAVAILABLE',
            'The project directory is unavailable. Restore it or choose another project.',
            409,
          );
      };
      await verifyRoot();
      const path = `${anchor}/AGENTS.md`;
      const { current, mode } = await read(path);
      if (!update) return current;
      if (current.revision !== update.revision) throw changed();
      const bytes = Buffer.from(update.text);
      if (bytes.length > limit) throw tooLarge();
      const next = document(bytes);
      if (next.revision === current.revision) return current;
      const temporary = `${anchor}/.agents-${randomUUID()}.tmp`;
      const file = await open(temporary, 'wx', 0o600);
      try {
        try {
          await file.writeFile(bytes);
          if (mode !== undefined) await file.chmod(mode);
        } finally {
          await file.close();
        }
        await verifyRoot();
        if ((await read(path)).current.revision !== current.revision) throw changed();
        if (current.revision === null) await link(temporary, path);
        else await rename(temporary, path);
        return next;
      } finally {
        await rm(temporary, { force: true });
      }
    } finally {
      await directory.close();
    }
  } catch (error) {
    if (record(error) && error.code === 'EEXIST') throw changed();
    if (record(error) && error.code === 'ELOOP')
      throw new AppError('INSTRUCTIONS_PATH', 'AGENTS.md must be a regular file.', 403);
    if (record(error) && ['EACCES', 'EPERM', 'EROFS'].includes(error.code))
      throw new AppError('INSTRUCTIONS_ACCESS', 'Check file permissions for AGENTS.md.', 403);
    if (record(error) && ['ENOENT', 'ENOTDIR'].includes(error.code))
      throw new AppError(
        'DIRECTORY_UNAVAILABLE',
        'The project directory is unavailable. Restore it or choose another project.',
        409,
      );
    throw error;
  }
}
