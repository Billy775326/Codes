import { useInterfaceLanguage } from './interface-language';
import { useState } from 'react';
import {
  allNotificationEvents,
  notificationEventLabels,
  type NotificationPreferences,
} from './browser-preferences';
import { notificationAccess, showNotification } from './browser-notifications';

export function NotificationSettings({
  value,
  change,
}: {
  value: NotificationPreferences;
  change: (patch: Partial<NotificationPreferences>) => void;
}) {
  const { t } = useInterfaceLanguage();
  const enabled = value.notifications;
  const [access, setAccess] = useState(notificationAccess);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [tested, setTested] = useState(false);
  const unavailable = ['insecure', 'unsupported', 'denied'].includes(access);
  async function toggleNotifications(on: boolean) {
    setError('');
    setTested(false);
    if (!on) {
      change({ notifications: false });
      return;
    }
    setRequesting(true);
    try {
      const permission =
        notificationAccess() === 'granted' ? 'granted' : await Notification.requestPermission();
      setAccess(permission);
      if (permission === 'granted') change({ notifications: true });
      else if (permission === 'default') setError('Notification permission was not granted.');
    } catch {
      setError('Could not request browser notification permission.');
    } finally {
      setRequesting(false);
    }
  }
  return (
    <section className="preferences-section" aria-labelledby="preferences-notifications">
      <h3 id="preferences-notifications">{t('Notifications')}</h3>
      <label className="preference-row">
        <span>{t('Browser notifications')}</span>
        <input
          className="preference-checkbox"
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={requesting || (unavailable && !enabled)}
          onChange={(event) => void toggleNotifications(event.target.checked)}
        />
      </label>
      {unavailable && (
        <p className="preference-help">
          {access === 'denied'
            ? t('Allow notifications in your browser settings.')
            : access === 'insecure'
              ? t('Notifications require HTTPS or localhost.')
              : t('This browser does not support notifications.')}
        </p>
      )}
      <fieldset className="settings-options" disabled={!enabled || access !== 'granted'}>
        <legend>{t('Notification events')}</legend>
        {allNotificationEvents.map((event) => (
          <label className="settings-option" key={event}>
            <input
              className="preference-checkbox"
              type="checkbox"
              checked={value.notificationEvents.includes(event)}
              onChange={(changeEvent) =>
                change({
                  notificationEvents: changeEvent.target.checked
                    ? [...value.notificationEvents, event]
                    : value.notificationEvents.filter((configured) => configured !== event),
                })
              }
            />
            {t(notificationEventLabels[event])}
          </label>
        ))}
      </fieldset>
      {enabled && access === 'granted' && (
        <div className="settings-action-row">
          <p className="preference-help">{t('Keep this tab open for notifications.')}</p>
          <button
            type="button"
            className="settings-action"
            onClick={() => {
              setError('');
              setTested(false);
              try {
                showNotification(t('Codes test notification'), 'codes-test');
                setTested(true);
              } catch {
                setError('This browser could not display a notification.');
              }
            }}
          >
            {t('Send test notification')}
          </button>
        </div>
      )}
      {tested && <p role="status">{t('Test notification requested.')}</p>}
      {error && <p role="alert">{t(error)}</p>}
    </section>
  );
}
