export const isHtmlFile = (path: string) => /\.html?$/i.test(path);

export function fileBrowserUrl(
  kind: 'directory' | 'location' | 'file' | 'image',
  path: string,
  showHidden: boolean,
  projectId?: string,
) {
  const query = new URLSearchParams({ kind, path, showHidden: String(showHidden) });
  if (projectId) query.set('projectId', projectId);
  return '/file-browser?' + query;
}
