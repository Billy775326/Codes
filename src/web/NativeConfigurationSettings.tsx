import { useEffect, useState, type FormEvent } from 'react';
import {
  nativeConfigurationEdits,
  type NativeConfigurationSnapshot,
} from '../shared/native-configuration';
import type { Model } from '../shared/types';
import { message, request } from './api';
import { useInterfaceLanguage } from './interface-language';
import { emptyFormDraft, type SettingsFormState } from './settings-form';

export const executionForm = 'settings-execution-form';

const modelFields = [
  { key: 'model', value: 'model', label: 'Model', options: undefined },
  { key: 'model_reasoning_effort', value: 'effort', label: 'Reasoning effort', options: undefined },
  {
    key: 'plan_mode_reasoning_effort',
    value: 'planEffort',
    label: 'Plan reasoning effort',
    options: undefined,
  },
  { key: 'service_tier', value: 'serviceTier', label: 'Service tier', options: undefined },
] as const;
const permissionFields = [
  {
    key: 'default_permissions',
    value: 'permissionProfile',
    label: 'Permission profile',
    options: undefined,
  },
  {
    key: 'sandbox_mode',
    value: 'sandbox',
    label: 'Legacy sandbox mode',
    options: ['read-only', 'workspace-write', 'danger-full-access'],
  },
  {
    key: 'approval_policy',
    value: 'approvalPolicy',
    label: 'Approval policy',
    options: ['untrusted', 'on-request', 'never'],
  },
  {
    key: 'approvals_reviewer',
    value: 'approvalsReviewer',
    label: 'Approval reviewer',
    options: ['user', 'auto_review'],
  },
] as const;
const featureFields = [
  {
    key: 'features.default_mode_request_user_input',
    value: 'codeQuestions',
    label: 'Code mode questions',
    options: ['true', 'false'],
  },
] as const;
const fieldGroups = [
  { id: 'model', label: 'Model and reasoning', fields: modelFields },
  { id: 'permissions', label: 'Permissions and approvals', fields: permissionFields },
  { id: 'features', label: 'Features', fields: featureFields },
] as const;

