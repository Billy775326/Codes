export const saved = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};
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
export const draftKey = (projectId: string, threadId: string) =>
  'codes.draft.' + (threadId || 'new.' + projectId);
