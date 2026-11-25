import { useEffect, useState, type FormEvent } from 'react';
import {
  nativeConfigurationEdits,
  type NativeConfigurationSnapshot,
} from '../shared/native-configuration';
import { message, request } from './api';
import { useInterfaceLanguage } from './interface-language';

const fields = [
  { key: 'model', value: 'model', label: 'Model', options: undefined },
  { key: 'model_reasoning_effort', value: 'effort', label: 'Reasoning effort', options: undefined },
  {
    key: 'plan_mode_reasoning_effort',
    value: 'planEffort',
    label: 'Plan reasoning effort',
    options: undefined,
  },
  { key: 'service_tier', value: 'serviceTier', label: 'Service tier', options: undefined },
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
  {
    key: 'features.default_mode_request_user_input',
    value: 'codeQuestions',
    label: 'Code mode questions',
    options: ['true', 'false'],
  },
] as const;

export function NativeConfigurationSettings({
  projectId,
  changed,
  onDraft,
}: {
  projectId?: string;
  changed: () => void;
  onDraft: (state: { changed: boolean; busy: boolean }) => void;
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
  useEffect(() => {
    onDraft({ changed: dirty, busy });
    return () => onDraft({ changed: false, busy: false });
  }, [dirty, busy, onDraft]);
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
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!path || !snapshot?.userVersion || busy || !dirty) return;
    setBusy(true);
    setError('');
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
    <section className="preferences-section" aria-label={t('Codex configuration')}>
      <h3>{t('Codex configuration')}</h3>
      {!path && <p>{t('Choose a project to read its effective configuration.')}</p>}
      {path && !snapshot && !error && <p role="status">{t('Loading…')}</p>}
      {snapshot && (
        <form onSubmit={(event) => void save(event)}>
          <p className="preference-help">
            {t(
              'Changes are saved to the Codex user configuration. This page shows the effective values for the selected project.',
            )}
          </p>
          {!snapshot.writable && (
            <p className="preference-help">{t('Edit this configuration using Codex CLI.')}</p>
          )}
          {fields.map((field) => {
            const effective = String(snapshot[field.value] ?? '');
            const value = draft[field.key] ?? effective;
            const source = snapshot.sources[field.key];
            const update = (next: string) => {
              setSaved(false);
              setDraft((previous) => {
                const updated = { ...previous };
                if (next === effective) delete updated[field.key];
                else updated[field.key] = next;
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
                  {source && <small className="preference-help">{t(source)}</small>}
                </span>
                {field.options ? (
                  <select {...props} onChange={(event) => update(event.target.value)}>
                    <option value="">{t('Codex default')}</option>
                    {effective && !field.options.some((option) => option === effective) && (
                      <option value={effective}>{effective}</option>
                    )}
                    {field.options.map((value) => (
                      <option key={value} value={value}>
                        {t(value)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...props}
                    placeholder={t('Codex default')}
                    maxLength={
                      field.key === 'model' || field.key === 'default_permissions' ? 150 : 80
                    }
                    onChange={(event) => update(event.target.value)}
                  />
                )}
              </label>
            );
          })}
          {snapshot.writable && (
            <button type="submit" className="primary" disabled={busy || !dirty}>
              {t('Save Codex configuration')}
            </button>
          )}
        </form>
      )}
      {saved && <p role="status">{t('Saved. Effective project values are shown above.')}</p>}
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
