import { useState } from 'react';
import type { ImageAttachment } from '../shared/types';
import { imageUrl } from '../shared/images';
export function ImageAttachmentView({
  image,
  projectId,
  remove,
}: {
  image: ImageAttachment;
  projectId: string;
  remove?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="image-attachment">
      {failed ? (
        <span className="image-unavailable">Image unavailable</span>
      ) : (
        <a
          href={imageUrl(projectId, image.id)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={'Open image: ' + image.name}
        >
          <img
            src={imageUrl(projectId, image.id)}
            alt={image.name}
            loading="lazy"
            width="80"
            height="64"
            onError={() => setFailed(true)}
          />
        </a>
      )}
      {remove && (
        <button type="button" aria-label={'Remove image: ' + image.name} onClick={remove}>
          ×
        </button>
      )}
    </span>
  );
}
