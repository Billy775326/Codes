import { z } from 'zod';
import type { Driver } from '../codex/driver.js';
import type { Settings } from '../shared/types.js';
import { AppError } from '../shared/errors.js';

const modelSchema = z.object({
  id: z.string().min(1).max(150),
  model: z.string().min(1).max(150),
  displayName: z.string().max(200),
  isDefault: z.boolean(),
  inputModalities: z.array(z.string().max(80)).max(10).optional(),
  serviceTiers: z
    .array(
      z.object({
        id: z.string().max(80),
        name: z.string().max(200),
        description: z.string().max(2000),
      }),
    )
    .max(20)
    .optional(),
  additionalSpeedTiers: z.array(z.string().max(80)).max(20).optional(),
  defaultReasoningEffort: z.string().min(1).max(80),
  supportedReasoningEfforts: z
    .array(
      z.object({
        reasoningEffort: z.string().min(1).max(80),
        description: z.string().max(2000),
      }),
    )
    .max(30),
});
const modesSchema = z
  .array(
    z.object({
      name: z.string().max(100),
      mode: z.enum(['default', 'plan']).nullish(),
      model: z.string().max(150).nullish(),
    }),
  )
  .max(20);

/** Public metadata only; config/read and authentication documents never reach the browser. */
export class ModelSettings {
  constructor(private driver: Driver) {}
  async permissions() {
    const response = await this.driver.call('configRequirements/read', {});
    const parsed = z
      .object({
        requirements: z
          .object({
            allowedApprovalsReviewers: z.array(z.enum(['user', 'auto_review'])).nullish(),
            allowedApprovalPolicies: z.array(z.unknown()).nullish(),
            allowedSandboxModes: z.array(z.string()).nullish(),
          })
          .nullable(),
      })
      .safeParse(response);
    if (!parsed.success)
      throw new AppError(
        'PROTOCOL_ERROR',
        'The CLI returned invalid permission requirements.',
        502,
      );
    const requirements = parsed.data.requirements;
    return {
      autoReview:
        (requirements?.allowedApprovalsReviewers?.includes('auto_review') ?? true) &&
        (requirements?.allowedApprovalPolicies?.includes('on-request') ?? true) &&
        (requirements?.allowedSandboxModes?.includes('workspace-write') ?? true),
    };
  }
  async checkPermissions(settings: Settings) {
    if (settings.permission === 'auto-review' && !(await this.permissions()).autoReview)
      throw new AppError(
        'AUTO_REVIEW_UNAVAILABLE',
        'Approve for me is restricted by the native Codex policy. Choose an allowed permission preset.',
        412,
      );
  }
  async models() {
    const response = await this.driver.call('model/list', { limit: 100 });
    const parsed = z.array(modelSchema).max(100).safeParse(response?.data);
    if (!parsed.success)
      throw new AppError('PROTOCOL_ERROR', 'The CLI returned invalid model metadata.', 502);
    return parsed.data.map(({ serviceTiers, additionalSpeedTiers, inputModalities, ...model }) => ({
      ...model,
      supportsImages: inputModalities?.includes('image') ?? false,
      supportsFast:
        serviceTiers?.some((tier) => tier.id === 'priority' || tier.id === 'fast') ??
        additionalSpeedTiers?.includes('fast') ??
        false,
    }));
  }
  async modes() {
    const response = await this.driver.call('collaborationMode/list', {});
    const parsed = modesSchema.safeParse(response?.data);
    if (!parsed.success)
      throw new AppError('PROTOCOL_ERROR', 'The CLI returned invalid mode metadata.', 502);
    return parsed.data;
  }
  async resolve(settings: Settings, resolvedModel?: string, hasImages = false) {
    const modes = await this.modes();
    const mode = settings.mode ?? 'default';
    const preset = modes.find((entry) => entry.mode === mode);
    if (!preset)
      throw new AppError('MODE_UNAVAILABLE', 'This CLI does not support the selected mode.', 412);
    const model = settings.model || resolvedModel || preset.model;
    if (!model)
      throw new AppError('MODEL_UNKNOWN', 'Choose a model before starting this task.', 409);
    if (settings.effort || settings.fast || hasImages) {
      const metadata = (await this.models()).find(
        (entry) => entry.id === model || entry.model === model,
      );
      if (hasImages && !metadata?.supportsImages)
        throw new AppError(
          'IMAGES_UNAVAILABLE',
          'The selected model does not advertise image input. Choose an image-capable model.',
          409,
        );
      if (settings.fast && !metadata?.supportsFast)
        throw new AppError(
          'FAST_UNAVAILABLE',
          'Fast mode is unavailable for the selected model.',
          409,
        );
      if (
        settings.effort &&
        !metadata?.supportedReasoningEfforts.some(
          (entry) => entry.reasoningEffort === settings.effort,
        )
      )
        throw new AppError(
          'EFFORT_UNAVAILABLE',
          'The selected model does not advertise this reasoning effort.',
          409,
        );
    }
    return {
      mode,
      settings: { model, reasoning_effort: settings.effort ?? null, developer_instructions: null },
    };
  }
}
