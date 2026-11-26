import { once } from 'node:events';
import { closeSync, constants, fchmodSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const chunkSize = 64 * 1024;
const tailLines = 50;

export function openServiceLog(directory, writable = false) {
  const path = join(directory, 'server.log');
  const mode = writable
    ? constants.O_CREAT | constants.O_APPEND | constants.O_RDWR
    : constants.O_RDONLY;
  const fd = openSync(path, mode | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1)
      throw new Error('The Codes log must be a private regular file.');
    if (writable) fchmodSync(fd, 0o600);
    return { path, fd, stat };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function tailOffset(fd, size) {
  const start = Math.max(0, size - chunkSize);
  const buffer = Buffer.alloc(size - start);
  const bytes = readSync(fd, buffer, 0, buffer.length, start);
  let lines = 0;
  for (let index = bytes - 1; index >= 0; index--) {
    if (buffer[index] === 10 && index < bytes - 1 && ++lines === tailLines)
      return start + index + 1;
  }
  return start;
}

export async function showServiceLog(directory, follow) {
  if (process.platform !== 'linux') throw new Error('Codes service commands require Linux.');
  const buffer = Buffer.alloc(chunkSize);
  let previous;
  let offset = 0;
  let waiting = false;
  do {
    let log;
    try {
      log = openServiceLog(directory);
      waiting = false;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const path = join(directory, 'server.log');
      if (!follow) throw new Error(`No background log at ${path}. Start with codes start.`);
      if (!waiting) console.error(`Waiting for background log at ${path}.`);
      waiting = true;
    }
    if (log) {
      const { fd, stat } = log;
      try {
        if (!previous) offset = tailOffset(fd, stat.size);
        else if (stat.dev !== previous.dev || stat.ino !== previous.ino || stat.size < offset)
          offset = 0;
        while (offset < stat.size) {
          const bytes = readSync(
            fd,
            buffer,
            0,
            Math.min(buffer.length, stat.size - offset),
            offset,
          );
          if (!bytes) break;
          // Writable streams may retain this chunk while the next read reuses the buffer.
          if (!process.stdout.write(Buffer.from(buffer.subarray(0, bytes))))
            await once(process.stdout, 'drain');
          offset += bytes;
        }
        previous = stat;
      } finally {
        closeSync(fd);
      }
    }
    if (follow) await delay(250);
  } while (follow);
  return 0;
}
