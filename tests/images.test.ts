import { mkdtemp, rm, stat, writeFile, mkdir, truncate, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { Images } from '../src/server/images';
import { imageLimits } from '../src/shared/images';
import { imagePng } from './fixtures/image';
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'codes-images-'));
  directories.push(directory);
  return { directory, images: new Images(directory), project: randomUUID() };
}
it('deduplicates private images, preserves them across restart, and scopes reads to their project', async () => {
  const { images, project, directory } = await fixture();
  const [first, second] = await Promise.all([
    images.save(project, imagePng, 'capture.png', 'image/png'),
    images.save(project, imagePng, 'capture.png', 'image/png'),
  ]);
  expect(first.id).toBe(second.id);
  const result = await new Images(directory).read(project, first.id);
  expect(result.bytes).toEqual(imagePng);
  expect((await stat(result.path)).mode & 0o777).toBe(0o600);
  expect((await stat(join(directory, 'images', project))).mode & 0o777).toBe(0o700);
  await expect(images.read(randomUUID(), first.id)).rejects.toMatchObject({
    code: 'IMAGE_NOT_FOUND',
  });
  await expect(images.read(project, '../secret')).rejects.toMatchObject({
    code: 'IMAGE_NOT_FOUND',
  });
  expect(images.reference(project, result.path)).toMatchObject({ id: first.id });
  expect(images.reference(randomUUID(), result.path)).toBeUndefined();
});
it('rejects unsupported, mismatched, oversized and excessive-dimension images', async () => {
  const { images, project } = await fixture();
  await expect(
    images.save(project, Buffer.from('<svg/>'), 'bad.svg', 'image/png'),
  ).rejects.toMatchObject({ code: 'IMAGE_FORMAT' });
  await expect(images.save(project, imagePng, 'bad.jpg', 'image/jpeg')).rejects.toMatchObject({
    code: 'IMAGE_FORMAT',
  });
  await expect(
    images.save(project, Buffer.alloc(imageLimits.bytes + 1), 'large.png', 'image/png'),
  ).rejects.toMatchObject({ code: 'IMAGE_LIMIT' });
  const bomb = Buffer.from(imagePng);
  bomb.writeUInt32BE(100_000, 16);
  bomb.writeUInt32BE(100_000, 20);
  await expect(images.save(project, bomb, 'large-pixels.png', 'image/png')).rejects.toMatchObject({
    code: 'IMAGE_FORMAT',
  });
});
it('does not dispatch substituted image bytes under an existing content reference', async () => {
  const { images, project } = await fixture();
  const image = await images.save(project, imagePng, 'capture.png', 'image/png');
  const { path } = await images.read(project, image.id);
  await writeFile(path, Buffer.concat([imagePng, Buffer.from('changed')]));
  await expect(images.read(project, image.id)).rejects.toMatchObject({ code: 'IMAGE_CHANGED' });
});
it('bounds stored bytes and file count while allowing recovery after a rejected admission', async () => {
  const { images, project, directory } = await fixture();
  const folder = join(directory, 'images', project);
  await mkdir(folder, { recursive: true });
  const temporary = join(folder, 'interrupted.tmp');
  await writeFile(temporary, '');
  await truncate(temporary, imageLimits.storageBytes);
  await expect(images.save(project, imagePng, 'capture.png', 'image/png')).rejects.toMatchObject({
    code: 'IMAGE_STORAGE_FULL',
  });
  await unlink(temporary);
  const files = Array.from({ length: imageLimits.files }, (_, index) =>
    join(folder, index + '.tmp'),
  );
  await Promise.all(files.map((file) => writeFile(file, '')));
  await expect(images.save(project, imagePng, 'capture.png', 'image/png')).rejects.toMatchObject({
    code: 'IMAGE_STORAGE_FULL',
  });
  await unlink(files[0]!);
  await expect(images.save(project, imagePng, 'capture.png', 'image/png')).resolves.toMatchObject({
    kind: 'image',
  });
});
