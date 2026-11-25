import { z } from 'zod';

export const nativeConfigurationEdits = z
  .object({
    version: z.string().min(1).max(512),
    changes: z
      .object({
        model: z.string().min(1).max(150).nullable().optional(),
        model_reasoning_effort: z.string().min(1).max(80).nullable().optional(),
        plan_mode_reasoning_effort: z.string().min(1).max(80).nullable().optional(),
        service_tier: z.string().min(1).max(80).nullable().optional(),
        approval_policy: z.enum(['untrusted', 'on-request', 'never']).nullable().optional(),
        approvals_reviewer: z.enum(['user', 'auto_review']).nullable().optional(),
        default_permissions: z.string().min(1).max(150).nullable().optional(),
        sandbox_mode: z
          .enum(['read-only', 'workspace-write', 'danger-full-access'])
          .nullable()
          .optional(),
        'features.default_mode_request_user_input': z.boolean().nullable().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0),
  })
  .strict();

export type NativeConfigurationEdits = z.infer<typeof nativeConfigurationEdits>;

export interface NativeConfigurationSnapshot extends NativeExecutionSettings {
  planEffort?: string;
  fast: boolean;
  fastAvailable: boolean;
  codeQuestions?: boolean;
  userVersion?: string;
  writable: boolean;
  sources: Record<string, string>;
}

export interface NativeExecutionSettings {
  model?: string;
  effort?: string;
  serviceTier?: string;
  permissionProfile?: string;
  sandbox?: string;
  approvalPolicy?: string;
  approvalsReviewer?: string;
  mode?: 'default' | 'plan';
}
