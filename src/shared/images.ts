export const imageLimits = {
  bytes: 8 * 1024 * 1024,
  previewHeaderBytes: 512 * 1024,
  pixels: 24_000_000,
  storageBytes: 128 * 1024 * 1024,
  files: 512,
  attachments: 4,
} as const;
export const imageId = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
export const imageTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const imageUrl = (projectId: string, id: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(id)}`;
export function projectImageType(path: string) {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.webp$/i.test(path)) return 'image/webp';
  return undefined;
}
export const projectImageUrl = (projectId: string, path: string, showHidden = false) =>
  `/api/projects/${encodeURIComponent(projectId)}/image-preview?path=${encodeURIComponent(path)}${showHidden ? '&showHidden=true' : ''}`;
