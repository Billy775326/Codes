import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDirectory } from '../src/server/data-directory.js';
import { webEntrySignature } from '../src/shared/web-build.js';

const maxAssetsBytes = 96 * 1024 * 1024;
const maxIndexBytes = 128 * 1024;
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

async function files(root: string, omit: Set<string>, prefix = ''): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? prefix + '/' + entry.name : entry.name;
    if (omit.has(path)) continue;
    if (entry.isDirectory()) {
      for (const [name, hash] of await files(root, omit, path)) result.set(name, hash);
    } else if (entry.isFile()) result.set(path, digest(await readFile(join(root, path))));
    else throw new Error('The build must contain regular files and directories.');
  }
  return result;
}

const fingerprint = (tree: Map<string, string>) =>
  digest(JSON.stringify([...tree.entries()].sort()));

async function replaceFile(target: string, content: string | Buffer) {
  const temp = join(dirname(target), '.codes-web-' + randomUUID());
  try {
    await writeFile(temp, content, { flag: 'wx', mode: 0o600 });
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
}

function validEntry(entry: string, assets: Set<string>) {
  const signature = webEntrySignature(entry);
  return (
    Buffer.byteLength(entry) <= maxIndexBytes &&
    !!signature &&
    signature.split(',').every((path) => assets.has(path.slice('/assets/'.length)))
  );
}

export async function switchWebPreview(dist: string, stateDirectory: string, candidate?: string) {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const lockPath = join(stateDirectory, 'switch.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    const currentWeb = join(dist, 'web');
    const indexPath = join(currentWeb, 'index.html');
    const statePath = join(stateDirectory, 'previous.json');
    const currentEntry = await readFile(indexPath, 'utf8');
    const serverOutput = new Set(['web']);
    const server = fingerprint(await files(dist, serverOutput));
    if (!(await stat(join(dist, 'server/main.js'))).isFile())
      throw new Error('The active build is missing its server entry.');
    const activeAssets = await files(join(currentWeb, 'assets'), new Set());
    if (!candidate) {
      const prior: unknown = JSON.parse(await readFile(statePath, 'utf8'));
      if (
        !prior ||
        typeof prior !== 'object' ||
        !('server' in prior) ||
        prior.server !== server ||
        !('installed' in prior) ||
        !('previous' in prior) ||
        typeof prior.previous !== 'string' ||
        !validEntry(prior.previous, new Set(activeAssets.keys()))
      )
        throw new Error('The rollback does not match the active backend or retained assets.');
      if (currentEntry === prior.previous) return;
      if (prior.installed !== digest(currentEntry))
        throw new Error('The current web entry has changed since the previous switch.');
      await replaceFile(indexPath, prior.previous);
      return;
    }
    if (fingerprint(await files(candidate, serverOutput)) !== server)
      throw new Error('The candidate has different backend output. Use a full preview update.');
    const candidateWeb = join(candidate, 'web');
    const publicFiles = new Set(['assets', 'index.html']);
    if (
      fingerprint(await files(candidateWeb, publicFiles)) !==
      fingerprint(await files(currentWeb, publicFiles))
    )
      throw new Error(
        'The candidate changes an unversioned public file. Use a full preview update.',
      );
    const nextEntry = await readFile(join(candidateWeb, 'index.html'), 'utf8');
    const nextAssets = await files(join(candidateWeb, 'assets'), new Set());
    if (
      !validEntry(nextEntry, new Set(nextAssets.keys())) ||
      !validEntry(currentEntry, new Set(activeAssets.keys()))
    )
      throw new Error('An entry references missing or invalid versioned assets.');
    const additions: string[] = [];
    let totalBytes = 0;
    for (const name of activeAssets.keys())
      totalBytes += (await stat(join(currentWeb, 'assets', name))).size;
    for (const [name, hash] of nextAssets) {
      if (!/^[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(name))
        throw new Error('Candidate assets must have versioned filenames.');
      const existing = activeAssets.get(name);
      if (existing && existing !== hash)
        throw new Error('A candidate asset would overwrite a retained version.');
      if (!existing) {
        totalBytes += (await stat(join(candidateWeb, 'assets', name))).size;
        additions.push(name);
      }
    }
    if (totalBytes > maxAssetsBytes)
      throw new Error('The retained web assets exceed 96 MiB. Use a full preview update.');
    if (currentEntry === nextEntry) return;
    for (const name of additions) {
      const bytes = await readFile(join(candidateWeb, 'assets', name));
      if (digest(bytes) !== nextAssets.get(name))
        throw new Error('A candidate asset changed during installation.');
      await replaceFile(join(currentWeb, 'assets', name), bytes);
    }
    await replaceFile(
      statePath,
      JSON.stringify({ server, installed: digest(nextEntry), previous: currentEntry }),
    );
    await replaceFile(indexPath, nextEntry);
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, candidate, extra] = process.argv.slice(2);
  if (extra || (!(action === 'install' && candidate) && !(action === 'rollback' && !candidate))) {
    console.error('Usage: npm run preview:web -- install <candidate-dist> | rollback');
    process.exitCode = 2;
  } else {
    try {
      const dist = resolve('dist');
      await switchWebPreview(
        dist,
        join(dataDirectory(), 'web-preview'),
        candidate ? resolve(candidate) : undefined,
      );
      console.log(
        action === 'rollback' ? 'Previous web entry is active.' : 'Candidate web entry is active.',
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Web preview switch failed.');
      process.exitCode = 1;
    }
  }
}
