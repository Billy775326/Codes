export function hasHiddenPathSegment(path: string) {
  return path.split(/[\\/]/).some((part) => part.startsWith('.'));
}

export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  symbolicLink?: boolean;
}

export interface FileBrowserResult<T> {
  value: T;
  outsideScope: boolean;
}

export interface FileLocation {
  path: string;
  directory: boolean;
}
