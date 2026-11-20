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
  const effortLabel = effort ? effort.charAt(0).toUpperCase() + effort.slice(1) : 'Default';
  const modelLabel =
    selectedModel?.displayName ?? settings.model ?? resolvedModel ?? 'Default model';
  return (
    <>
      <PanelMenu
        label="Codex permissions"
        description="Applies to future tasks in this conversation. Running tasks and queued messages keep their settings."
        controller={permissionControl}
        className="permission-menu"
        disabled={disabled || !modesReady}
        trigger={
          <>
            <span>{permissionLabel(settings.permission)}</span>
            <Icon name="chevron" size={11} />
          </>
        }
      >
        <strong>Conversation permissions</strong>
        <div role="group" aria-label="Permission presets">
          {permissionPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-label={preset.label}
              aria-description={preset.description}
              aria-pressed={settings.permission === preset.id}
              disabled={disabled || (preset.id === 'auto-review' && !autoReviewReady)}
              data-close-menu
              onClick={() => change({ ...settings, permission: preset.id })}
            >
              <span>{preset.label}</span>
              <small>{preset.description}</small>
            </button>
          ))}
        </div>
      </PanelMenu>
      {settings.mode === 'plan' && (
        <button
          className="plan-mode"
          aria-label="Exit Plan mode"
          disabled={disabled}
          onClick={() => change({ ...settings, mode: 'default' })}
        >
          Plan ×
        </button>
      )}
      <div className="toolbar-spacer" />
      <PanelMenu
        label="Model and reasoning"
        description={`${modelLabel} · ${effortLabel}${!settings.effort ? ' (model default)' : ''}${settings.fast ? ' · Fast' : ''} · ${settings.mode === 'plan' ? 'Plan' : 'Execution'} · Future tasks in this conversation`}
        controller={modelMenu}
        className="model-menu"
        trigger={
          <>
            <span
              className="model-selection"
              title={`${modelLabel} · ${effortLabel}${!settings.effort ? ' (model default)' : ''}`}
            >
              <span className="model-selection-name">{modelLabel}</span>
              <span className="model-selection-effort">· {effortLabel}</span>
            </span>
            <Icon name="chevron" size={11} />
          </>
        }
      >
        <strong>Model and reasoning</strong>
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
  const selectedModel =
    models.find(
      (entry) =>
        entry.id === (settings.model || resolvedModel) ||
        entry.model === (settings.model || resolvedModel),
    ) ?? (!settings.model && !resolvedModel ? models.find((entry) => entry.isDefault) : undefined);
  return (
    <>
      <label className="model-field">
        Model
        <select
          aria-label={defaults ? 'Default model' : 'Model'}
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
          <option value="">Default</option>
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
        Reasoning effort
        <select
          ref={effortControl}
          aria-label={defaults ? 'Default reasoning effort' : 'Reasoning effort'}
          value={settings.effort ?? ''}
          disabled={disabled || !selectedModel}
          onChange={(event) => change({ ...settings, effort: event.target.value || undefined })}
        >
          <option value="">
            Default{selectedModel ? ' (' + selectedModel.defaultReasoningEffort + ')' : ''}
          </option>
          {settings.effort &&
            !selectedModel?.supportedReasoningEfforts.some(
              (entry) => entry.reasoningEffort === settings.effort,
            ) && <option value={settings.effort}>{settings.effort} (unavailable)</option>}
          {selectedModel?.supportedReasoningEfforts.map((entry) => (
            <option
              key={entry.reasoningEffort}
              value={entry.reasoningEffort}
              title={entry.description}
            >
              {entry.reasoningEffort}
            </option>
          ))}
        </select>
      </label>
      <label className="model-field">
        Task mode
        <select
          aria-label={defaults ? 'Default task mode' : 'Task mode'}
          value={settings.mode ?? 'default'}
          disabled={disabled || !modesReady}
          onChange={(event) =>
            change({ ...settings, mode: event.target.value as Settings['mode'] })
          }
        >
          <option value="default">Execution</option>
          <option value="plan" disabled={!planReady}>
            Plan
          </option>
        </select>
      </label>
      <label className="fast-option">
        <span>
          Fast
          <small>
            {selectedModel?.supportsFast ? 'Higher usage' : 'Unavailable for this model'}
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label={defaults ? 'Default fast mode' : 'Fast mode'}
          checked={!!settings.fast}
          disabled={disabled || (!selectedModel?.supportsFast && !settings.fast)}
          onChange={(event) => change({ ...settings, fast: event.target.checked })}
        />
      </label>
    </>
  );
}
