import { useEffect, useRef, useState } from 'react';
import type { System } from '../shared/types';
import { downloadDatabaseBackup, message } from './api';
import { useInterfaceLanguage } from './interface-language';
import { Icon } from './primitives';

export function MaintenanceSettings({
  system,
  maintenanceBusy,
  changeMaintenance,
}: {
  system?: System;
  maintenanceBusy: boolean;
  changeMaintenance: (
    action: 'start' | 'cancel',
    onError: (error: unknown) => void,
  ) => Promise<void>;
}) {
  const { t } = useInterfaceLanguage();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [maintenanceError, setMaintenanceError] = useState('');
  const request = useRef<AbortController>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function download() {
    const controller = new AbortController();
    request.current = controller;
    setDownloadError('');
    setDownloading(true);
    try {
      const { file, name } = await downloadDatabaseBackup(controller.signal);
      const href = URL.createObjectURL(file);
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

  const maintenance = system?.maintenance;
  return (
    <>
      <section className="preferences-section" aria-labelledby="settings-maintenance-heading">
        <h3 id="settings-maintenance-heading">{t('Maintenance')}</h3>
        <dl className="session-status">
          <dt>{t('Task admission')}</dt>
          <dd role="status">
            {t(
              !system
                ? 'Unknown'
                : !maintenance
                  ? 'Accepting tasks'
                  : maintenance.ready
                    ? 'Ready'
                    : 'Waiting for active work',
            )}
          </dd>
          <dt>{t('CLI version')}</dt>
          <dd>{system?.version || t('Unknown')}</dd>
        </dl>
        <p className="preference-help">
          {t(
            'Pause new tasks and queue dispatch for up to five minutes. Running tasks can finish.',
          )}
        </p>
        <button
          className="settings-action"
          type="button"
          disabled={maintenanceBusy || !system}
          onClick={() => {
            setMaintenanceError('');
            void changeMaintenance(maintenance ? 'cancel' : 'start', (error) =>
              setMaintenanceError(message(error)),
            );
          }}
        >
          <Icon name={maintenance ? 'play' : 'pause'} size={16} />
          {t(maintenance ? 'Cancel maintenance' : 'Prepare maintenance')}
        </button>
        {maintenanceError && <p role="alert">{t(maintenanceError)}</p>}
      </section>
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
    </>
  );
}
