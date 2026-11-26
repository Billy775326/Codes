import { useEffect, useRef, useState, type ClipboardEvent, type ChangeEvent } from 'react';
import { imageLimits, imageTypes, projectImageType } from '../shared/images';
import { projectFileLimits, type ProjectFileReferenceAttachment } from '../shared/project-files';
import { limits, type ImageAttachment, type UploadedFileAttachment } from '../shared/types';
import { ApiError, request } from './api';
import { projectFileUrl } from './file-browser';

type LocalAttachment = ImageAttachment | ProjectFileReferenceAttachment | UploadedFileAttachment;

const documentName = /\.(pdf|doc[xm]?|xls[xm]?|ppt[xm]?|rtf|od[stp]|epub)$/i;
const documentType =
  /^(application\/(pdf|msword|rtf|epub\+zip|vnd\.(ms-|openxmlformats-officedocument\.|oasis\.opendocument\.))|text\/rtf$)/i;

async function uploadLocalFile(
  projectId: string,
  file: File,
  signal: AbortSignal,
): Promise<LocalAttachment> {
  const imageType =
    imageTypes.find((type) => type === file.type) ??
    (!file.type || file.type === 'application/octet-stream'
      ? projectImageType(file.name)
      : undefined);
  const name = encodeURIComponent(file.name.slice(0, 160).replace(/[\uD800-\uDBFF]$/, ''));
  if (imageType && file.size <= imageLimits.bytes) {
    return request<ImageAttachment>(
      `/projects/${projectId}/images`,
      {
        method: 'POST',
        body: file,
        headers: { 'content-type': imageType, 'x-image-name': name },
      },
      signal,
    );
  }
  if (
    file.size <= limits.uploadedFile &&
    !imageType &&
    !file.type.startsWith('image/') &&
    !documentName.test(file.name) &&
    !documentType.test(file.type)
  ) {
    try {
      return await request<UploadedFileAttachment>(
        `/projects/${projectId}/uploaded-files`,
        {
          method: 'POST',
          body: file,
          headers: { 'content-type': 'application/octet-stream', 'x-file-name': name },
        },
        signal,
      );
    } catch (error) {
      // An unknown format can use the file path after a definite text validation failure.
      if (!(error instanceof ApiError) || error.code !== 'BINARY_FILE' || error.uncertain)
        throw error;
    }
  }
  try {
    return await request<ProjectFileReferenceAttachment>(
      projectFileUrl(projectId, '', false, 'attach', { name: file.name }),
      { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } },
      signal,
      projectFileLimits.uploadTimeoutMs,
    );
  } catch (error) {
    if (error instanceof ApiError && error.uncertain)
      throw new Error(
        'Upload was not confirmed. Check the codes-attachments folder before retrying.',
      );
    throw error;
  }
}

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
  attach: (attachment: LocalAttachment) => void;
  error: (value: unknown) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(0);
  const current = useRef({ projectId, scope, count, disabled, attach, error });
  current.current = { projectId, scope, count, disabled, attach, error };
  const requests = useRef(new Set<AbortController>());
  const uploadSequence = useRef(Promise.resolve());
  useEffect(() => {
    setPending(0);
    return () => {
      for (const request of requests.current) request.abort();
      requests.current.clear();
      uploadSequence.current = Promise.resolve();
    };
  }, [scope, disabled]);
  const upload = (files: File[]) => {
    const owner = current.current;
    if (owner.disabled || !owner.projectId) return;
    for (const file of files) {
      if (!file.size) {
        owner.error(new Error('Choose a non-empty file.'));
        continue;
      }
      if (file.size > projectFileLimits.uploadBytes) {
        owner.error(new Error('Project uploads must be at most 64 MiB.'));
        continue;
      }
      if (current.current.count + requests.current.size >= imageLimits.attachments) {
        owner.error(new Error('Attach at most four files or images.'));
        break;
      }
      const controller = new AbortController();
      requests.current.add(controller);
      setPending(requests.current.size);
      const isCurrent = () => !controller.signal.aborted && current.current.scope === owner.scope;
      uploadSequence.current = uploadSequence.current.then(async () => {
        if (!isCurrent()) return;
        try {
          const attachment = await uploadLocalFile(owner.projectId, file, controller.signal);
          if (isCurrent()) current.current.attach(attachment);
        } catch (value) {
          if (isCurrent())
            current.current.error(
              value instanceof ApiError && value.uncertain
                ? new Error('Upload was not confirmed. Select the file or paste the image again.')
                : value,
            );
        } finally {
          requests.current.delete(controller);
          if (isCurrent()) setPending(requests.current.size);
        }
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
