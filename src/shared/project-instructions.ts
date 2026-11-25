export const projectInstructionsLimit = 64 * 1024;

export interface ProjectInstructions {
  text: string;
  revision: string | null;
}

export const codexInstructionFiles = ['AGENTS.md', 'AGENTS.override.md'] as const;

export interface GlobalInstructions extends ProjectInstructions {
  filename: (typeof codexInstructionFiles)[number];
}
