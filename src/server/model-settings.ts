import { z } from 'zod';
import type { Driver } from '../codex/driver.js';
import type { Settings } from '../shared/types.js';
import { AppError } from '../shared/errors.js';

const modelSchema = z.object({
  id: z.string().min(1).max(150),
  model: z.string().min(1).max(150),
  displayName: z.string().max(200),
  isDefault: z.boolean(),
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
  async models() {
    const response = await this.driver.call('model/list', { limit: 100 });
    const parsed = z.array(modelSchema).max(100).safeParse(response?.data);
    if (!parsed.success)
      throw new AppError('PROTOCOL_ERROR', 'The CLI returned invalid model metadata.', 502);
    return parsed.data;
  }
  async modes() {
    const response = await this.driver.call('collaborationMode/list', {});
    const parsed = modesSchema.safeParse(response?.data);
    if (!parsed.success)
      throw new AppError('PROTOCOL_ERROR', 'The CLI returned invalid mode metadata.', 502);
    return parsed.data;
  }
  async resolve(settings: Settings, resolvedModel?: string) {
    const modes = await this.modes();
    const mode = settings.mode ?? 'default';
    const preset = modes.find((entry) => entry.mode === mode);
    if (!preset)
      throw new AppError('MODE_UNAVAILABLE', 'This CLI does not support the selected mode.', 412);
    const model = settings.model || resolvedModel || preset.model;
    if (!model)
      throw new AppError('MODEL_UNKNOWN', 'Choose a model before starting this task.', 409);
    if (settings.effort) {
      const metadata = (await this.models()).find(
        (entry) => entry.id === model || entry.model === model,
      );
      if (
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
