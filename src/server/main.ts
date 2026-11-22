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
import { lookup } from 'node:dns/promises';
import { resolve, join } from 'node:path';
import { Driver } from '../codex/driver.js';
import { Store } from './store.js';
import { Service } from './service.js';
import { application } from './http.js';
import { NetworkConfiguration } from './network-settings.js';
import { RuntimeConfiguration } from './runtime-settings.js';

const directory = resolve(process.env.CODES_DATA_DIR ?? '.local');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const network = new NetworkConfiguration(directory, process.env);
const runtime = new RuntimeConfiguration(directory, process.env);
const dev = process.argv.includes('--dev');
if (dev && network.active.authMode === 'cloudflare-access')
  throw new Error('Cloudflare Access mode requires the built Codes server.');
const { host, port, origins } = network.active;
const address = host === 'localhost' ? (await lookup(host)).address : host;
if (address !== '127.0.0.1' && address !== '::1')
  throw new Error('The listen address must resolve to 127.0.0.1 or ::1.');
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
const mode = process.env.CODES_RUNTIME ?? 'codex';
if (mode !== 'mock' && mode !== 'codex') throw new Error('CODES_RUNTIME must be codex or mock.');
const service = new Service(
  new Store(directory),
  new Driver(mode, {
    binary: process.env.CODES_CODEX_BINARY,
    stateFile: join(directory, 'mock-history.json'),
    codeQuestions: runtime.active.codeQuestions,
    timeoutMs: runtime.active.requestTimeoutMs,
  }),
);
if (process.env.CODES_PROJECT_ROOT) {
  const configured = resolve(process.env.CODES_PROJECT_ROOT);
  // Existing registrations must stay readable when a directory is temporarily absent.
  if (!service.store.projects().some((project) => project.path === configured))
    await service.addProject(configured);
}
const app = await application(service, {
  network,
  runtime,
  token,
  dev,
  test: process.env.CODES_TEST_MODE === '1',
});
app.server.listen(port, address, () => {
  console.log(`codes is ready at ${origins.join(', ')}`);
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
