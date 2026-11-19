import { EventEmitter } from 'node:events';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { WriteBoundary } from './write-boundary.js';
import { Rpc } from './rpc.js';
import { AppError } from '../shared/errors.js';
import type { System } from '../shared/types.js';

export class Driver extends EventEmitter {
  epoch = randomUUID();
  private child?: ChildProcessWithoutNullStreams;
  private rpc?: Rpc;
  private starting?: Promise<void>;
  private retiring?: Promise<void>;
  private stopping = false;
  state = 'not_started';
  constructor(
    readonly mode: 'codex' | 'mock',
    private options: {
      binary?: string;
      stateFile: string;
      timeoutMs?: number;
      codeQuestions?: boolean;
      writeBoundary?: WriteBoundary;
    },
  ) {
    super();
  }
  get writeBoundary() {
    return this.options.writeBoundary;
  }
  system(): System {
    return {
      runtime: this.mode,
      state: this.state,
      version: this.mode === 'mock' ? 'simulator' : '0.167.0',
      codeQuestions: this.options.codeQuestions !== false,
      ...(this.writeBoundary ? { taskWriteRoot: this.writeBoundary.root } : {}),
    };
  }
  async start(): Promise<void> {
    if (this.stopping) throw new AppError('RUNTIME_OFFLINE', 'The runtime is stopping.', 503);
    if (this.state === 'ready') return;
    if (this.starting) return this.starting;
    this.starting = this.launch();
    try {
      await this.starting;
    } catch (error) {
      this.state = 'unavailable';
      throw error;
    } finally {
      this.starting = undefined;
    }
  }
  private async launch() {
    await this.retiring;
    if (this.stopping) throw new AppError('RUNTIME_OFFLINE', 'The runtime is stopping.', 503);
    this.state = 'starting';
    this.epoch = randomUUID();
    const compiled = new URL('./simulator.js', import.meta.url);
    const binary = this.mode === 'mock' ? process.execPath : (this.options.binary ?? 'codex');
    if (this.mode === 'codex') {
      const { stdout } = await promisify(execFile)(binary, ['--version'], {
        timeout: 5000,
        maxBuffer: 4096,
      });
      if (stdout.trim() !== 'codex-cli 0.167.0') {
        this.state = 'unavailable';
        throw new AppError(
          'CLI_VERSION',
          'This build supports Codex CLI 0.167.0. Check your CLI version before continuing.',
          412,
        );
      }
    }
    if (this.stopping) throw new AppError('RUNTIME_OFFLINE', 'The runtime is stopping.', 503);
    const args =
      this.mode === 'mock'
        ? existsSync(compiled)
          ? [fileURLToPath(compiled)]
          : ['--import', 'tsx', fileURLToPath(new URL('./simulator.ts', import.meta.url))]
        : [
            'app-server',
            '--listen',
            'stdio://',
            '-c',
            'features.default_mode_request_user_input=' + (this.options.codeQuestions !== false),
            '-c',
            'features.fast_mode=true',
            ...(this.writeBoundary
              ? Object.entries(this.writeBoundary.configuration()).flatMap(([key, value]) => [
                  '-c',
                  key + '=' + JSON.stringify(value),
                ])
              : []),
          ];
    const child = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      ...(this.writeBoundary ? { cwd: this.writeBoundary.root } : {}),
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
      await rpc.request('initialize', {
        clientInfo: { name: 'codes', title: 'codes', version: '0.0.0' },
        capabilities: { experimentalApi: true },
      });
      await rpc.notify('initialized');
      if (this.mode === 'codex' && this.writeBoundary) {
        const configuration = await rpc.request('config/read', { includeLayers: false });
        this.writeBoundary.checkConfiguration(configuration.config);
      }
      this.state = 'ready';
    } catch (error) {
      child.kill('SIGTERM');
      this.state = 'unavailable';
      throw error;
    }
  }
  async call(method: string, params: unknown, timeoutMs?: number) {
    const bounded = this.writeBoundary?.params(method, params) ?? params;
    await this.start();
    if (
      this.mode === 'codex' &&
      this.writeBoundary &&
      ['thread/start', 'thread/resume', 'thread/fork'].includes(method)
    ) {
      const configuration = await this.rpc!.request('config/read', {
        includeLayers: false,
        cwd: (bounded as { cwd?: string }).cwd,
      });
      this.writeBoundary.checkConfiguration(configuration.config);
    }
    const result = await this.rpc!.request(method, bounded, timeoutMs);
    if (
      this.writeBoundary &&
      method === 'thread/resume' &&
      result.thread?.status?.type === 'active'
    )
      throw new AppError(
        'TASK_POLICY_ACTIVE',
        'Finish the existing native task before using this conversation with the write boundary.',
        409,
      );
    return result;
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
