import { useState } from 'react';
import { notificationAccess, showNotification } from './browser-notifications';

export function NotificationSettings({
  enabled,
  change,
}: {
  enabled: boolean;
  change: (enabled: boolean) => void;
}) {
  const [access, setAccess] = useState(notificationAccess);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [tested, setTested] = useState(false);
  const unavailable = ['insecure', 'unsupported', 'denied'].includes(access);
  async function toggleNotifications(on: boolean) {
    setError('');
    setTested(false);
    if (!on) {
      change(false);
      return;
    }
    setRequesting(true);
    try {
      const permission =
        notificationAccess() === 'granted' ? 'granted' : await Notification.requestPermission();
      setAccess(permission);
      if (permission === 'granted') change(true);
      else if (permission === 'default') setError('Notification permission was not granted.');
    } catch {
      setError('Could not request browser notification permission.');
    } finally {
      setRequesting(false);
    }
  }
  return (
    <section className="preferences-section" aria-labelledby="preferences-notifications">
      <h3 id="preferences-notifications">Notifications</h3>
      <label className="preference-row">
        <span>Browser notifications</span>
        <input
          className="preference-checkbox"
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={requesting || (unavailable && !enabled)}
          onChange={(event) => void toggleNotifications(event.target.checked)}
        />
      </label>
      <p className="preference-help">
        {access === 'denied'
          ? 'Allow notifications in this site’s browser settings.'
          : access === 'insecure'
            ? 'Open Codes over HTTPS or on localhost to enable notifications.'
            : access === 'unsupported'
              ? 'This browser does not support desktop notifications.'
              : 'Get notified about tasks, approvals, and questions while the Codes tab is open in the background.'}
      </p>
      {enabled && access === 'granted' && (
        <button
          type="button"
          onClick={() => {
            setError('');
            setTested(false);
            try {
              showNotification('Codes test notification', 'codes-test');
              setTested(true);
            } catch {
              setError('This browser could not display a notification.');
            }
          }}
        >
          Send test notification
        </button>
      )}
      {tested && <p role="status">Test notification requested.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
