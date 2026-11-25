import { z } from 'zod';
import { projectInstructionsLimit } from '../../shared/project-instructions.js';

const sha256 = /^[a-f0-9]{64}$/;
export const instructionsUpdate = z.object({
  revision: z.string().regex(sha256).nullable(),
  text: z.string().max(projectInstructionsLimit),
});
