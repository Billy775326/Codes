import { useInterfaceLanguage } from './interface-language';
import { useState } from 'react';
import type { ImageAttachment } from '../shared/types';
import { imageUrl } from '../shared/images';
import { IconButton } from './primitives';
export function ImageAttachmentView({
  image,
  projectId,
  remove,
}: {
  image: ImageAttachment;
  projectId: string;
  remove?: () => void;
}) {
  const { t } = useInterfaceLanguage();
  const [failed, setFailed] = useState(false);
  return (
    <span className="image-attachment">
      {failed ? (
        <span className="image-unavailable">{t('Image unavailable')}</span>
      ) : (
        <a
          href={imageUrl(projectId, image.id)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('Open image: {name}', { name: image.name })}
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
        <IconButton
          icon="close"
          size={14}
          label={t('Remove image: {name}', { name: image.name })}
          onClick={remove}
        />
      )}
    </span>
  );
}
