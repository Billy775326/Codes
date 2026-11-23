export const projectInstructionsLimit = 64 * 1024;

export interface ProjectInstructions {
  text: string;
  revision: string | null;
}
