import { useEffect, useRef, useState, type ClipboardEvent, type ChangeEvent } from 'react';
import { imageLimits, imageTypes } from '../shared/images';
import { limits, type ImageAttachment, type UploadedFileAttachment } from '../shared/types';
import { ApiError, request } from './api';

export function useLocalAttachments({
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
  attach: (attachment: ImageAttachment | UploadedFileAttachment) => void;
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
  const upload = (files: File[]) => {
    const owner = current.current;
    if (owner.disabled || !owner.projectId) return;
    for (const file of files) {
      const image = file.type.startsWith('image/');
      if (image && !imageTypes.includes(file.type as (typeof imageTypes)[number])) {
        owner.error(new Error('Choose a PNG, JPEG, or WebP image.'));
        continue;
      }
      if (!file.size) {
        owner.error(new Error('Choose a non-empty file.'));
        continue;
      }
      if (file.size > (image ? imageLimits.bytes : limits.uploadedFile)) {
        owner.error(
          new Error(
            image
              ? 'Images must be at most 8 MiB.'
              : 'Text attachments are limited to 64 KiB. For larger files, upload in Files and choose Reference in conversation.',
          ),
        );
        continue;
      }
      if (current.current.count + requests.current.size >= imageLimits.attachments) {
        owner.error(new Error('Attach at most four files or images.'));
        break;
      }
      const controller = new AbortController();
      const name = file.name.slice(0, 160).replace(/[\uD800-\uDBFF]$/, '');
      requests.current.add(controller);
      setPending(requests.current.size);
      void request<ImageAttachment | UploadedFileAttachment>(
        `/projects/${owner.projectId}/${image ? 'images' : 'uploaded-files'}`,
        {
          method: 'POST',
          body: file,
          headers: {
            'content-type': image ? file.type : 'application/octet-stream',
            [image ? 'x-image-name' : 'x-file-name']: encodeURIComponent(name),
          },
        },
        controller.signal,
      )
        .then((attachment) => {
          if (!controller.signal.aborted && current.current.scope === owner.scope)
            current.current.attach(attachment);
        })
        .catch((value) => {
          if (controller.signal.aborted || current.current.scope !== owner.scope) return;
          if (value instanceof ApiError && value.code === 'BINARY_FILE') {
            current.current.error(
              new Error(
                'This file is not UTF-8 text. Upload it in Files and choose Reference in conversation.',
              ),
            );
            return;
          }
          current.current.error(
            value instanceof ApiError && value.uncertain
              ? new Error('Upload was not confirmed. Select the file or paste the image again.')
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
    upload(files);
  };
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    upload(files);
  };
  return { picker, pending, paste, choose };
}