export function NativeConfigurationSettings({
  projectId,
  models,
  autoReviewReady,
  changed,
  onDraft,
}: {
  projectId?: string;
  models: Model[];
  autoReviewReady: boolean;
  changed: () => void;
  onDraft: (state: SettingsFormState) => void;
}) {
  const { t } = useInterfaceLanguage();
  const [snapshot, setSnapshot] = useState<NativeConfigurationSnapshot>();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(false);
  const path = projectId && '/projects/' + encodeURIComponent(projectId) + '/codex-configuration';
  const dirty = Object.keys(draft).length > 0;
  const canSave = !!(path && snapshot?.writable && snapshot.userVersion && !busy && dirty);
  useEffect(() => {
    onDraft({ changed: dirty, busy, canSave, saved });
  }, [dirty, busy, canSave, saved, onDraft]);
  useEffect(() => () => onDraft(emptyFormDraft), [onDraft]);
  useEffect(() => {
    if (!path) return;
    const abort = new AbortController();
    setSnapshot(undefined);
    setDraft({});
    setSaved(false);
    setError('');
    void request<NativeConfigurationSnapshot>(path, {}, abort.signal).then(
      (value) => {
        if (!abort.signal.aborted) setSnapshot(value);
      },
      (error) => {
        if (!abort.signal.aborted) setError(message(error));
      },
    );
    return () => abort.abort();
  }, [path, revision]);
  const selectedModel =
    models.find(
      (model) =>
        model.id === (draft.model ?? snapshot?.model) ||
        model.model === (draft.model ?? snapshot?.model),
    ) ?? (!(draft.model ?? snapshot?.model) ? models.find((model) => model.isDefault) : undefined);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!path || !snapshot?.userVersion || !canSave) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const changes = Object.fromEntries(
        Object.entries(draft).map(([key, value]) => [
          key,
          key === 'features.default_mode_request_user_input' && value
            ? value === 'true'
            : value || null,
        ]),
      );
      const input = nativeConfigurationEdits.parse({ version: snapshot.userVersion, changes });
      const next = await request<NativeConfigurationSnapshot>(path, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      setSnapshot(next);
      setDraft({});
      setSaved(true);
      changed();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="preferences-section" aria-label={t('Execution')}>
      {!path && <p>{t('Choose a project to read its effective configuration.')}</p>}
      {path && !snapshot && !error && <p role="status">{t('Loading…')}</p>}
      {snapshot && (
        <form id={executionForm} onSubmit={(event) => void save(event)}>
          {snapshot.writable && <p className="preference-help">{t('Codex user configuration')}</p>}
          {!snapshot.writable && (
            <p className="preference-help">{t('Edit this configuration using Codex CLI.')}</p>
          )}
          {fieldGroups.map(({ id, label, fields }) => (
            <section className="preferences-section" key={id} aria-labelledby={`execution-${id}`}>
              <h3 id={`execution-${id}`}>{t(label)}</h3>
              {fields.map((field) => {
                const effective =
                  field.value === 'serviceTier' && snapshot.serviceTier === 'priority'
                    ? 'fast'
                    : String(snapshot[field.value] ?? '');
                const choices =
                  field.options ??
                  (field.value === 'model'
                    ? models.map((model) => model.model)
                    : field.value === 'serviceTier'
                      ? ['default', 'fast']
                      : field.value === 'permissionProfile'
                        ? [':read-only', ':workspace']
                        : (selectedModel?.supportedReasoningEfforts.map(
                            (entry) => entry.reasoningEffort,
                          ) ?? []));
                const optionLabel = (option: string) => {
                  if (field.value === 'model')
                    return (
                      models.find((model) => model.model === option || model.id === option)
                        ?.displayName ?? option
                    );
                  return (
                    (
                      {
                        ':read-only': 'Read only',
                        ':workspace': 'Ask for approval',
                        'read-only': 'Read only',
                        'workspace-write': 'Ask for approval',
                        'danger-full-access': 'Full access',
                        default: 'Standard',
                        fast: 'Fast',
                        'on-request': 'Ask for approval',
                        untrusted: 'Untrusted commands',
                        never: 'Never',
                        user: 'User',
                        auto_review: 'Approve for me',
                        true: 'Enabled',
                        false: 'Disabled',
                      } as Record<string, string>
                    )[option] ?? option
                  );
                };
                const value = draft[field.key] ?? effective;
                const source = snapshot.sources[field.key];
                const update = (next: string) => {
                  setSaved(false);
                  setDraft((previous) => {
                    const updated = { ...previous };
                    if (next === effective) delete updated[field.key];
                    else updated[field.key] = next;
                    if (field.value === 'permissionProfile' && next) updated.sandbox_mode = '';
                    if (field.value === 'sandbox' && next) updated.default_permissions = '';
                    return updated;
                  });
                };
                const props = {
                  value,
                  disabled: busy || !snapshot.writable,
                  'aria-label': t(field.label),
                };
                return (
                  <label className="preference-row" key={field.key}>
                    <span className="preference-description">
                      {t(field.label)}
                      {source && source !== 'user' && (
                        <small className="preference-help">{t(source)}</small>
                      )}
                      {field.value === 'codeQuestions' && (
                        <small className="preference-help">
                          {t('Applies when Codex loads a conversation.')}
                        </small>
                      )}
                    </span>
                    <select {...props} onChange={(event) => update(event.target.value)}>
                      <option value="">{t('Codex default')}</option>
                      {value && !choices.some((option) => option === value) && (
                        <option value={value}>{t(optionLabel(value))}</option>
                      )}
                      {choices.map((option) => (
                        <option
                          key={option}
                          value={option}
                          disabled={
                            (field.value === 'approvalsReviewer' &&
                              option === 'auto_review' &&
                              !autoReviewReady) ||
                            (field.value === 'serviceTier' &&
                              option === 'fast' &&
                              (!selectedModel?.supportsFast || !snapshot.fastAvailable))
                          }
                        >
                          {t(optionLabel(option))}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </section>
          ))}
        </form>
      )}
      {error && (
        <p role="alert">
          {t(error)}{' '}
          <button type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)}>
            {t('Reload settings')}
          </button>
        </p>
      )}
    </section>
  );
}
