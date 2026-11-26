import { useRef, useState } from 'react';
import type { Preferences } from './browser-preferences';
import {
  browserPreferencesFileLimit,
  exportBrowserPreferencesFile,
  parseBrowserPreferencesFile,
  type BrowserPreferencesFile,
} from './browser-preferences-file';
import { useInterfaceLanguage } from './interface-language';
import { Icon } from './primitives';
import type { SidebarWidths } from './SidebarResize';

const preferenceLabels: { [Key in keyof Preferences]-?: string } = {
  followUp: 'Follow-up delivery',
  enter: 'Send shortcut',
  tabToQueue: 'Tab to queue',
  newConversationDirectory: 'New conversation directory',
  review: 'Review location',
  theme: 'Theme',
  language: 'Language',
  autoScroll: 'Scroll with replies',
  notifications: 'Browser notifications',
  notificationEvents: 'Notification events',
  showHiddenFiles: 'Show hidden files',
  chatFontSize: 'Chat text size',
  codeFontSize: 'Code text size',
};
const preferenceKeys = Object.keys(preferenceLabels) as (keyof Preferences)[];

export function BrowserPreferencesTransfer({
  value,
  widths,
  apply,
}: {
  value: Preferences;
  widths: SidebarWidths;
  apply: (file: BrowserPreferencesFile) => boolean;
}) {
  const { t } = useInterfaceLanguage();
  const upload = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const readVersion = useRef(0);
  const [pending, setPending] = useState<BrowserPreferencesFile>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const changes = pending
    ? preferenceKeys
        .filter((key) => JSON.stringify(value[key]) !== JSON.stringify(pending.preferences[key]))
        .map((key) => preferenceLabels[key])
    : [];
  if (pending && pending.sidebarWidths.navigation !== widths.navigation)
    changes.push('Navigation width');
  if (pending && pending.sidebarWidths.context !== widths.context)
    changes.push('Files and changes panel width');

  function download() {
    const href = URL.createObjectURL(
      new Blob([exportBrowserPreferencesFile(value, widths)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = href;
    link.download = 'codes-browser-preferences.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function read(file: File) {
    const version = ++readVersion.current;
    setPending(undefined);
    setStatus('');
    setError('');
    if (file.size > browserPreferencesFileLimit) {
      setError('Browser preferences files must be 16 KiB or smaller.');
      return;
    }
    try {
      const contents = parseBrowserPreferencesFile(await file.text());
      if (version === readVersion.current) setPending(contents);
    } catch {
      if (version === readVersion.current)
        setError('Choose a valid Codes browser preferences file.');
    }
  }

  function dismiss() {
    setPending(undefined);
    setError('');
    importButton.current?.focus();
  }

  return (
    <section className="preferences-section" aria-labelledby="preferences-transfer">
      <h3 id="preferences-transfer">{t('Browser preferences')}</h3>
      <p className="preference-help">
        {t('JSON for appearance, interaction, notifications, and sidebar widths in this browser.')}
      </p>
      <div className="settings-transfer-actions">
        <button
          className="settings-action"
          type="button"
          aria-label={t('Export browser preferences')}
          onClick={download}
        >
          <Icon name="download" size={16} />
          {t('Export')}
        </button>
        <button
          className="settings-action"
          type="button"
          aria-label={t('Import browser preferences')}
          ref={importButton}
          onClick={() => upload.current?.click()}
        >
          <Icon name="upload" size={16} />
          {t('Import')}
        </button>
        <input
          ref={upload}
          hidden
          type="file"
          accept=".json,application/json"
          aria-label={t('Import browser preferences file')}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void read(file);
          }}
        />
      </div>
      {pending && (
        <div
          className="browser-preferences-review"
          role="group"
          aria-label={t('Review imported preferences')}
        >
          {changes.length ? (
            <>
              <strong>{t('Review imported preferences')}</strong>
              <ul className="browser-preferences-changes">
                {changes.map((label) => (
                  <li key={label}>{t(label)}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>{t('These preferences match this browser.')}</p>
          )}
          <div className="settings-transfer-actions">
            <button type="button" className="settings-action" onClick={dismiss}>
              {t(changes.length ? 'Cancel' : 'Done')}
            </button>
            {!!changes.length && (
              <button
                type="button"
                className="settings-action primary"
                onClick={() => {
                  if (!apply(pending)) {
                    setError('Could not save the imported preferences in this browser.');
                    return;
                  }
                  dismiss();
                  setStatus('Browser preferences imported.');
                }}
              >
                {t('Apply preferences')}
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p role="alert">{t(error)}</p>}
      {status && <p role="status">{t(status)}</p>}
    </section>
  );
}
