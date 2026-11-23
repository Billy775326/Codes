export function hasHiddenPathSegment(path: string) {
  return path.split(/[\\/]/).some((part) => part.startsWith('.'));
}
