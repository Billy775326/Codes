import { useInterfaceLanguage } from './interface-language';
import { useImperativeHandle, useRef, type Ref } from 'react';
import type { Model, Settings } from '../shared/types';
import { permissionLabel, permissionPresets } from '../shared/permissions';
import { PanelMenu } from './PanelMenu';
import { Icon } from './primitives';

export interface ComposerControlsHandle {
  openModel: () => void;
  openReasoning: () => void;
  openPermissions: () => void;
}

/** Presentation and popup focus only. Task dispatch and durable receipts stay with the workspace. */
export function ComposerControls({
  settings,
  autoReviewReady,
  change,
  models,
  resolvedModel,
  modesReady,
  planReady,
  disabled,
  ref,
}: {
  settings: Settings;
  autoReviewReady?: boolean;
  change: (settings: Settings) => void;
  models: Model[];
  resolvedModel?: string;
  modesReady: boolean;
  planReady: boolean;
  disabled: boolean;
  ref: Ref<ComposerControlsHandle>;
}) {
  const { t } = useInterfaceLanguage();
  const modelMenu = useRef<HTMLDetailsElement>(null);
  const modelControl = useRef<HTMLSelectElement>(null);
  const effortControl = useRef<HTMLSelectElement>(null);
  const permissionControl = useRef<HTMLDetailsElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      openModel() {
        if (modelMenu.current) modelMenu.current.open = true;
        modelControl.current?.focus();
      },
      openReasoning() {
        if (modelMenu.current) modelMenu.current.open = true;
        effortControl.current?.focus();
      },
      openPermissions() {
        if (!disabled && modesReady && permissionControl.current) {
          permissionControl.current.open = true;
          permissionControl.current.querySelector('summary')?.focus();
        }
      },
    }),
    [disabled, modesReady],
  );
  const selectedModel =
    models.find(
      (entry) =>
        entry.id === (settings.model || resolvedModel) ||
        entry.model === (settings.model || resolvedModel),
    ) ?? (!settings.model && !resolvedModel ? models.find((entry) => entry.isDefault) : undefined);
  const effort = settings.effort || selectedModel?.defaultReasoningEffort;
  const effortLabel = effort ? t(effort.charAt(0).toUpperCase() + effort.slice(1)) : t('Default');
  const modelLabel =
    selectedModel?.displayName ?? settings.model ?? resolvedModel ?? t('Default model');
  const fastLabel = settings.fast ? ' · ' + t('Fast') : '';
  const defaultEffort = settings.effort ? '' : ' ' + t('(model default)');
  const modeLabel = t(settings.mode === 'plan' ? 'Plan' : 'Execution');
  return (
    <>
      <PanelMenu
        label={t('Codex permissions')}
        hint={t('Permissions for future tasks')}
        description={t(permissionLabel(settings.permission)) + ' · ' + t('Future tasks')}
        controller={permissionControl}
        className="permission-menu"
        disabled={disabled || !modesReady}
        trigger={
          <>
            <Icon name="shield" size={15} />
            <span className="permission-selection">{t(permissionLabel(settings.permission))}</span>
            <Icon name="chevron" size={11} />
          </>
        }
      >
        <strong>{t('Conversation permissions')}</strong>
        <div role="group" aria-label={t('Permission presets')}>
          {permissionPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-label={t(preset.label)}
              aria-description={t(preset.description)}
              aria-pressed={settings.permission === preset.id}
              disabled={disabled || (preset.id === 'auto-review' && !autoReviewReady)}
              data-close-menu
              onClick={() => change({ ...settings, permission: preset.id })}
            >
              <span>{t(preset.label)}</span>
              <small>{t(preset.description)}</small>
            </button>
          ))}
        </div>
      </PanelMenu>
      {settings.mode === 'plan' && (
        <button
          className="plan-mode"
          aria-label={t('Exit Plan mode')}
          data-tooltip=""
          disabled={disabled}
          onClick={() => change({ ...settings, mode: 'default' })}
        >
          <span>{t('Plan')}</span>
          <Icon name="close" size={12} />
        </button>
      )}
      <PanelMenu
        label={t('Model and reasoning')}
        hint={modelLabel + fastLabel}
        description={`${modelLabel} · ${effortLabel}${defaultEffort}${fastLabel} · ${modeLabel}`}
        controller={modelMenu}
        className="model-menu"
        trigger={
          <>
            <span className="model-selection">
              <span className="model-selection-name">{modelLabel}</span>
              <span className="model-selection-effort">· {effortLabel}</span>
            </span>
            <Icon name="chevron" size={11} />
          </>
        }
      >
        <strong>{t('Model and reasoning')}</strong>
        <ModelSettingsFields
          settings={settings}
          change={change}
          models={models}
          resolvedModel={resolvedModel}
          modesReady={modesReady}
          planReady={planReady}
          disabled={disabled}
          modelControl={modelControl}
          effortControl={effortControl}
        />
      </PanelMenu>
    </>
  );
}

