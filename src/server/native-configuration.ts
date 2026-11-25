import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Driver } from '../codex/driver.js';
import { AppError } from '../shared/errors.js';
import {
  nativeConfigurationEdits,
  type NativeConfigurationEdits,
  type NativeConfigurationSnapshot,
  type NativeExecutionSettings,
} from '../shared/native-configuration.js';

const label = z.string().min(1).max(200).nullish();
const source = z.object({ type: z.string().max(60), profile: label });
const layer = z.object({
  name: source,
  version: z.string().min(1).max(512),
  disabledReason: label,
});
const publicSources = new Set([
  ...Object.keys(nativeConfigurationEdits.shape.changes.shape),
  'sandbox_mode',
]);
const approvalPolicy = z.union([z.string().max(80), z.record(z.string(), z.unknown())]).nullish();
const responseSchema = z.object({
  config: z.object({
    model: label,
    model_reasoning_effort: label,
    plan_mode_reasoning_effort: label,
    service_tier: label,
    default_permissions: label,
    sandbox_mode: label,
    approval_policy: approvalPolicy,
    approvals_reviewer: label,
    features: z
      .object({
        fast_mode: z.boolean().nullish(),
        default_mode_request_user_input: z.boolean().nullish(),
      })
      .nullish(),
  }),
  layers: z.array(layer).nullish(),
  origins: z.record(z.string(), layer.pick({ name: true, version: true })).optional(),
});

const runtimeSchema = z.object({
  model: label,
  reasoningEffort: label,
  effort: label,
  serviceTier: label,
  activePermissionProfile: z.object({ id: label }).nullish(),
  sandbox: z
    .object({
      type: z.enum(['readOnly', 'workspaceWrite', 'dangerFullAccess', 'externalSandbox']),
    })
    .passthrough()
    .nullish(),
  sandboxPolicy: z.object({ type: z.string().max(80) }).nullish(),
  approvalPolicy,
  approvalsReviewer: label,
  collaborationMode: z
    .object({
      mode: z.enum(['default', 'plan']),
      settings: z.object({ model: label, reasoning_effort: label }).optional(),
    })
    .nullish(),
});

function approvalLabel(policy: z.infer<typeof approvalPolicy>) {
  if (typeof policy === 'string') return policy;
  return policy && Object.hasOwn(policy, 'granular') ? 'granular' : undefined;
}

