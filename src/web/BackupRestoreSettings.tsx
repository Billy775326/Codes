import { useEffect, useRef, useState } from 'react';
import { databaseBackupLimitBytes, type RestoreStatus } from '../shared/workspace-settings';
import { downloadDatabaseBackup, message, request } from './api';
import { useInterfaceLanguage } from './interface-language';
import { Icon } from './primitives';

const restorePath = '/settings/restore';

export function BackupRestoreSettings() {
  const { t, locale } = useInterfaceLanguage();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [status, setStatus] = useState<RestoreStatus>();
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const upload = useRef<HTMLInputElement>(null);
  const downloadRequest = useRef<AbortController>(null);
  const stagingRequest = useRef<AbortController>(null);
  useEffect(
    () => () => {
      downloadRequest.current?.abort();
      stagingRequest.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    void request<RestoreStatus>(restorePath, {}, controller.signal).then(setStatus, (failure) => {
      if (!controller.signal.aborted) setRestoreError(message(failure));
    });
    return () => controller.abort();
  }, [attempt]);

  async function download() {
    const controller = new AbortController();
    downloadRequest.current = controller;
    setDownloadError('');
    setDownloading(true);
    try {
      const { file: blob, name } = await downloadDatabaseBackup(controller.signal);
      const href = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = href;
        link.download = name;
        link.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      }
    } catch (error) {
      if (!controller.signal.aborted) setDownloadError(message(error));
    } finally {
      if (!controller.signal.aborted) setDownloading(false);
    }
  }

  async function updatePending(method: 'POST' | 'DELETE') {
    if (busy || !status || (method === 'POST' && !file)) return;
    setRestoreError('');
    setBusy(true);
    const controller = new AbortController();
    stagingRequest.current = controller;
    try {
      const next = await request<RestoreStatus>(
        restorePath,
        method === 'POST'
          ? { method, headers: { 'content-type': 'application/vnd.sqlite3' }, body: file }
          : { method, body: JSON.stringify(status.pending) },
        controller.signal,
      );
      setFile(undefined);
      setStatus(next);
    } catch (error) {
      if (!controller.signal.aborted) setRestoreError(message(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <>
      <section className="preferences-section" aria-labelledby="settings-backup-heading">
        <h3 id="settings-backup-heading">{t('Database backup')}</h3>
        <p className="preference-help">
          {t(
            'Includes Codes project and conversation records, queues, and saved defaults. Back up Codex history, workspace files, uploads, and server configuration separately.',
          )}
        </p>
        <button
          className="settings-action"
          type="button"
          disabled={downloading}
          onClick={() => void download()}
        >
          <Icon name="download" size={16} />
          {t(downloading ? 'Preparing backup…' : 'Download database backup')}
        </button>
        {downloadError && <p role="alert">{t(downloadError)}</p>}
      </section>
      <section className="preferences-section" aria-labelledby="settings-restore-heading">
        <h3 id="settings-restore-heading">{t('Restore database')}</h3>
        <p className="preference-help">
          {t(
            'Prepare a Codes backup from the same database schema. Applying it replaces the database and saves a copy of the current one.',
          )}
        </p>
        {status?.pending ? (
          <>
            <p role="status">
              {t('Restore prepared on {date}.', {
                date: new Intl.DateTimeFormat(locale, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }).format(status.pending.stagedAt),
              })}
            </p>
            <ol className="restore-steps">
              <li>{t('Stop Codes after the current work finishes.')}</li>
              <li>
                {t('Run this command on the server with the same account and data directory.')}{' '}
                <code>codes restore-database</code>
              </li>
              <li>{t('Start Codes and review the restored queues.')}</li>
            </ol>
            <button
              className="settings-action"
              type="button"
              disabled={busy}
              onClick={() => void updatePending('DELETE')}
            >
              {t('Remove prepared backup')}
            </button>
          </>
        ) : (
          status && (
            <>
              <input
                ref={upload}
                hidden
                type="file"
                aria-label={t('Database backup file')}
                accept=".sqlite,application/vnd.sqlite3"
                onChange={(event) => {
                  const selected = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  setRestoreError('');
                  if (!selected) return;
                  if (!selected.size || selected.size > databaseBackupLimitBytes) {
                    setFile(undefined);
                    setRestoreError('Choose a SQLite backup up to 64 MiB.');
                  } else setFile(selected);
                }}
              />
              <div className="settings-action-row">
                <button
                  className="settings-action"
                  type="button"
                  disabled={busy}
                  onClick={() => upload.current?.click()}
                >
                  <Icon name="upload" size={16} />
                  {t('Choose backup')}
                </button>
                {file && (
                  <button
                    className="settings-action"
                    type="button"
                    disabled={busy}
                    onClick={() => void updatePending('POST')}
                  >
                    {t(busy ? 'Validating backup…' : 'Prepare restore')}
                  </button>
                )}
              </div>
              {file && <p className="restore-filename">{file.name}</p>}
            </>
          )
        )}
        {restoreError && (
          <>
            <p role="alert">{t(restoreError)}</p>
            <button
              className="settings-action"
              type="button"
              onClick={() => {
                setRestoreError('');
                setAttempt((previous) => previous + 1);
              }}
            >
              {t('Refresh restore status')}
            </button>
          </>
        )}
      </section>
    </>
  );
}
