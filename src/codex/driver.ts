import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Rpc } from './rpc.js';
import { AppError, record } from '../shared/errors.js';
import { inspectNativeProtocol, installedCodexVersion, type NativeProtocol } from './protocol.js';
import type { CodexCapabilities, System } from '../shared/types.js';

export class Driver extends EventEmitter {
  epoch = randomUUID();
  private child?: ChildProcessWithoutNullStreams;
  private rpc?: Rpc;
  private starting?: Promise<void>;
  private retiring?: Promise<void>;
  private stopping = false;
  private version?: string;
  private protocol?: NativeProtocol;
  private launchedDirectory?: string;
  private error?: string;
  state = 'not_started';
  constructor(
    readonly mode: 'codex' | 'mock',
    private options: {
      binary?: string;
      stateFile: string;
      timeoutMs?: number;
      startupDirectory?: string;
    },
  ) {
    super();
  }
  system(): System {
    return {
      runtime: this.mode,
      state: this.state,
      version: this.mode === 'mock' ? 'simulator' : (this.version ?? 'Not reported'),
      capabilities: this.protocol?.capabilities,
      error: this.error,
    };
  }
  async start(): Promise<void> {
    if (this.stopping) throw new AppError('RUNTIME_OFFLINE', 'The runtime is stopping.', 503);
    if (this.state === 'ready') return;
    if (this.starting) return this.starting;
    this.error = undefined;
    this.starting = this.launch();
    try {
      await this.starting;
    } catch (error) {
      this.state = 'unavailable';
      this.error =
        error instanceof AppError ? error.message : 'Unable to start the Codex App Server.';
      throw error;
    } finally {
      this.starting = undefined;
    }
  }
  private async usableStartupDirectory() {
    const directory = this.options.startupDirectory;
    if (!directory) return;
    try {
      if ((await realpath(directory)) !== directory || !(await stat(directory)).isDirectory())
        return;
      await access(directory, constants.X_OK);
      return directory;
    } catch (error) {
      // Native history must remain readable when the startup directory is unavailable.
      if (record(error) && ['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM'].includes(error.code))
        return;
      throw error;
    }
  }
  private async launch() {
    await this.retiring;
    if (this.stopping) throw new AppError('RUNTIME_OFFLINE', 'The runtime is stopping.', 503);
    this.state = 'starting';
    this.epoch = randomUUID();
    const compiled = new URL('./simulator.js', import.meta.url);
    const binary = this.mode === 'mock' ? process.execPath : (this.options.binary ?? 'codex');
    const cwd = await this.usableStartupDirectory();
    if (this.mode === 'codex') {
      this.version = await installedCodexVersion(binary, cwd);
      if (this.protocol?.version !== this.version) {
        this.protocol = undefined;
        this.protocol = await inspectNativeProtocol(binary, this.version, cwd);
      }
    }
    if (this.stopping) throw new AppError('RUNTIME_OFFLINE', 'The runtime is stopping.', 503);
    const args =
      this.mode === 'mock'
        ? existsSync(compiled)
          ? [fileURLToPath(compiled)]
          : [
              '--import',
              import.meta.resolve('tsx'),
              fileURLToPath(new URL('./simulator.ts', import.meta.url)),
            ]
        : ['app-server', '--listen', 'stdio://'];
    const child = spawn(binary, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env, CODES_MOCK_STATE_FILE: this.options.stateFile },
    });
    this.child = child;
    // Consume stderr without copying CLI output or credentials into application logs.
    child.stderr.on('data', () => {});
    const rpc = new Rpc(child.stdin, child.stdout, this.options.timeoutMs);
    this.rpc = rpc;
    rpc.on('notification', (value) => this.emit('notification', value));
    rpc.on('request', (value) => this.emit('request', value));
    rpc.once('offline', () => {
      this.state = 'unavailable';
      this.emit('offline');
      this.retiring = this.terminate(child);
    });
    child.once('error', () => rpc.fail());
    child.once('exit', () => rpc.fail());
    try {
      const initialized = await rpc.request('initialize', {
        clientInfo: { name: 'codes', title: 'codes', version: '0.0.0' },
        capabilities: { experimentalApi: true },
      });
      if (!record(initialized) || typeof initialized.userAgent !== 'string')
        throw new AppError(
          'CLI_PROTOCOL_UNSUPPORTED',
          'The Codex App Server returned invalid initialization metadata.',
          502,
        );
      await rpc.notify('initialized');
      this.launchedDirectory = cwd;
      this.state = 'ready';
      this.emit('ready');
    } catch (error) {
      child.kill('SIGTERM');
      this.state = 'unavailable';
      throw error;
    }
  }
  supports(feature: keyof CodexCapabilities) {
    return this.mode === 'mock' || (this.protocol?.capabilities[feature] ?? true);
  }
  supportsMethod(method: string) {
    return this.mode === 'mock' || !this.protocol || this.protocol.requests.has(method);
  }
  async requireFeature(feature: keyof CodexCapabilities, label: string) {
    await this.start();
    if (!this.supports(feature))
      throw new AppError(
        'CLI_FEATURE_UNAVAILABLE',
        label + ' is unavailable with the installed Codex CLI.',
        412,
      );
  }
  async call(method: string, params: unknown, timeoutMs?: number) {
    await this.start();
    if (!this.supportsMethod(method))
      throw new AppError(
        'CLI_FEATURE_UNAVAILABLE',
        'The installed Codex CLI does not support ' + method + '.',
        412,
      );
    return this.rpc!.request(method, params, timeoutMs);
  }
  async startThread(cwd: string) {
    await this.start();
    return this.call('thread/start', cwd === this.launchedDirectory ? {} : { cwd });
  }
  answer(id: string | number, result: unknown) {
    if (!this.rpc || this.state !== 'ready')
      throw new AppError('STALE_ACTION', 'This request belongs to an offline CLI.', 409);
    return this.rpc.answer(id, result);
  }
  reject(id: string | number) {
    return this.rpc?.reject(id);
  }
  async stop() {
    this.stopping = true;
    this.rpc?.fail();
    // Startup may be in the version probe; prevent it from spawning after shutdown.
    await this.starting?.catch(() => undefined);
    await this.retiring;
    if (this.child) await this.terminate(this.child);
    this.child = undefined;
    this.state = 'stopped';
  }
  private async terminate(child: ChildProcessWithoutNullStreams) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }
}
