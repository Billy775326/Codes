import { useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type {
  NativeConfigurationEdits,
  NativeConfigurationSnapshot,
} from '../shared/native-configuration';
import type { Model } from '../shared/types';
import { useInterfaceLanguage } from './interface-language';
import { PanelMenu } from './PanelMenu';
import { Icon } from './primitives';

const permissions = [
  {
    sandbox: 'read-only',
    reviewer: 'user',
    policy: 'on-request',
    label: 'Read only',
    icon: 'eye',
    detail: 'Ask before edits or access outside the sandbox.',
  },
  {
    sandbox: 'workspace-write',
    reviewer: 'user',
    policy: 'on-request',
    label: 'Ask for approval',
    icon: 'lock',
    detail: 'Ask before file access outside the workspace or network use.',
  },
  {
    sandbox: 'workspace-write',
    reviewer: 'auto_review',
    policy: 'on-request',
    label: 'Approve for me',
    icon: 'shield',
    detail: 'Codex reviews eligible approval requests.',
  },
  {
    sandbox: 'danger-full-access',
    reviewer: 'user',
    policy: 'never',
    label: 'Full access',
    icon: 'warning',
    detail: 'Unrestricted server files and network without approval.',
  },
] as const;

export interface ComposerControlsHandle {
  openModel: () => void;
  openReasoning: () => void;
  openPermissions: () => void;
}

/** Composer edits persist through Codex. Project overrides remain visible after each write. */
export function ComposerControls({
  mode,
  changeMode,
  configuration,
  models,
  autoReviewReady,
  saveConfiguration,
  openConfiguration,
  planReady,
  disabled,
  ref,
}: {
  mode: 'default' | 'plan';
  changeMode: (mode: 'default' | 'plan') => void;
  configuration?: NativeConfigurationSnapshot;
  models: Model[];
  autoReviewReady: boolean;
  saveConfiguration: (changes: NativeConfigurationEdits['changes']) => Promise<void>;
  openConfiguration: () => void;
  planReady: boolean;
  disabled: boolean;
  ref: Ref<ComposerControlsHandle>;
}) {
  const { t } = useInterfaceLanguage();
  const modelMenu = useRef<HTMLDetailsElement>(null);
  const modelControl = useRef<HTMLSelectElement>(null);
  const effortControl = useRef<HTMLSelectElement>(null);
  const permissionMenu = useRef<HTMLDetailsElement>(null);
  const speedHint = useId();
  const [pendingFast, setPendingFast] = useState<boolean>();
  async function changeFast(fast: boolean) {
    setPendingFast(fast);
    try {
      await saveConfiguration({ service_tier: fast ? 'fast' : 'default' });
    } finally {
      setPendingFast(undefined);
    }
  }
  const openMenu = (menu: HTMLDetailsElement | null, control?: HTMLElement | null) => {
    if (!menu) return;
    menu.open = true;
    (control ?? menu.querySelector('button'))?.focus();
  };
  useImperativeHandle(
    ref,
    () => ({
      openModel: () => openMenu(modelMenu.current, modelControl.current),
      openReasoning: () => openMenu(modelMenu.current, effortControl.current),
      openPermissions: () => openMenu(permissionMenu.current),
    }),
    [],
  );
  const model =
    models.find(
      (entry) => entry.id === configuration?.model || entry.model === configuration?.model,
    ) ?? (!configuration?.model ? models.find((entry) => entry.isDefault) : undefined);
  const modelLabel = model?.displayName ?? configuration?.model ?? t('Codex default');
  const effort = (mode === 'plan' ? configuration?.planEffort : undefined) ?? configuration?.effort;
  const effortKey = mode === 'plan' ? 'plan_mode_reasoning_effort' : 'model_reasoning_effort';
  const profileSandbox = {
    ':read-only': 'read-only',
    ':workspace': 'workspace-write',
    ':danger-full-access': 'danger-full-access',
  };
  const sandbox = configuration?.permissionProfile
    ? profileSandbox[configuration.permissionProfile as keyof typeof profileSandbox]
    : configuration?.sandbox;
  const selectedPermission = permissions.find(
    (option) =>
      option.sandbox === sandbox &&
      option.reviewer === (configuration?.approvalsReviewer ?? 'user') &&
      option.policy === (configuration?.approvalPolicy ?? 'on-request'),
  );
  const permissionLabel = selectedPermission
    ? t(selectedPermission.label)
    : (configuration?.permissionProfile ?? configuration?.sandbox ?? t('Codex default'));
  const readOnly = disabled || !configuration?.writable || !configuration.userVersion;
  const supportsFast = !!model?.supportsFast && configuration?.fastAvailable !== false;
  const source = (key: string) => configuration?.sources?.[key];
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
            <span className="permission-selection">{permissionLabel}</span>
            <Icon name="chevron" size={11} />
          </>
        }
      >
        <strong className="permission-menu-heading">{t('Conversation permissions')}</strong>
        <small className="preference-help">{t('Codex user configuration')}</small>
        <div className="permission-options" role="group" aria-label={t('Permission presets')}>
          {permissions.map((option) => {
            const unavailable = option.reviewer === 'auto_review' && !autoReviewReady;
            const detail = t(unavailable ? 'Auto-review unavailable' : option.detail);
            return (
              <button
                key={option.label}
                type="button"
                className="permission-option"
                aria-label={t(option.label)}
                aria-description={detail}
                aria-pressed={selectedPermission === option}
                disabled={readOnly || unavailable}
                data-unrestricted={option.sandbox === 'danger-full-access' || undefined}
                data-close-menu
                onClick={() =>
                  void saveConfiguration({
                    default_permissions: null,
                    sandbox_mode: option.sandbox,
                    approval_policy: option.policy,
                    approvals_reviewer: option.reviewer,
                  })
                }
              >
                <Icon name={option.icon} size={16} />
                <span className="permission-option-copy">
                  <span>{t(option.label)}</span>
                  <small>{detail}</small>
                </span>
                {selectedPermission === option && <Icon name="check" size={14} />}
              </button>
            );
          })}
        </div>
        {(!selectedPermission ||
          source('default_permissions') === 'project' ||
          source('sandbox_mode') === 'project') && (
          <small className="preference-help">
            {permissionLabel}
            {' · '}
            {t(source('default_permissions') ?? source('sandbox_mode') ?? 'Codex default')}
          </small>
        )}
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
        hint={modelLabel}
        className="model-menu"
        controller={modelMenu}
        trigger={
          <>
            <span className="model-selection">
              <span className="model-selection-name">{modelLabel}</span>
              {effort && <span className="model-selection-effort">· {t(effort)}</span>}
            </span>
            <Icon name="chevron" size={11} />
          </>
        }
      >
        <strong>{t('Model and reasoning')}</strong>
        <small className="preference-help">{t('Codex user configuration')}</small>
        <label className="model-field">
          <span>
            {t('Model')}
            {source('model') && <small className="preference-help">{t(source('model')!)}</small>}
          </span>
          <select
            aria-label={t('Model')}
            ref={modelControl}
            value={configuration?.model ? (model?.model ?? configuration.model) : ''}
            disabled={readOnly}
            onChange={(event) => void saveConfiguration({ model: event.target.value || null })}
          >
            <option value="">{t('Codex default')}</option>
            {configuration?.model && !model && (
              <option value={configuration.model}>{configuration.model}</option>
            )}
            {models.map((entry) => (
              <option key={entry.id} value={entry.model}>
                {entry.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="model-field">
          <span>
            {t('Reasoning effort')}
            {source(effortKey) && (
              <small className="preference-help">{t(source(effortKey)!)}</small>
            )}
          </span>
          <select
            aria-label={t('Reasoning effort')}
            ref={effortControl}
            value={effort ?? ''}
            disabled={readOnly || !model}
            onChange={(event) =>
              void saveConfiguration({ [effortKey]: event.target.value || null })
            }
          >
            <option value="">{t('Codex default')}</option>
            {effort &&
              !model?.supportedReasoningEfforts.some(
                (entry) => entry.reasoningEffort === effort,
              ) && <option value={effort}>{t(effort)}</option>}
            {model?.supportedReasoningEfforts.map((entry) => (
              <option key={entry.reasoningEffort} value={entry.reasoningEffort}>
                {t(entry.reasoningEffort)}
              </option>
            ))}
          </select>
        </label>
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
        <label className="fast-option">
          <span className="fast-option-copy">
            {t('Fast')}
            <small id={speedHint}>{t(supportsFast ? 'Higher usage' : 'Fast unavailable')}</small>
          </span>
          <span className="fast-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label={t('Fast mode')}
              aria-describedby={speedHint}
              checked={pendingFast ?? configuration?.fast ?? false}
              disabled={
                readOnly || pendingFast !== undefined || (!supportsFast && !configuration?.fast)
              }
              onChange={(event) => void changeFast(event.target.checked)}
            />
            <span className="fast-switch-track" aria-hidden="true" />
          </span>
        </label>
        <button type="button" data-close-menu onClick={openConfiguration}>
          {t('Edit Codex configuration')}
        </button>
      </PanelMenu>
    </>
  );
}
