export const imageLimits = {
  bytes: 8 * 1024 * 1024,
  pixels: 24_000_000,
  storageBytes: 128 * 1024 * 1024,
  files: 512,
  attachments: 4,
} as const;
export const imageId = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
export const imageTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const imageUrl = (projectId: string, id: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(id)}`;
