const versionedAsset = /^\/assets\/[A-Za-z0-9._-]+\.(?:js|css)$/;

export function webBuildSignature(paths: Iterable<string | null>) {
  return [
    ...new Set([...paths].filter((path): path is string => !!path && versionedAsset.test(path))),
  ]
    .sort()
    .join(',');
}

export function webEntrySignature(html: string) {
  return webBuildSignature(
    [...html.matchAll(/\b(?:src|href)="([^"\s]+)"/g)].map((match) => match[1] ?? null),
  );
}