export function ModelSettingsFields({
  settings,
  change,
  models,
  resolvedModel,
  modesReady,
  planReady,
  disabled,
  modelControl,
  effortControl,
  defaults = false,
}: {
  settings: Settings;
  change: (value: Settings) => void;
  models: Model[];
  resolvedModel?: string;
  modesReady: boolean;
  planReady: boolean;
  disabled: boolean;
  modelControl?: Ref<HTMLSelectElement>;
  effortControl?: Ref<HTMLSelectElement>;
  defaults?: boolean;
}) {
  const { t } = useInterfaceLanguage();
  const selectedModel =
    models.find(
      (entry) =>
        entry.id === (settings.model || resolvedModel) ||
        entry.model === (settings.model || resolvedModel),
    ) ?? (!settings.model && !resolvedModel ? models.find((entry) => entry.isDefault) : undefined);
  return (
    <>
      <label className="model-field">
        {t('Model')}
        <select
          aria-label={defaults ? t('Default model') : t('Model')}
          ref={modelControl}
          value={settings.model ?? ''}
          onChange={(e) =>
            change({
              ...settings,
              model: e.target.value || undefined,
              effort: undefined,
              fast: false,
            })
          }
          disabled={disabled}
        >
          <option value="">{t('Default')}</option>
          {settings.model && !models.some((entry) => entry.id === settings.model) && (
            <option value={settings.model}>{settings.model}</option>
          )}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="model-field">
        {t('Reasoning effort')}
        <select
          ref={effortControl}
          aria-label={defaults ? t('Default reasoning effort') : t('Reasoning effort')}
          value={settings.effort ?? ''}
          disabled={disabled || !selectedModel}
          onChange={(event) => change({ ...settings, effort: event.target.value || undefined })}
        >
          <option value="">
            {t('Default')}
            {selectedModel ? ' (' + t(selectedModel.defaultReasoningEffort ?? '') + ')' : ''}
          </option>
          {settings.effort &&
            !selectedModel?.supportedReasoningEfforts.some(
              (entry) => entry.reasoningEffort === settings.effort,
            ) && (
              <option value={settings.effort}>
                {t(settings.effort ?? '')}
                {' ' + t('(unavailable)')}
              </option>
            )}
          {selectedModel?.supportedReasoningEfforts.map((entry) => (
            <option key={t(entry.reasoningEffort)} value={entry.reasoningEffort}>
              {t(entry.reasoningEffort)}
            </option>
          ))}
        </select>
      </label>
      <label className="model-field">
        {t('Task mode')}
        <select
          aria-label={defaults ? t('Default task mode') : t('Task mode')}
          value={settings.mode ?? 'default'}
          disabled={disabled || !modesReady}
          onChange={(event) =>
            change({ ...settings, mode: event.target.value as Settings['mode'] })
          }
        >
          <option value="default">{t('Execution')}</option>
          <option value="plan" disabled={!planReady}>
            {t('Plan')}
          </option>
        </select>
      </label>
      <label className="fast-option">
        <span>
          {t('Fast')}
          <small>
            {selectedModel?.supportsFast ? t('Higher usage') : t('Unavailable for this model')}
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label={defaults ? t('Default fast mode') : t('Fast mode')}
          checked={!!settings.fast}
          disabled={disabled || (!selectedModel?.supportsFast && !settings.fast)}
          onChange={(event) => change({ ...settings, fast: event.target.checked })}
        />
      </label>
    </>
  );
}
