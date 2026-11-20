/** Browser navigation metadata only; task state and settings remain server-owned. */
export interface ProjectSidebarPreference {
  expanded?: boolean;
  pinned?: boolean;
}

export function projectSidebarPreferences(raw: string): Record<string, ProjectSidebarPreference> {
  try {
    const value: unknown = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const entries: [string, ProjectSidebarPreference][] = [];
    for (const [id, preference] of Object.entries(value)) {
      if (!id || id.length > 200 || !preference || typeof preference !== 'object') continue;
      const { expanded, pinned } = preference;
      if (typeof expanded !== 'boolean' && pinned !== true) continue;
      entries.push([
        id,
        {
          expanded: typeof expanded === 'boolean' ? expanded : undefined,
          pinned: pinned === true || undefined,
        },
      ]);
    }
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export function linkedConversation(search: string) {
  const id = new URLSearchParams(search).get('conversation');
  return id && /^[a-zA-Z0-9_-]{1,200}$/.test(id) ? id : '';
}

export function projectViews(raw: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, id]) =>
            key.length > 0 && key.length <= 200 && typeof id === 'string' && id.length <= 200,
        )
        .slice(-20),
    );
  } catch {
    return {};
  } // Ignore malformed browser-only navigation metadata.
}
export function rememberProject(
  views: Record<string, string>,
  projectId: string,
  threadId: string,
) {
  return Object.fromEntries(
    [...Object.entries(views).filter(([id]) => id !== projectId), [projectId, threadId]].slice(-20),
  );
}
