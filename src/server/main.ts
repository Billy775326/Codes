import { mkdirSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { resolve, join } from 'node:path';
import { Driver } from '../codex/driver.js';
import { Store } from './store.js';
import { Service } from './service.js';
import { application } from './http.js';
import { NetworkConfiguration } from './network-settings.js';
import { RuntimeConfiguration } from './runtime-settings.js';
import { AccessToken } from './access-token.js';
import { acquireDataDirectoryLock } from './data-directory-lock.js';
import { dataDirectory } from './data-directory.js';

const directory = dataDirectory();
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
const releaseLock = acquireDataDirectoryLock(directory);
const token = new AccessToken(directory, process.env.CODES_ACCESS_TOKEN);
const mode = process.env.CODES_RUNTIME ?? 'codex';
if (mode !== 'mock' && mode !== 'codex') throw new Error('CODES_RUNTIME must be codex or mock.');
const configuredProjectPath = process.env.CODES_PROJECT_ROOT
  ? resolve(process.env.CODES_PROJECT_ROOT)
  : process.cwd();
const store = new Store(directory);
// A previously registered directory can be temporarily unavailable.
const registered = store.projects().find((project) => project.path === configuredProjectPath);
const initialWorkingDirectory = registered?.path ?? (await realpath(configuredProjectPath));
const service = new Service(
  store,
  new Driver(mode, {
    binary: process.env.CODES_CODEX_BINARY,
    stateFile: join(directory, 'mock-history.json'),
    timeoutMs: runtime.active.requestTimeoutMs,
  }),
  initialWorkingDirectory,
  initialWorkingDirectory,
);
if (!registered) await service.addProject(initialWorkingDirectory);
const app = await application(service, {
  network,
  runtime,
  token,
  dev,
  test: process.env.CODES_TEST_MODE === '1',
});
app.server.listen(port, address, () => {
  console.log(`codes is ready at ${origins.join(', ')}`);
  if (token.created && token.source === 'file')
    console.log(`Use the access token stored in ${token.file} to sign in.`);
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
  releaseLock();
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
