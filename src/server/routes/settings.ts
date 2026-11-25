import { z } from 'zod';
import { AppError } from '../../shared/errors.js';
import { codexInstructionFiles } from '../../shared/project-instructions.js';
import { diagnosticMinutes } from '../../shared/workspace-settings.js';
import { body, json, type HttpRequest, type RouteResult } from '../http-io.js';
import type { NetworkConfiguration } from '../network-settings.js';
import type { ReadDiagnostics } from '../read-diagnostics.js';
import { RestoreStaging } from '../restore-staging.js';
import type { RuntimeConfiguration } from '../runtime-settings.js';
import type { Service } from '../service.js';
import { WorkspaceBackup } from '../workspace-backup.js';
import { instructionsUpdate } from './instructions-input.js';

export function createSettingsRoutes(
  service: Service,
  network: NetworkConfiguration,
  runtime: RuntimeConfiguration | undefined,
  diagnostics: ReadDiagnostics,
) {
  const workspaceBackup = new WorkspaceBackup(service.store.db);
  const restoreStaging = new RestoreStaging(service.store.directory);

  return {
    async handle({ request, response, url, method }: HttpRequest): RouteResult {
      if (url.pathname === '/api/settings/codex-instructions') {
        if (method === 'GET') return json(response, await service.globalInstructions());
        if (method === 'PUT') {
          const update = instructionsUpdate
            .extend({ filename: z.enum(codexInstructionFiles) })
            .strict()
            .parse(await body(request));
          return json(response, await service.globalInstructions(update));
        }
      }
      if (url.pathname === '/api/settings/workspace') {
        if (method === 'GET') return json(response, service.workspaceSettings.snapshot());
        if (method === 'PATCH')
          return json(response, await service.saveWorkspaceSettings(await body(request)));
      }
      if (url.pathname === '/api/settings/diagnostics') {
        if (method === 'GET') return json(response, diagnostics.status());
        if (method === 'POST') {
          const { minutes } = z
            .object({ minutes: z.literal([0, ...diagnosticMinutes]) })
            .strict()
            .parse(await body(request));
          return json(response, diagnostics.setMinutes(minutes));
        }
      }
      if (url.pathname === '/api/settings/restore') {
        if (method === 'GET') return json(response, await restoreStaging.status());
        if (method === 'POST') return json(response, await restoreStaging.stage(request));
        if (method === 'DELETE') {
          const pending = z
            .object({ bytes: z.number().int().positive(), stagedAt: z.number().int() })
            .strict()
            .parse(await body(request));
          return json(response, await restoreStaging.clear(pending));
        }
      }
      if (url.pathname === '/api/settings/backup' && method === 'POST')
        return await workspaceBackup.download(response);
      if (url.pathname === '/api/settings/defaults' && method === 'GET')
        return json(response, service.store.settingsProfile());
      if (url.pathname === '/api/settings/defaults' && method === 'PUT')
        throw new AppError('SETTINGS_RETIRED', 'Edit the native Codex configuration.', 410);
      if (url.pathname === '/api/settings/network' && method === 'GET')
        return json(response, network.snapshot());
      if (url.pathname === '/api/settings/network' && method === 'PUT')
        return json(response, network.save(await body(request)));
      if (url.pathname === '/api/settings/runtime' && runtime) {
        if (method === 'GET') return json(response, runtime.snapshot());
        if (method === 'PUT') return json(response, runtime.save(await body(request)));
      }
      return false;
    },
    close: () => Promise.all([workspaceBackup.close(), restoreStaging.close()]),
  };
}
