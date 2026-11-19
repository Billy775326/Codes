import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import { Driver } from '../codex/driver.js';
import { Store } from './store.js';
import { Service } from './service.js';
import { application } from './http.js';

const directory = resolve(process.env.CODES_DATA_DIR ?? '.local');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const lock = join(directory, 'server.lock');
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error('Invalid data directory lock. Inspect it before starting.');
  try {
    process.kill(pid, 0);
    throw new Error('The data directory is already in use.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    unlinkSync(lock);
  }
}
const descriptor = openSync(lock, 'wx', 0o600);
writeFileSync(descriptor, String(process.pid));
closeSync(descriptor);
const tokenPath = join(directory, 'access-token');
if (!existsSync(tokenPath))
  writeFileSync(tokenPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
const token = process.env.CODES_ACCESS_TOKEN ?? readFileSync(tokenPath, 'utf8').trim();
if (token.length < 16) throw new Error('CODES_ACCESS_TOKEN must contain at least 16 characters.');
const host = process.env.CODES_HOST ?? '127.0.0.1';
const port = Number(process.env.CODES_PORT ?? 6670);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error('Choose a CODES_PORT between 1024 and 65535.');
const origin = process.env.CODES_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`;
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !origin.startsWith('https://'))
  throw new Error(
    'Remote access requires an HTTPS CODES_PUBLIC_ORIGIN and an authenticated reverse proxy.',
  );
const mode = process.env.CODES_RUNTIME ?? 'codex';
if (mode !== 'mock' && mode !== 'codex') throw new Error('CODES_RUNTIME must be codex or mock.');
if (process.env.CODES_CODE_QUESTIONS && !['0', '1'].includes(process.env.CODES_CODE_QUESTIONS))
  throw new Error('CODES_CODE_QUESTIONS must be 0 or 1.');
const service = new Service(
  new Store(directory),
  new Driver(mode, {
    binary: process.env.CODES_CODEX_BINARY,
    stateFile: join(directory, 'mock-history.json'),
    codeQuestions: process.env.CODES_CODE_QUESTIONS !== '0',
  }),
);
if (process.env.CODES_PROJECT_ROOT) await service.addProject(process.env.CODES_PROJECT_ROOT);
const app = await application(service, {
  host,
  port,
  origin,
  token,
  dev: process.argv.includes('--dev'),
  test: process.env.CODES_TEST_MODE === '1',
});
app.server.listen(port, host, () => {
  console.log(`codes is ready at ${origin}`);
  console.log(`Use the access token stored in ${tokenPath} to sign in.`);
  if (mode === 'mock')
    console.log('Simulation mode: no model requests or shell commands are executed.');
});
service.store.prune();
const pruning = setInterval(() => service.store.prune(), 3600_000);
pruning.unref();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(pruning);
  await app.close();
  unlinkSync(lock);
}
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
app.server.once('error', async () => {
  console.error('Unable to start the codes listener. Check the port and origin configuration.');
  await stop();
  process.exitCode = 1;
});
