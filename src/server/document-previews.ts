import { constants } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { Worker } from 'node:worker_threads';
import type { DocumentPreview, DocumentPreviewRead } from '../shared/document-previews.js';
import { AppError } from '../shared/errors.js';
import { fileVersion } from './file-version.js';

const maxWordBytes = 8 * 1024 * 1024;
const maxPdfBytes = 32 * 1024 * 1024;
const wordTimeoutMs = 5000;
let wordPreviewActive = false;

async function withFile<T>(
  path: string,
  limit: number,
  sizeError: string,
  read: (file: FileHandle, size: number) => Promise<T>,
) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if ((await realpath(`/proc/self/fd/${file.fd}`)) !== path)
      throw new AppError('FILE_CHANGED', 'The selected file changed. Open it again.', 409);
    if (!info.isFile()) throw new AppError('FILE_TYPE', 'Choose a regular file or directory.', 415);
    if (info.size > limit) throw new AppError('DOCUMENT_LIMIT', sizeError, 413);
    return await read(file, info.size);
  } finally {
    await file.close();
  }
}

async function readPdf<T>(path: string, read: (file: FileHandle, size: number) => Promise<T>) {
  return withFile(path, maxPdfBytes, 'PDF previews are limited to 32 MiB.', async (file, size) => {
    const signature = Buffer.alloc(5);
    const { bytesRead } = await file.read(signature, 0, signature.length, 0);
    if (bytesRead !== signature.length || signature.toString('latin1') !== '%PDF-')
      throw new AppError('DOCUMENT_FORMAT', 'This file is not a valid PDF.', 415);
    return read(file, size);
  });
}

export function streamPdf(path: string, send: (stream: Readable, size: number) => Promise<void>) {
  return readPdf(path, (file, size) =>
    send(file.createReadStream({ autoClose: false, end: size - 1 }), size),
  );
}

async function extractWord(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal) {
  signal.throwIfAborted();
  const entry = new URL(
    import.meta.url.endsWith('.ts') ? './word-preview-worker.ts' : './word-preview-worker.js',
    import.meta.url,
  );
  const worker = new Worker(entry, {
    workerData: bytes,
    execArgv: [],
    transferList: [bytes.buffer],
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8 },
  });
  const unreadable = () =>
    new AppError('DOCUMENT_UNREADABLE', 'This Word document could not be previewed.', 422);
  let timer: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<Extract<DocumentPreview, { format: 'word' }>>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      timer = setTimeout(
        () => reject(new AppError('DOCUMENT_TIMEOUT', 'Word preview timed out.', 422)),
        wordTimeoutMs,
      );
      worker.once('message', resolve);
      worker.once('error', () => reject(unreadable()));
      worker.once('exit', () => reject(unreadable()));
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener('abort', abort);
    await worker.terminate();
  }
}

export async function previewDocument(
  path: string,
  format: DocumentPreview['format'],
  signal: AbortSignal,
  knownVersion?: string,
): Promise<DocumentPreviewRead> {
  if (format === 'pdf') return readPdf(path, async () => ({ format: 'pdf' }));
  return withFile<DocumentPreviewRead>(
    path,
    maxWordBytes,
    'Word previews are limited to 8 MiB.',
    async (file, size) => {
      signal.throwIfAborted();
      const version = fileVersion(await file.stat({ bigint: true }));
      if (knownVersion === version) return { format: 'unchanged', version };
      if (wordPreviewActive)
        throw new AppError('DOCUMENT_BUSY', 'Word preview is busy. Try again shortly.', 429);
      wordPreviewActive = true;
      try {
        const bytes = new Uint8Array(size + 1);
        let length = 0;
        while (length < bytes.length) {
          signal.throwIfAborted();
          const { bytesRead } = await file.read(bytes, length, bytes.length - length);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length !== size || fileVersion(await file.stat({ bigint: true })) !== version)
          throw new AppError('FILE_CHANGED', 'The selected file changed. Open it again.', 409);
        const preview = await extractWord(bytes.subarray(0, length), signal);
        return { ...preview, version };
      } finally {
        wordPreviewActive = false;
      }
    },
  );
}
