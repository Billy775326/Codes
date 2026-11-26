export function hasHiddenPathSegment(path: string) {
  return path.split(/[\\/]/).some((part) => part.startsWith('.'));
}

export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  symbolicLink?: boolean;
}

export const projectFileLimits = {
  uploadBytes: 64 * 1024 * 1024,
  uploadTimeoutMs: 120_000,
  concurrentUploads: 2,
  pageSize: 200,
  pathLength: 1024,
};
export const composerAttachmentDirectory = 'codes-attachments';
export const projectUploadStagingPrefix = '.codes-upload-';

export interface ProjectFileReferenceAttachment {
  kind: 'file-reference';
  path: string;
  version: string;
  showHidden?: true;
}

export interface ProjectFilePage {
  entries: FileEntry[];
  next?: { offset: number; revision: string };
}

export interface FileBrowserResult<T> {
  value: T;
  outsideScope: boolean;
}

export interface FileLocation {
  path: string;
  directory: boolean;
}
