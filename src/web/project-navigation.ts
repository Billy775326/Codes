/** Browser navigation metadata only; task state and settings remain server-owned. */
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
