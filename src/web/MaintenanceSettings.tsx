import { useState } from 'react';
import type { System } from '../shared/types';
import { message } from './api';
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
  const [maintenanceError, setMaintenanceError] = useState('');
  const maintenance = system?.maintenance;
  return (
    <section className="preferences-section" aria-labelledby="settings-maintenance-heading">
      <h3 id="settings-maintenance-heading">{t('Task scheduling')}</h3>
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
      </dl>
      <div className="settings-action-row">
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
      </div>
      {maintenanceError && <p role="alert">{t(maintenanceError)}</p>}
    </section>
  );
}
