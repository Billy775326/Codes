#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manageService, rememberLaunchDirectory, resolveLaunchPaths } from './service-control.mjs';
import { doctor } from './service-doctor.mjs';
import { showServiceLog } from './service-log.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const restoring = args.length === 1 && args[0] === 'restore-database';
const command = args[0] === 'ststus' ? 'status' : args[0];
const managing = args.length === 1 && ['start', 'stop', 'restart', 'status'].includes(command);
const diagnosing = args.length === 1 && command === 'doctor';
const following = args.length === 2 && ['-f', '--follow'].includes(args[1]);
const logging = command === 'logs' && (args.length === 1 || following);
const [major, minor] = process.versions.node.split('.').map(Number);
const supportedNode = major === 24 && minor >= 19;
const built =
  existsSync(join(root, 'dist/server/main.js')) && existsSync(join(root, 'dist/web/index.html'));
if (args.length === 1 && ['--version', '-v'].includes(command)) {
  console.log(`v${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}`);
} else if (args.length === 1 && ['help', '--help', '-h'].includes(command)) {
  console.log(`Usage: codes [command]

Without a command, start Codes in the foreground (default: http://127.0.0.1:6670).
  start             Start Codes in the background.
  stop              Stop the running instance gracefully.
  restart           Restart in the background with the running instance's startup environment.
  status            Show whether Codes is running and print its PID and data directory.
  logs [-f]         Print recent background logs. Add -f to follow new output.
  doctor            Check prerequisites, settings, and the local listener.
  restore-database  Apply a prepared database restore while Codes is stopped.
  --version, -v     Show the installed Codes version.
  help, -h, --help  Show this help.

Configuration uses CODES_* environment variables.
Default data directory: \$XDG_DATA_HOME/codes or ~/.local/share/codes. Existing checkout data is detected.
Relative configuration paths resolve from the calling directory.
Build the application first with npm run build in ${root}`);
} else if (args.length && !restoring && !managing && !diagnosing && !logging) {
  console.error('Unknown arguments. Use codes --help for usage.');
  process.exitCode = 1;
} else if (diagnosing) {
  resolveLaunchPaths(process.env, process.cwd());
  try {
    process.exitCode = await doctor(root, supportedNode, built);
  } catch (error) {
    console.error(`Unable to finish diagnostics: ${error.message}`);
    process.exitCode = 1;
  }
} else if (!supportedNode) {
  console.error('codes requires Node.js 24.19 or newer in the 24.x line.');
  process.exitCode = 1;
} else if (!built && !(logging && existsSync(join(root, 'dist/server/data-directory.js')))) {
  console.error(`Build files are missing. Run npm run build in ${root} before starting codes.`);
  process.exitCode = 1;
} else {
  const caller = process.cwd();
  const initialPaths = {
    CODES_PROJECT_ROOT: process.env.CODES_PROJECT_ROOT,
    CODES_CODEX_BINARY: process.env.CODES_CODEX_BINARY,
  };
  resolveLaunchPaths(process.env, caller);
  process.chdir(root);
  const { dataDirectory } = await import('../dist/server/data-directory.js');
  const directory = dataDirectory();
  try {
    if (managing) process.exitCode = await manageService(command, root, directory, caller);
    else if (logging) {
      process.stdout.on('error', (error) => {
        if (error.code === 'EPIPE') process.exit(0);
        throw error;
      });
      process.exitCode = await showServiceLog(directory, following);
    } else {
      const entry = restoring ? '../dist/server/restore-command.js' : '../dist/server/main.js';
      if (!restoring) process.env.CODES_PROJECT_ROOT ||= caller;
      await import(new URL(entry, import.meta.url).href);
      if (!restoring) {
        try {
          rememberLaunchDirectory(directory, caller, initialPaths);
        } catch (error) {
          console.error(`Unable to record the working directory for restart: ${error.message}`);
        }
      }
    }
  } catch (error) {
    if (managing || logging) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } else {
      // Recognize the lock error from existing builds as well as the current build.
      // Other startup failures retain their original diagnostic and exit behavior.
      if (!(error instanceof Error) || error.message !== 'The data directory is already in use.')
        throw error;
      let pid;
      try {
        const owner = Number(readFileSync(join(directory, 'server.lock'), 'utf8'));
        if (Number.isSafeInteger(owner) && owner > 0) pid = owner;
      } catch (readError) {
        // The existing process may have released the lock after rejecting this start.
        if (readError.code !== 'ENOENT') throw readError;
      }
      console.error('codes did not start: the data directory is already in use.');
      console.error(`Data directory: ${directory}`);
      if (pid) console.error(`Lock owner PID: ${pid}`);
      console.error(
        'Use the existing workspace. This command does not restart it or remove its lock.',
      );
      process.exitCode = 1;
    }
  }
}
