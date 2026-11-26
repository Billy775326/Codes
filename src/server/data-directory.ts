import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function dataDirectory(env = process.env, root = process.cwd()) {
  if (env.CODES_DATA_DIR) return resolve(root, env.CODES_DATA_DIR);
  const legacy = join(root, '.local');
  if (existsSync(join(legacy, 'codes.sqlite'))) return legacy;
  const xdg = env.XDG_DATA_HOME;
  const parent = xdg?.startsWith('/') ? xdg : join(homedir(), '.local', 'share');
  return join(parent, 'codes');
}
