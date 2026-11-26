import { useEffect, useId, useRef, useState } from 'react';
import { projectFileLimits } from '../shared/project-files';
import { ApiError, message, reportAuthenticationError, request } from './api';
import { projectFileUrl } from './file-browser';
import { useInterfaceLanguage } from './interface-language';
import { PanelMenu } from './PanelMenu';
import { Icon, IconButton } from './primitives';

export function ProjectFileControls({
  projectId,
  directory,
  showHidden,
  refresh,
  toolbar,
}: {
  projectId: string;
  directory: string;
  showHidden: boolean;
  refresh: () => void;
  toolbar: (add: React.ReactNode) => React.ReactNode;
}) {
  const { t } = useInterfaceLanguage();
  const uploadHint = useId();
  const picker = useRef<HTMLInputElement>(null);
  const add = useRef<HTMLDetailsElement>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const writing = useRef<AbortController | null>(null);
  const [edit, setEdit] = useState<'folder' | File>();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      const upload = xhr.current;
      xhr.current = null;
      upload?.abort();
      writing.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (edit) field.current?.focus();
  }, [edit]);
  const close = () => {
    setEdit(undefined);
    setError('');
    add.current?.querySelector('summary')?.focus();
  };
  const begin = (value: 'folder' | File) => {
    setStatus('');
    setError('');
    setName(value === 'folder' ? '' : value.name);
    setEdit(value);
  };
  const finish = () => {
    const uploaded = edit !== 'folder';
    setBusy(false);
    close();
    refresh();
    setStatus(uploaded ? 'File uploaded.' : 'Folder created.');
  };
  const submit = async () => {
    if (!edit || !name || busy) return;
    setError('');
    if (edit !== 'folder' && edit.size > projectFileLimits.uploadBytes) {
      setError('Project uploads must be at most 64 MiB.');
      return;
    }
    setBusy(true);
    if (edit === 'folder') {
      const controller = new AbortController();
      writing.current = controller;
      try {
        await request(
          projectFileUrl(projectId, directory, showHidden, 'directory'),
          {
            method: 'POST',
            body: JSON.stringify({ name }),
          },
          controller.signal,
        );
        if (!controller.signal.aborted) finish();
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(message(failure));
          setBusy(false);
        }
      } finally {
        if (writing.current === controller) writing.current = null;
      }
      return;
    }
    const transfer = new XMLHttpRequest();
    xhr.current = transfer;
    transfer.open(
      'POST',
      '/api' + projectFileUrl(projectId, directory, showHidden, 'upload', { name }),
    );
    transfer.setRequestHeader('Content-Type', 'application/octet-stream');
    transfer.responseType = 'json';
    transfer.timeout = 120_000;
    setSent(0);
    transfer.upload.onprogress = (event) => {
      if (xhr.current === transfer) setSent(event.loaded);
    };
    const failed = (text: string) => {
      if (xhr.current !== transfer) return;
      xhr.current = null;
      setBusy(false);
      setError(text);
    };
    transfer.onload = () => {
      if (xhr.current !== transfer) return;
      if (transfer.status === 201) {
        xhr.current = null;
        finish();
      } else if (transfer.status === 401) {
        failed('Sign in to your workspace.');
        reportAuthenticationError(
          new ApiError('Sign in to your workspace.', 'AUTH_REQUIRED', false, 401),
        );
      } else {
        failed(
          transfer.response?.error?.message || 'Upload failed. Refresh Files before retrying.',
        );
      }
    };
    transfer.onerror = transfer.ontimeout = () =>
      failed('Upload was not confirmed. Refresh Files before retrying.');
    transfer.send(edit);
  };
  const cancelUpload = () => {
    const upload = xhr.current;
    xhr.current = null;
    upload?.abort();
    setBusy(false);
    close();
    refresh();
  };
  return (
    <>
      {toolbar(
        <PanelMenu
          label={t('Upload or create')}
          className="file-add-menu"
          iconOnly
          controller={add}
          trigger={<Icon name="plus" size={16} />}
        >
          <button
            type="button"
            data-close-menu
            disabled={busy}
            aria-label={t('Upload to this folder')}
            aria-describedby={uploadHint}
            onClick={() => picker.current?.click()}
          >
            <Icon name="upload" size={14} />
            <span className="menu-action-copy">
              {t('Upload to this folder')}
              <small id={uploadHint}>{t('Any file type · 64 MiB max')}</small>
            </span>
          </button>
          <button type="button" data-close-menu disabled={busy} onClick={() => begin('folder')}>
            <Icon name="folder" size={14} />
            {t('New folder')}
          </button>
        </PanelMenu>,
      )}
      <input
        type="file"
        ref={picker}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) begin(file);
        }}
      />
      {edit && (
        <form
          className="file-create"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            {t(edit === 'folder' ? 'Folder name' : 'Upload filename')}
            <input
              ref={field}
              value={name}
              maxLength={255}
              disabled={busy}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="file-create-actions">
            <IconButton
              icon="check"
              type="submit"
              label={t(edit === 'folder' ? 'Create folder' : 'Start upload')}
              disabled={busy || !name}
            />
            <IconButton
              icon="close"
              label={t(busy && edit !== 'folder' ? 'Cancel upload' : 'Cancel')}
              disabled={busy && edit === 'folder'}
              onClick={busy ? cancelUpload : close}
            />
          </div>
          {busy && edit !== 'folder' && (
            <progress max={edit.size || 1} value={sent} aria-label={t('Uploading file')} />
          )}
          {error && <p role="alert">{t(error)}</p>}
        </form>
      )}
      {status && (
        <p role="status" className="file-state">
          {t(status)}
        </p>
      )}
    </>
  );
}
