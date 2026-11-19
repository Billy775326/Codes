import type { Settings } from './types.js';

export const permissionPresets = [
  {
    id: 'read-only',
    label: 'Read only',
    description: 'Inspect files. Ask before changes or access outside the sandbox.',
  },
  {
    id: 'workspace-write',
    label: 'Ask for approval',
    description: 'Edit workspace files. Ask before external file or network access.',
  },
  {
    id: 'danger-full-access',
    label: 'Full access',
    description: 'Unrestricted files and network on this server, without approval prompts.',
  },
] as const;

export function permissionLabel(permission: Settings['permission'], writeRoot?: string) {
  return permissionOptions(writeRoot).find((preset) => preset.id === permission)!.label;
}

/** Each preset fixes both controls, so lowering access also restores approval prompts. */
export function nativePermissions(permission: Settings['permission'], projectPath: string) {
  return {
    approvalPolicy: permission === 'danger-full-access' ? 'never' : 'on-request',
    sandboxPolicy:
      permission === 'read-only'
        ? { type: 'readOnly' }
        : permission === 'danger-full-access'
          ? { type: 'dangerFullAccess' }
          : { type: 'workspaceWrite', writableRoots: [projectPath], networkAccess: false },
  };
}

/** The owner policy is process-wide; the browser only presents its permitted choices. */
export function permissionOptions(writeRoot?: string) {
  return permissionPresets.map((preset) => {
    if (!writeRoot) return preset;
    if (preset.id === 'workspace-write')
      return {
        ...preset,
        label: 'Workspace only',
        description:
          'Edit files inside the server task write root. External writes and sandbox elevation are blocked.',
      };
    return {
      ...preset,
      description:
        preset.id === 'read-only'
          ? 'Inspect files without changes. Sandbox elevation is disabled.'
          : 'Disabled by the server task write boundary.',
    };
  });
}
