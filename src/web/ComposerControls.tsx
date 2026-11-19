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
  change,
  models,
  resolvedModel,
  modesReady,
  disabled,
  ref,
}: {
  settings: Settings;
  change: (settings: Settings) => void;
  models: Model[];
  resolvedModel?: string;
  modesReady: boolean;
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
  return (
    <>
      <PanelMenu
        label="Codex permissions"
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
        <strong>Next task permissions</strong>
        <div role="group" aria-label="Permission presets">
          {permissionPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={settings.permission === preset.id}
              disabled={disabled}
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
        controller={modelMenu}
        className="model-menu"
        trigger={
          <>
            <span>{selectedModel?.displayName ?? settings.model ?? 'Default model'}</span>
            <Icon name="chevron" size={11} />
          </>
        }
      >
        <strong>Model and reasoning</strong>
        <label>
          Model
          <select
            aria-label="Model"
            ref={modelControl}
            value={settings.model ?? ''}
            onChange={(e) =>
              change({
                ...settings,
                model: e.target.value || undefined,
                effort: undefined,
              })
            }
            disabled={disabled}
          >
            <option value="">Default model</option>
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
        <label>
          Reasoning effort
          <select
            ref={effortControl}
            aria-label="Reasoning effort"
            value={settings.effort ?? ''}
            disabled={disabled || !selectedModel}
            onChange={(event) => change({ ...settings, effort: event.target.value || undefined })}
          >
            <option value="">
              Model default
              {selectedModel ? ' · ' + selectedModel.defaultReasoningEffort : ''}
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
      </PanelMenu>
    </>
  );
}
