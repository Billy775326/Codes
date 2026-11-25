import { useImperativeHandle, useRef, type Ref } from 'react';
import type { NativeConfigurationSnapshot } from '../shared/native-configuration';
import { useInterfaceLanguage } from './interface-language';
import { PanelMenu } from './PanelMenu';
import { Icon } from './primitives';

export interface ComposerControlsHandle {
  openModel: () => void;
  openReasoning: () => void;
  openPermissions: () => void;
}

export function ComposerControls({
  mode,
  changeMode,
  configuration,
  openConfiguration,
  planReady,
  disabled,
  ref,
}: {
  mode: 'default' | 'plan';
  changeMode: (mode: 'default' | 'plan') => void;
  configuration?: NativeConfigurationSnapshot;
  openConfiguration: () => void;
  planReady: boolean;
  disabled: boolean;
  ref: Ref<ComposerControlsHandle>;
}) {
  const { t } = useInterfaceLanguage();
  const modelMenu = useRef<HTMLDetailsElement>(null);
  const permissionMenu = useRef<HTMLDetailsElement>(null);
  const openMenu = (menu: HTMLDetailsElement | null) => {
    if (!menu) return;
    menu.open = true;
    menu.querySelector('button')?.focus();
  };
  useImperativeHandle(
    ref,
    () => ({
      openModel: () => openMenu(modelMenu.current),
      openReasoning: () => openMenu(modelMenu.current),
      openPermissions: () => openMenu(permissionMenu.current),
    }),
    [],
  );
  const model = configuration?.model ?? t('Codex default');
  const effort = (mode === 'plan' ? configuration?.planEffort : undefined) ?? configuration?.effort;
  const permission =
    configuration?.permissionProfile ?? configuration?.sandbox ?? t('Codex default');
  return (
    <>
      <PanelMenu
        label={t('Codex permissions')}
        hint={t('Permissions for future tasks')}
        className="permission-menu"
        controller={permissionMenu}
        trigger={
          <>
            <Icon name="shield" size={15} />
            <span className="permission-selection">{permission}</span>
            <Icon name="chevron" size={11} />
          </>
        }
      >
        <strong>{t('Codex permissions')}</strong>
        <p>{permission}</p>
        {configuration?.approvalPolicy && <p>{configuration.approvalPolicy}</p>}
        {configuration?.approvalsReviewer && <p>{configuration.approvalsReviewer}</p>}
        <button type="button" data-close-menu onClick={openConfiguration}>
          {t('Edit Codex configuration')}
        </button>
      </PanelMenu>
      {mode === 'plan' && (
        <button
          className="plan-mode"
          type="button"
          aria-label={t('Exit Plan mode')}
          disabled={disabled}
          onClick={() => changeMode('default')}
        >
          <span>{t('Plan')}</span>
          <Icon name="close" size={12} />
        </button>
      )}
      <PanelMenu
        label={t('Model and reasoning')}
        hint={model}
        className="model-menu"
        controller={modelMenu}
        trigger={
          <>
            <span className="model-selection">
              <span className="model-selection-name">{model}</span>
              {effort && <span className="model-selection-effort">· {effort}</span>}
            </span>
            <Icon name="chevron" size={11} />
          </>
        }
      >
        <strong>{t('Model and reasoning')}</strong>
        <p>
          {model}
          {effort && ' · ' + effort}
          {configuration?.fast && ' · ' + t('Fast')}
        </p>
        <label className="model-field">
          {t('Task mode')}
          <select
            aria-label={t('Task mode')}
            value={mode}
            disabled={disabled || !planReady}
            onChange={(event) => changeMode(event.target.value === 'plan' ? 'plan' : 'default')}
          >
            <option value="default">{t('Execution')}</option>
            <option value="plan">{t('Plan')}</option>
          </select>
        </label>
        <button
          type="button"
          data-close-menu
          aria-label={t('Edit Codex configuration')}
          onClick={openConfiguration}
        >
          {t('Edit Codex configuration')}
        </button>
      </PanelMenu>
    </>
  );
}
