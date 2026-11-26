export const isHtmlFile = (path: string) => /\.html?$/i.test(path);

export function projectFileUrl(
  projectId: string,
  path: string,
  showHidden: boolean,
  operation = '',
  extra: Record<string, string> = {},
) {
  const query = new URLSearchParams({
    path,
    ...(showHidden ? { showHidden: 'true' } : {}),
    ...extra,
  });
  return (
    '/projects/' +
    encodeURIComponent(projectId) +
    '/file-management' +
    (operation ? '/' + operation : '') +
    '?' +
    query
  );
}

export function fileBrowserUrl(
  kind: 'directory' | 'location' | 'file' | 'image' | 'document' | 'pdf',
  path: string,
  showHidden: boolean,
  projectId?: string,
) {
  const query = new URLSearchParams({ kind, path, showHidden: String(showHidden) });
  if (projectId) query.set('projectId', projectId);
  return '/file-browser?' + query;
}
