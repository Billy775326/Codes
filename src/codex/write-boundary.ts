import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { AppError, record } from '../shared/errors.js';
import type { Settings } from '../shared/types.js';

/** Owner-controlled process policy. Conversation preferences cannot widen it. */
export class WriteBoundary {
  readonly root: string;
  constructor(root: string) {
    if (!isAbsolute(root)) throw new AppError('TASK_POLICY', 'Task write root must be absolute.');
    this.root = realpathSync(root);
    if (!statSync(this.root).isDirectory())
      throw new AppError('TASK_POLICY', 'Task write root must be an existing directory.');
  }
  directory(path: string) {
    const canonical = realpathSync(path);
    const rel = relative(this.root, canonical);
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel))
      throw new AppError(
        'TASK_WRITE_BOUNDARY',
        'Choose a project inside the task write root.',
        403,
      );
    return canonical;
  }
  settings(settings: Settings) {
    if (settings.permission === 'danger-full-access')
      throw new AppError(
        'TASK_WRITE_BOUNDARY',
        'Full access is disabled by the server task write boundary.',
        403,
      );
  }
  sandbox(readOnly = false) {
    return readOnly
      ? { type: 'readOnly', networkAccess: false }
      : {
          type: 'workspaceWrite',
          writableRoots: [this.root],
          networkAccess: false,
          excludeTmpdirEnvVar: true,
          excludeSlashTmp: true,
        };
  }
  configuration() {
    return {
      'sandbox_workspace_write.writable_roots': [this.root],
      'sandbox_workspace_write.exclude_tmpdir_env_var': true,
      'sandbox_workspace_write.exclude_slash_tmp': true,
      'sandbox_workspace_write.network_access': false,
      'features.apps': false,
    };
  }
  checkConfiguration(config: unknown) {
    if (!record(config))
      throw new AppError('TASK_POLICY', 'Unable to verify native tool configuration.', 503);
    const enabled = (value: unknown) =>
      record(value) &&
      Object.values(value).some((entry) => !record(entry) || entry.enabled !== false);
    // These processes are outside command/file sandbox enforcement. Refuse them rather than promise confinement.
    if (
      enabled(config.mcp_servers) ||
      enabled(config.plugins) ||
      config.notify ||
      (record(config.hooks) && Object.keys(config.hooks).length)
    )
      throw new AppError(
        'TASK_POLICY_TOOLS',
        'Task write confinement requires MCP servers, plugins and executable hooks to be disabled in the Codex configuration.',
        503,
      );
  }
  params(method: string, raw: unknown): unknown {
    if (
      ![
        'thread/start',
        'thread/resume',
        'thread/fork',
        'turn/start',
        'thread/settings/update',
        'command/exec',
      ].includes(method)
    )
      return raw;
    if (!record(raw)) throw new AppError('TASK_POLICY', 'Invalid native task parameters.');
    const params = { ...raw };
    if (typeof params.cwd === 'string') this.directory(params.cwd);
    if (
      params.sandbox === 'danger-full-access' ||
      (record(params.sandboxPolicy) && params.sandboxPolicy.type === 'dangerFullAccess')
    )
      throw new AppError(
        'TASK_WRITE_BOUNDARY',
        'Full access is disabled by the server task write boundary.',
        403,
      );
    const readOnly =
      (method === 'thread/settings/update' && !params.sandboxPolicy) ||
      params.sandbox === 'read-only' ||
      (record(params.sandboxPolicy) && params.sandboxPolicy.type === 'readOnly');
    delete params.permissions;
    delete params.permissionProfile;
    params.approvalPolicy = 'never';
    if (method.startsWith('thread/') && method !== 'thread/settings/update') {
      params.sandbox = readOnly || method === 'thread/resume' ? 'read-only' : 'workspace-write';
      params.runtimeWorkspaceRoots = [this.root];
      params.config = this.configuration();
    } else {
      params.sandboxPolicy = this.sandbox(readOnly);
      if (method === 'command/exec') delete params.approvalPolicy;
    }
    return params;
  }
}
