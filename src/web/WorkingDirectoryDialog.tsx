import { useState, type FormEvent } from 'react';
import type { Project } from '../shared/types';
import { ApiError, message, post, request } from './api';
import { InteractionDialog } from './InteractionDialog';
import { useInterfaceLanguage } from './interface-language';
import { Icon, IconButton } from './primitives';

export function WorkingDirectoryDialog({
  initialPath,
  close,
  choose,
}: {
  initialPath: string;
  close: () => void;
  choose: (workspace: Project) => void;
}) {
  const { t } = useInterfaceLanguage();
  const [path, setPath] = useState(initialPath);
  const [listing, setListing] = useState<string[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; path?: boolean }>();
  const directory = path.trimStart();
  const valid = directory.startsWith('/');
  const child = (name: string) => directory.replace(/\/$/, '') + '/' + name;

  const select = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      choose(await post<Project>('/conversations/directory', { path: directory }));
    } catch (cause) {
      setError({
        text: message(cause),
        path: cause instanceof ApiError && cause.code === 'INVALID_DIRECTORY',
      });
    } finally {
      setBusy(false);
    }
  };
  const browse = async (next: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const { value } = await request<{ value: { directory: boolean; name: string }[] }>(
        '/file-browser?' + new URLSearchParams({ kind: 'directory', path: next }),
      );
      setPath(next);
      setListing(value.filter((entry) => entry.directory).map((entry) => entry.name));
    } catch (cause) {
      setError({ text: message(cause) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <InteractionDialog
      title={t('Choose a working directory')}
      close={close}
      busy={busy}
      className="project-dialog directory-picker"
      closeOnBackdrop
      initialFocus="#working-directory"
    >
      <form onSubmit={(event) => void select(event)}>
        <div>
          <label htmlFor="working-directory">{t('Working directory')}</label>
          <div className="directory-picker-input">
            <input
              id="working-directory"
              value={path}
              aria-describedby={error ? 'working-directory-error' : undefined}
              aria-invalid={error?.path || undefined}
              placeholder="/home/you/workspace"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={4096}
              disabled={busy}
              required
              onChange={(event) => {
                setPath(event.currentTarget.value);
                setError(undefined);
                setListing(undefined);
              }}
            />
            <IconButton
              icon="folder"
              label={t('Browse directories')}
              disabled={busy}
              onClick={() => void browse(valid ? directory : '/')}
            />
          </div>
        </div>
        {listing && (
          <div className="directory-picker-list" aria-label={t('Directories')}>
            {directory !== '/' && (
              <button
                type="button"
                className="directory-picker-parent"
                disabled={busy}
                onClick={() =>
                  void browse(
                    directory.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/',
                  )
                }
              >
                <Icon name="chevron" size={14} />
                {t('Parent directory')}
              </button>
            )}
            {listing.map((name) => (
              <button
                type="button"
                key={name}
                disabled={busy}
                onClick={() => void browse(child(name))}
              >
                <Icon name="folder" size={14} />
                <span>{name}</span>
              </button>
            ))}
          </div>
        )}
        {error && (
          <p id="working-directory-error" className="error-text" role="alert">
            {t(error.text)}
          </p>
        )}
        <div className="project-dialog-actions">
          <button type="button" className="secondary" disabled={busy} onClick={close}>
            {t('Cancel')}
          </button>
          <button className="primary" disabled={busy || !valid}>
            {t('Use directory')}
          </button>
        </div>
      </form>
    </InteractionDialog>
  );
}
