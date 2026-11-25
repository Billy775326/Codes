import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppError, record } from '../shared/errors.js';
import type { CodexCapabilities } from '../shared/types.js';

const execute = promisify(execFile);
const probeTimeout = 8_000;
const mandatory = {
  initialize: ['clientInfo', 'capabilities'],
  'config/read': ['cwd', 'includeLayers'],
  'model/list': ['limit'],
  'collaborationMode/list': [],
  'thread/list': ['cwd', 'limit', 'archived', 'cursor'],
  'thread/read': ['threadId', 'includeTurns'],
  'thread/turns/list': ['threadId', 'itemsView', 'cursor', 'sortDirection', 'limit'],
  'thread/start': ['cwd', 'ephemeral'],
  'thread/resume': ['threadId', 'excludeTurns', 'cwd'],
  'thread/unsubscribe': ['threadId'],
  'thread/name/set': ['threadId', 'name'],
  'thread/archive': ['threadId'],
  'thread/unarchive': ['threadId'],
  'turn/start': ['threadId', 'input', 'clientUserMessageId', 'collaborationMode'],
  'turn/steer': ['threadId', 'input', 'expectedTurnId', 'clientUserMessageId'],
  'turn/interrupt': ['threadId', 'turnId'],
};

export async function installedCodexVersion(binary: string) {
  const output = await execute(binary, ['--version'], {
    timeout: probeTimeout,
    maxBuffer: 4096,
  }).catch(() => {
    throw new AppError('CLI_UNAVAILABLE', 'The Codex CLI executable could not be started.', 503);
  });
  const match = /^codex(?:-cli)?\s+(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?)$/.exec(
    output.stdout.trim(),
  );
  if (!match)
    throw new AppError(
      'CLI_VERSION',
      'The configured executable did not report a Codex CLI version.',
      412,
    );
  return match[1]!;
}

function methods(schema: unknown) {
  if (!record(schema) || !Array.isArray(schema.oneOf)) throw new Error('Invalid App Server schema');
  const result = new Map<string, Set<string>>();
  for (const variant of schema.oneOf) {
    if (!record(variant) || !record(variant.properties)) continue;
    const name = variant.properties.method?.enum?.[0];
    if (typeof name !== 'string') continue;
    let params = variant.properties.params;
    if (typeof params?.$ref === 'string')
      params = schema.definitions?.[params.$ref.split('/').at(-1)];
    result.set(name, new Set(Object.keys(params?.properties ?? {})));
  }
  return result;
}

export interface NativeProtocol {
  version: string;
  requests: ReadonlySet<string>;
  capabilities: CodexCapabilities;
  codeQuestions: boolean;
}

export async function inspectNativeProtocol(
  binary: string,
  version: string,
): Promise<NativeProtocol> {
  const directory = await mkdtemp(join(tmpdir(), 'codes-protocol-'));
  let client: Map<string, Set<string>>;
  let server: Map<string, Set<string>>;
  try {
    await execute(
      binary,
      ['app-server', 'generate-json-schema', '--experimental', '--out', directory],
      {
        timeout: probeTimeout,
        maxBuffer: 64 * 1024,
      },
    );
    const [clientSchema, serverSchema] = await Promise.all([
      readFile(join(directory, 'ClientRequest.json'), 'utf8'),
      readFile(join(directory, 'ServerRequest.json'), 'utf8'),
    ]);
    client = methods(JSON.parse(clientSchema));
    server = methods(JSON.parse(serverSchema));
  } catch {
    throw new AppError(
      'CLI_PROTOCOL_UNSUPPORTED',
      'Codex CLI ' + version + ' could not provide its App Server protocol schema.',
      412,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const supports = (method: string, fields: string[] = []) => {
    const shape = client.get(method);
    return !!shape && fields.every((field) => shape.has(field));
  };
  for (const [method, fields] of Object.entries(mandatory)) {
    if (!supports(method, fields))
      throw new AppError(
        'CLI_PROTOCOL_UNSUPPORTED',
        'Codex CLI ' + version + ' does not support the required ' + method + ' contract.',
        412,
      );
  }
  if (
    !server.has('item/commandExecution/requestApproval') ||
    !server.has('item/fileChange/requestApproval')
  )
    throw new AppError(
      'CLI_PROTOCOL_UNSUPPORTED',
      'The installed Codex CLI lacks the required approval callbacks.',
      412,
    );
  const capabilities: CodexCapabilities = {
    itemHistory: supports('thread/items/list', [
      'threadId',
      'turnId',
      'cursor',
      'limit',
      'sortDirection',
    ]),
    branch: supports('thread/fork', ['threadId', 'lastTurnId', 'cwd', 'excludeTurns']),
    review:
      supports('review/start') &&
      supports('thread/settings/update', [
        'threadId',
        'cwd',
        'sandboxPolicy',
        'approvalPolicy',
        'approvalsReviewer',
        'collaborationMode',
        'serviceTier',
      ]),
    turnSpeed: supports('turn/start', ['serviceTierForTurn']),
  };
  const featureList = server.has('item/tool/requestUserInput')
    ? await execute(binary, ['features', 'list'], {
        timeout: probeTimeout,
        maxBuffer: 64 * 1024,
      }).then(
        (result) => result.stdout,
        () => '',
      )
    : '';
  return {
    version,
    requests: new Set(client.keys()),
    capabilities,
    codeQuestions: /^default_mode_request_user_input\s/m.test(featureList),
  };
}
