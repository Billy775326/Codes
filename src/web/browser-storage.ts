export const saved = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};
export const browserPreferencesKey = 'codes.preferences';
export const sidebarWidthKeys = {
  navigation: 'codes.navigation-width',
  context: 'codes.context-width',
} as const;
export const save = (key: string, value: string) => {
  try {
    if (key.startsWith('codes.draft.') && value) {
      const drafts = Object.keys(localStorage).filter(
        (entry) => entry.startsWith('codes.draft.') && entry !== key,
      );
      while (drafts.length >= 20) localStorage.removeItem(drafts.shift()!);
    }
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
    return true;
  } catch {
    // Storage may be unavailable; preference callers surface the failed save.
    return false;
  }
};

/** Keep the previous preferences when a batch cannot be fully stored. */
export function saveSettings(entries: readonly (readonly [string, string])[]) {
  const previous = entries.map(([key]) => [key, saved(key)] as const);
  for (const [index, [key, value]] of entries.entries()) {
    if (save(key, value)) continue;
    for (const [priorKey, priorValue] of previous.slice(0, index).reverse())
      save(priorKey, priorValue);
    return false;
  }
  return true;
}

export const draftKey = (projectId: string, threadId: string) =>
  'codes.draft.' + (threadId || 'new.' + projectId);
