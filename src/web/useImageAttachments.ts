import { useEffect, useRef, useState, type ClipboardEvent, type ChangeEvent } from 'react';
import { imageLimits, imageTypes } from '../shared/images';
import type { ImageAttachment } from '../shared/types';
import { ApiError, request } from './api';

export function useImageAttachments({
  projectId,
  scope,
  count,
  disabled,
  attach,
  error,
}: {
  projectId: string;
  scope: string;
  count: number;
  disabled: boolean;
  attach: (image: ImageAttachment) => void;
  error: (value: unknown) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(0);
  const current = useRef({ projectId, scope, count, disabled, attach, error });
  current.current = { projectId, scope, count, disabled, attach, error };
  const requests = useRef(new Set<AbortController>());
  useEffect(() => {
    setPending(0);
    return () => {
      for (const request of requests.current) request.abort();
      requests.current.clear();
    };
  }, [scope, disabled]);
  const upload = async (files: File[]) => {
    const owner = current.current;
    if (owner.disabled || !owner.projectId) return;
    for (const file of files) {
      if (!imageTypes.includes(file.type as (typeof imageTypes)[number])) {
        owner.error(new Error('Choose a PNG, JPEG, or WebP image.'));
        continue;
      }
      if (!file.size || file.size > imageLimits.bytes) {
        owner.error(new Error('Images must be at most 8 MiB.'));
        continue;
      }
      if (current.current.count + requests.current.size >= imageLimits.attachments) {
        owner.error(new Error('Attach at most four files or images.'));
        break;
      }
      const controller = new AbortController();
      requests.current.add(controller);
      setPending(requests.current.size);
      void request<ImageAttachment>(
        `/projects/${owner.projectId}/images`,
        {
          method: 'POST',
          body: file,
          headers: {
            'content-type': file.type,
            'x-image-name': encodeURIComponent(file.name.slice(0, 160)),
          },
        },
        controller.signal,
      )
        .then((image) => {
          if (!controller.signal.aborted && current.current.scope === owner.scope)
            current.current.attach(image);
        })
        .catch((value) => {
          if (!controller.signal.aborted && current.current.scope === owner.scope)
            current.current.error(
              value instanceof ApiError && value.uncertain
                ? new Error('Image upload was not confirmed. Paste it again; no task was sent.')
                : value,
            );
        })
        .finally(() => {
          requests.current.delete(controller);
          if (!controller.signal.aborted && current.current.scope === owner.scope)
            setPending(requests.current.size);
        });
    }
  };
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith('image/'),
    );
    if (!files.length) return;
    if (!event.clipboardData.getData('text/plain')) event.preventDefault();
    void upload(files);
  };
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    void upload(files);
  };
  return { picker, pending, paste, choose };
}
