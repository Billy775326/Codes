import { z } from 'zod';
import { record } from '../shared/errors.js';
import type { State } from '../shared/types.js';

export const nativeStatus = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notLoaded') }),
  z.object({ type: z.literal('idle') }),
  z.object({ type: z.literal('systemError') }),
  z.object({ type: z.literal('active'), activeFlags: z.array(z.string()) }),
]);

export function nativeThreadState(raw: unknown): State {
  if (!record(raw)) return 'idle';
  const flags = Array.isArray(raw.activeFlags) ? raw.activeFlags : [];
  switch (raw.type) {
    case 'active':
      return flags.includes('waitingOnApproval')
        ? 'waitingApproval'
        : flags.includes('waitingOnUserInput')
          ? 'waitingInput'
          : 'running';
    case 'systemError':
      return 'failed';
    case 'notLoaded':
      return 'unknown';
    default:
      return 'idle';
  }
}

export const terminal = (status: unknown) =>
  ['completed', 'failed', 'interrupted'].includes(String(status));
