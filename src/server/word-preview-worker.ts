import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const WordExtractor = require('word-extractor') as new () => {
  extract(buffer: Buffer): Promise<{ getBody(): string }>;
};
interface Zip {
  entryCount: number;
  readEntry(): void;
  close(): void;
  once(event: 'end', listener: () => void): void;
  once(event: 'error', listener: (error: Error) => void): void;
  on(event: 'entry', listener: (entry: { uncompressedSize: number }) => void): void;
}
const yauzl = require('yauzl') as {
  fromBuffer(
    buffer: Buffer,
    options: { lazyEntries: true },
    callback: (error: Error | null, zip: Zip) => void,
  ): void;
};

const maxEntries = 1024;
const maxExpandedBytes = 32 * 1024 * 1024;
const maxTextLength = 80_000;

function checkZip(bytes: Buffer) {
  return new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const tooLarge = () => {
        zip.close();
        reject(new Error('Word archive exceeded its preview budget'));
      };
      if (zip.entryCount > maxEntries) return tooLarge();
      let expanded = 0;
      zip.once('error', reject);
      zip.once('end', resolve);
      zip.on('entry', ({ uncompressedSize }) => {
        expanded += uncompressedSize;
        if (expanded > maxExpandedBytes) return tooLarge();
        zip.readEntry();
      });
      zip.readEntry();
    });
  });
}

function checkCompoundFile(bytes: Buffer) {
  const signature = Buffer.from('d0cf11e0a1b11ae1', 'hex');
  if (bytes.length < 512 || !bytes.subarray(0, signature.length).equals(signature))
    throw new Error('Invalid Word compound file');
  // The extractor allocates sector tables from these header fields.
  const sectorShift = bytes.readUInt16LE(30);
  if (![9, 12].includes(sectorShift) || bytes.readUInt16LE(32) !== 6)
    throw new Error('Invalid Word sector size');
  const sectorBytes = 1 << sectorShift;
  const entriesPerSector = sectorBytes / 4;
  const allocationSectors = bytes.readUInt32LE(44);
  const miniAllocationSectors = bytes.readUInt32LE(64);
  const additionalAllocationSectors = bytes.readUInt32LE(72);
  if (
    allocationSectors > Math.ceil(bytes.length / sectorBytes / entriesPerSector) + 1 ||
    miniAllocationSectors > Math.ceil(bytes.length / 64 / entriesPerSector) + 1 ||
    additionalAllocationSectors > Math.ceil(allocationSectors / (entriesPerSector - 1)) + 1
  )
    throw new Error('Invalid Word sector count');
}

const input = workerData as Uint8Array;
const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
if (bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))) await checkZip(bytes);
else checkCompoundFile(bytes);
const text = (await new WordExtractor().extract(bytes)).getBody();
parentPort!.postMessage({
  format: 'word',
  text: text.slice(0, maxTextLength),
  truncated: text.length > maxTextLength,
});
