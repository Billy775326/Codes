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
    id: 'auto-review',
    label: 'Approve for me',
    description:
      'Keep the workspace sandbox. Codex reviews eligible requests; may use additional quota.',
  },
  {
    id: 'danger-full-access',
    label: 'Full access',
    description: 'Unrestricted files and network on this server, without approval prompts.',
  },
] as const;

export function permissionLabel(permission: Settings['permission']) {
  return permissionPresets.find((preset) => preset.id === permission)!.label;
}

/** Each preset fixes both controls, so lowering access also restores approval prompts. */
export function nativePermissions(permission: Settings['permission'], projectPath: string) {
  return {
    approvalsReviewer: permission === 'auto-review' ? 'auto_review' : 'user',
    approvalPolicy: permission === 'danger-full-access' ? 'never' : 'on-request',
    sandboxPolicy:
      permission === 'read-only'
        ? { type: 'readOnly' }
        : permission === 'danger-full-access'
          ? { type: 'dangerFullAccess' }
          : { type: 'workspaceWrite', writableRoots: [projectPath], networkAccess: false },
  };
}
