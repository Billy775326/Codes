import { useInterfaceLanguage } from './interface-language';
import { useId, useImperativeHandle, useRef, type Ref } from 'react';
import type { CodexDefaults, Model, Settings } from '../shared/types';
import { permissionLabel, permissionPresets } from '../shared/permissions';
import { PanelMenu } from './PanelMenu';
import { Icon } from './primitives';

const permissionOption = {
  'read-only': { icon: 'eye', detail: 'Ask before edits or access outside the sandbox.' },
  'workspace-write': {
    icon: 'lock',
    detail: 'Ask before file access outside the workspace or network use.',
  },
  'auto-review': { icon: 'shield', detail: 'Codex reviews eligible approval requests.' },
  'danger-full-access': {
    icon: 'warning',
    detail: 'Unrestricted server files and network without approval.',
  },
} satisfies Record<Settings['permission'], { icon: string; detail: string }>;

export interface ComposerControlsHandle {
  openModel: () => void;
  openReasoning: () => void;
  openPermissions: () => void;
}

function modelSelection(settings: Settings, models: Model[], defaults?: CodexDefaults) {
  const model = settings.model ?? defaults?.model;
  return {
    model,
    selectedModel: model
      ? models.find((entry) => entry.id === model || entry.model === model)
      : models.find((entry) => entry.isDefault),
    nativeEffort: settings.mode === 'plan' ? defaults?.planEffort : defaults?.effort,
  };
}

/** Presentation and popup focus only. Task dispatch and durable receipts stay with the workspace. */
export function ComposerControls({
  settings,
  autoReviewReady,
  change,
  models,
  codexDefaults,
  modesReady,
  planReady,
  disabled,
  ref,
}: {
  settings: Settings;
  autoReviewReady?: boolean;
  change: (settings: Settings) => void;
  models: Model[];
  codexDefaults?: CodexDefaults;
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
  const { model, selectedModel, nativeEffort } = modelSelection(settings, models, codexDefaults);
  const effort = settings.effort ?? nativeEffort ?? selectedModel?.defaultReasoningEffort;
  const effortLabel = effort ? t(effort.charAt(0).toUpperCase() + effort.slice(1)) : t('Default');
  const modelLabel = selectedModel?.displayName ?? model ?? t('Default model');
  const fastLabel = (settings.fast ?? codexDefaults?.fast) ? ' · ' + t('Fast') : '';
  const defaultEffort = settings.effort
    ? ''
    : ' ' + t(nativeEffort ? '(Codex default)' : '(model default)');
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
        <strong className="permission-menu-heading">{t('Conversation permissions')}</strong>
        <div className="permission-options" role="group" aria-label={t('Permission presets')}>
          {permissionPresets.map(({ id, label }) => {
            const option = permissionOption[id];
            const selected = settings.permission === id;
            const unavailable = id === 'auto-review' && !autoReviewReady;
            const detail = t(unavailable ? 'Auto-review unavailable' : option.detail);
            return (
              <button
                key={id}
                className="permission-option"
                type="button"
                aria-label={t(label)}
                aria-description={detail}
                aria-pressed={selected}
                disabled={disabled || unavailable}
                data-unrestricted={id === 'danger-full-access' || undefined}
                data-close-menu
                onClick={() => change({ ...settings, permission: id })}
              >
                <Icon name={option.icon} size={16} />
                <span className="permission-option-copy">
                  <span>{t(label)}</span>
                  <small>{detail}</small>
                </span>
                {selected && <Icon name="check" size={14} />}
              </button>
            );
          })}
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
          codexDefaults={codexDefaults}
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
  codexDefaults,
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
  codexDefaults?: CodexDefaults;
  modesReady: boolean;
  planReady: boolean;
  disabled: boolean;
  modelControl?: Ref<HTMLSelectElement>;
  effortControl?: Ref<HTMLSelectElement>;
  defaults?: boolean;
}) {
  const { t } = useInterfaceLanguage();
  const { selectedModel, nativeEffort } = modelSelection(settings, models, codexDefaults);
  const defaultEffort = nativeEffort ?? selectedModel?.defaultReasoningEffort;
  const fast = settings.fast ?? codexDefaults?.fast ?? false;
  const supportsFast = !!selectedModel?.supportsFast && codexDefaults?.fastAvailable !== false;
  const speedHintId = useId();
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
              fast: settings.fast === undefined ? undefined : false,
            })
          }
          disabled={disabled}
        >
          <option value="">{t('Codex default')}</option>
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
            {t('Codex default')}
            {defaultEffort ? ' (' + t(defaultEffort) + ')' : ''}
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
        <span className="fast-option-copy">
          {t('Fast')}
          <small id={speedHintId}>
            {supportsFast
              ? t(settings.fast === undefined ? 'Codex default' : 'Higher usage')
              : t('Fast unavailable')}
          </small>
        </span>
        <span className="fast-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label={defaults ? t('Default fast mode') : t('Fast mode')}
            aria-describedby={speedHintId}
            checked={fast}
            disabled={disabled || (!supportsFast && !fast)}
            onChange={(event) => change({ ...settings, fast: event.target.checked })}
          />
          <span className="fast-switch-track" aria-hidden="true" />
        </span>
      </label>
      {settings.fast !== undefined && (
        <button
          type="button"
          className="preference-reset-speed"
          disabled={disabled}
          onClick={() => change({ ...settings, fast: undefined })}
        >
          {t('Use Codex default speed')}
        </button>
      )}
    </>
  );
}