export function nativeExecutionSettings(response: unknown): NativeExecutionSettings {
  const parsed = runtimeSchema.safeParse(response);
  if (!parsed.success) return {};
  const value = parsed.data;
  return {
    model: value.collaborationMode?.settings?.model ?? value.model ?? undefined,
    effort:
      value.collaborationMode?.settings?.reasoning_effort ??
      value.reasoningEffort ??
      value.effort ??
      undefined,
    serviceTier: value.serviceTier ?? undefined,
    permissionProfile: value.activePermissionProfile?.id ?? undefined,
    sandbox: value.sandbox?.type ?? value.sandboxPolicy?.type,
    approvalPolicy: approvalLabel(value.approvalPolicy),
    approvalsReviewer: value.approvalsReviewer ?? undefined,
    mode: value.collaborationMode?.mode,
  };
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class NativeConfiguration {
  private readonly runtimeByDirectory = new Map<
    string,
    {
      key: string;
      value: ReturnType<NativeConfiguration['resolveRuntime']>;
    }
  >();
  constructor(private driver: Driver) {}

  async synchronizeThread(threadId: string, cwd: string, key: string) {
    let current = this.runtimeByDirectory.get(cwd);
    if (current?.key !== key) {
      const value = this.resolveRuntime(cwd);
      current = { key, value };
      this.runtimeByDirectory.set(cwd, current);
      if (this.runtimeByDirectory.size > 20)
        this.runtimeByDirectory.delete(this.runtimeByDirectory.keys().next().value!);
      void value.catch(() => {
        if (this.runtimeByDirectory.get(cwd)?.value === value) this.runtimeByDirectory.delete(cwd);
      });
    }
    const { settings, params } = await current.value;
    await this.driver.call('thread/settings/update', { threadId, ...params });
    return settings;
  }

  private async resolveRuntime(cwd: string) {
    const response = await this.driver.call('thread/start', { cwd, ephemeral: true });
    const temporaryId = z.string().min(1).parse(response.thread?.id);
    try {
      if (response.thread.cwd !== cwd)
        throw new AppError(
          'PROJECT_OWNERSHIP',
          'Codex resolved a different project directory.',
          403,
        );
      const parsed = runtimeSchema.safeParse(response);
      if (!parsed.success || !parsed.data.sandbox || !parsed.data.approvalPolicy)
        throw new AppError('PROTOCOL_ERROR', 'Codex did not report effective permissions.', 502);
      const { sandbox, activePermissionProfile, approvalsReviewer, approvalPolicy, serviceTier } =
        parsed.data;
      return {
        settings: nativeExecutionSettings(response),
        params: {
          ...(activePermissionProfile?.id
            ? { permissions: activePermissionProfile.id }
            : { sandboxPolicy: sandbox }),
          approvalPolicy,
          approvalsReviewer,
          model: parsed.data.model,
          effort: parsed.data.reasoningEffort,
          serviceTier: serviceTier ?? null,
        },
      };
    } finally {
      await this.driver.call('thread/unsubscribe', { threadId: temporaryId });
    }
  }

  async read(cwd: string, layers = false) {
    const raw = await this.driver.call('config/read', { cwd, includeLayers: layers });
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError('PROTOCOL_ERROR', 'Codex returned invalid execution configuration.', 502);
    const { config, origins } = parsed.data;
    const fast = config.service_tier === 'fast' || config.service_tier === 'priority';
    const baseUser = parsed.data.layers?.find(
      ({ name, disabledReason }) => name.type === 'user' && !name.profile && !disabledReason,
    );
    return {
      key: digest([this.driver.epoch, raw.config, raw.origins ?? {}]),
      model: config.model ?? undefined,
      effort: config.model_reasoning_effort ?? undefined,
      planEffort: config.plan_mode_reasoning_effort ?? undefined,
      serviceTier: fast ? 'priority' : (config.service_tier ?? undefined),
      fast: fast && config.features?.fast_mode !== false,
      fastAvailable: config.features?.fast_mode !== false,
      permissionProfile: config.default_permissions ?? undefined,
      sandbox: config.sandbox_mode ?? undefined,
      approvalPolicy: approvalLabel(config.approval_policy),
      approvalsReviewer: config.approvals_reviewer ?? undefined,
      codeQuestions: config.features?.default_mode_request_user_input ?? undefined,
      userVersion: baseUser?.version,
      writable: !!baseUser && this.driver.supportsMethod('config/batchWrite'),
      sources: Object.fromEntries(
        Object.entries(origins ?? {})
          .filter(([key]) => publicSources.has(key))
          .map(([key, value]) => [key, value.name.type]),
      ),
    };
  }

  async overview(cwd: string): Promise<NativeConfigurationSnapshot> {
    const { key: _key, ...settings } = await this.read(cwd, true);
    return settings;
  }

  async save(cwd: string, input: NativeConfigurationEdits) {
    const before = await this.read(cwd, true);
    if (!before.writable)
      throw new AppError('CLI_FEATURE_UNAVAILABLE', 'Edit the configuration using Codex CLI.', 412);
    if (input.version !== before.userVersion)
      throw new AppError(
        'SETTINGS_CONFLICT',
        'Codex configuration changed. Reload before saving.',
        409,
      );
    const edits = Object.entries(input.changes).map(([keyPath, value]) => ({
      keyPath,
      value,
      mergeStrategy: 'replace',
    }));
    try {
      await this.driver.call('config/batchWrite', {
        edits,
        expectedVersion: input.version,
        reloadUserConfig: false,
      });
    } catch (error) {
      const current = await this.read(cwd, true);
      if (current.userVersion !== before.userVersion)
        throw new AppError(
          'SETTINGS_CONFLICT',
          'Codex configuration changed. Reload before saving.',
          409,
        );
      throw error;
    }
    return this.overview(cwd);
  }
}
