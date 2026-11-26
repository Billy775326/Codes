import type { Preferences } from './browser-preferences';
import { useInterfaceLanguage } from './interface-language';

export function KeyboardSettings({
  value,
  change,
}: {
  value: Preferences;
  change: (value: Preferences) => void;
}) {
  const { t } = useInterfaceLanguage();
  const shortcuts = [
    ['New line in the composer', 'Shift+Enter'],
    ['Recall sent messages in the composer', '↑ / ↓'],
    ['Switch follow-up delivery once', 'Ctrl/⌘+Shift+Enter'],
    ['New conversation', 'Ctrl/⌘+N'],
    ['Save the current settings form', 'Ctrl/⌘+S'],
  ] as const;
  return (
    <section className="preferences-section" aria-labelledby="preferences-keyboard">
      <h3 id="preferences-keyboard">{t('Keyboard')}</h3>
      <label className="preference-row">
        <span>{t('Send shortcut')}</span>
        <select
          value={value.enter}
          onChange={(event) =>
            change({ ...value, enter: event.target.value as Preferences['enter'] })
          }
        >
          <option value="enter">{t('Enter')}</option>
          <option value="cmdIfMultiline">{t('Multiline: Ctrl/Cmd+Enter')}</option>
          <option value="cmdAlways">Ctrl/Cmd+Enter</option>
        </select>
      </label>
      <label className="preference-row">
        <span className="preference-description">
          <span id="tab-to-queue-label">{t('Tab to queue')}</span>
          <small className="preference-help" id="tab-to-queue-help">
            {t('Tab queues a draft in Add to running task mode.')}
          </small>
        </span>
        <input
          className="preference-checkbox"
          type="checkbox"
          role="switch"
          checked={value.tabToQueue}
          aria-labelledby="tab-to-queue-label"
          aria-describedby="tab-to-queue-help"
          onChange={(event) => change({ ...value, tabToQueue: event.target.checked })}
        />
      </label>
      <details className="preferences-help">
        <summary>{t('Editing and shortcuts')}</summary>
        <dl className="keyboard-shortcuts">
          {shortcuts.map(([action, keys]) => (
            <div key={action}>
              <dt>{t(action)}</dt>
              <dd>
                <kbd>{keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
        <p>{t('On phones, Enter adds a line.')}</p>
      </details>
    </section>
  );
}
