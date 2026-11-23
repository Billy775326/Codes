import { useInterfaceLanguage } from './interface-language';
import { useRef, useState, type FormEvent } from 'react';
import type { Project } from '../shared/types';
import { ApiError, message, post } from './api';
import { InteractionDialog } from './InteractionDialog';

export function AddProjectDialog({
  defaultPath,
  close,
  added,
}: {
  defaultPath: string;
  close: () => void;
  added: (project: Project) => void;
}) {
  const { t } = useInterfaceLanguage();
  const [path, setPath] = useState(defaultPath);
  const selectDefault = useRef(!!defaultPath);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; path?: boolean }>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const directory = path.trimStart();
    if (!directory.startsWith('/')) {
      setError({ text: 'Enter an absolute path on the server.', path: true });
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const project = await post<Project>('/projects', {
        path: directory,
        name: name.trim() || undefined,
      });
      added(project);
    } catch (cause) {
      setError({
        text: message(cause),
        path: cause instanceof ApiError && cause.code === 'INVALID_DIRECTORY',
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <InteractionDialog
      title={t('Add a project')}
      close={close}
      busy={busy}
      className="project-dialog"
      closeOnBackdrop
      initialFocus="#project-path"
    >
      <form onSubmit={(event) => void submit(event)}>
        <div>
          <label htmlFor="project-path">{t('Project directory on server')}</label>
          <input
            id="project-path"
            value={path}
            aria-describedby={
              error?.path ? 'project-path-help project-add-error' : 'project-path-help'
            }
            aria-invalid={error?.path || undefined}
            placeholder="/home/you/projects/my-project"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={2048}
            disabled={busy}
            required
            onFocus={(event) => {
              if (!selectDefault.current) return;
              selectDefault.current = false;
              event.currentTarget.select();
            }}
            onChange={(event) => {
              setPath(event.target.value);
              setError(undefined);
            }}
          />
          <p className="project-field-help" id="project-path-help">
            {t('Use the absolute path of an existing folder on this server.')}
          </p>
        </div>
        <div>
          <label htmlFor="new-project-name">{t('Project name (optional)')}</label>
          <input
            id="new-project-name"
            value={name}
            placeholder={t('Use the folder name')}
            maxLength={80}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {error && (
          <p id="project-add-error" className="error-text" role="alert">
            {t(error.text)}
          </p>
        )}
        <div className="project-dialog-actions">
          <button type="button" className="secondary" disabled={busy} onClick={close}>
            {t('Cancel')}
          </button>
          <button className="primary" disabled={busy || !path.trim()}>
            {busy ? t('Adding…') : t('Add project')}
          </button>
        </div>
      </form>
    </InteractionDialog>
  );
}
