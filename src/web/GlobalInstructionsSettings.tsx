import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GlobalInstructions } from '../shared/project-instructions';
import { ApiError, message, request } from './api';
import { useInterfaceLanguage } from './interface-language';
import type { SettingsFormState } from './settings-form';

const path = '/settings/codex-instructions';
export const instructionsForm = 'settings-instructions-form';

export function GlobalInstructionsSettings({
  onDraft,
}: {
  onDraft: (value: SettingsFormState) => void;
}) {
  const { t } = useInterfaceLanguage();
  const [snapshot, setSnapshot] = useState<GlobalInstructions>();
  const [draft, setDraft] = useState('');
  const [reload, setReload] = useState({ keepDraft: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reviewLatest, setReviewLatest] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const restoreEditorFocus = useRef(false);
  useLayoutEffect(() => {
    if (saving || !restoreEditorFocus.current) return;
    restoreEditorFocus.current = false;
    if (editor.current?.checkVisibility()) editor.current.focus();
  });
  const changed = !!snapshot && draft !== snapshot.text;
  const busy = saving || (loading && changed);
  const canSave = changed && !saving && !loading && !conflict;
  useEffect(() => {
    const controller = new AbortController();
    void request<GlobalInstructions>(path, {}, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setSnapshot(value);
        if (!reload.keepDraft) setDraft(value.text);
        setReviewLatest(reload.keepDraft);
        setConflict(false);
        setLoading(false);
      },
      (error) => {
        if (controller.signal.aborted) return;
        setError(message(error));
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [reload]);
  useEffect(
    () => onDraft({ changed, busy, canSave, saved }),
    [changed, busy, canSave, saved, onDraft],
  );

  const loadAgain = (keepDraft: boolean) => {
    setLoading(true);
    setSaved(false);
    setError('');
    setReload({ keepDraft });
  };
  const save = async () => {
    if (!snapshot || !canSave) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const next = await request<GlobalInstructions>(path, {
        method: 'PUT',
        body: JSON.stringify({
          filename: snapshot.filename,
          revision: snapshot.revision,
          text: draft,
        }),
      });
      setSnapshot(next);
      setDraft(next.text);
      setReviewLatest(false);
      setSaved(true);
    } catch (error) {
      setError(message(error));
      setConflict(
        error instanceof ApiError && (error.code === 'INSTRUCTIONS_CONFLICT' || error.uncertain),
      );
    } finally {
      restoreEditorFocus.current = true;
      setSaving(false);
    }
  };

  return (
    <form
      id={instructionsForm}
      className="preferences-section instructions-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="settings-section-header">
        <h3>{t('Codex global instructions')}</h3>
        {snapshot && <code>{snapshot.filename}</code>}
      </div>
      <p className="preference-help" id="codex-global-instructions-help">
        {t('Used by new Codex sessions.')}
        {snapshot?.filename === 'AGENTS.override.md' && (
          <> {t('Clearing this override activates AGENTS.md.')}</>
        )}
      </p>
      {snapshot ? (
        <>
          {reviewLatest && changed && (
            <details className="instructions-saved-version" open>
              <summary>{t('Saved version')}</summary>
              <pre>{snapshot.text}</pre>
            </details>
          )}
          <textarea
            ref={editor}
            aria-label={t('Global instructions contents')}
            aria-describedby="codex-global-instructions-help"
            spellCheck={false}
            value={draft}
            disabled={saving || loading}
            onChange={(event) => {
              setDraft(event.target.value);
              setSaved(false);
            }}
          />
        </>
      ) : (
        !error && <p role="status">{t('Loading global instructions…')}</p>
      )}
      {(error || conflict) && (
        <div className="settings-action-row">
          {error && <span role="alert">{t(error)}</span>}
          {conflict && (
            <button
              className="settings-action"
              type="button"
              disabled={loading}
              onClick={() => loadAgain(true)}
            >
              {t('Load latest and keep draft')}
            </button>
          )}
          {!snapshot && error && (
            <button className="settings-action" type="button" onClick={() => loadAgain(false)}>
              {t('Retry loading')}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
