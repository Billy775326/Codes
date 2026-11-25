import { useEffect, useRef, useState } from 'react';
import type { ProjectInstructions } from '../shared/project-instructions';
import { ApiError, message, request } from './api';
import { useInterfaceLanguage } from './interface-language';

export function ProjectInstructionsSettings({
  project,
  onDraft,
}: {
  project: { id: string; name: string };
  onDraft: (value: { changed: boolean; busy: boolean }) => void;
}) {
  const { t } = useInterfaceLanguage();
  const path = `/projects/${encodeURIComponent(project.id)}/instructions`;
  const [snapshot, setSnapshot] = useState<ProjectInstructions>();
  const [draft, setDraft] = useState('');
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const changed = !!snapshot && draft !== snapshot.text;
  useEffect(() => {
    const controller = new AbortController();
    void request<ProjectInstructions>(path, {}, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setSnapshot(value);
        setDraft(value.text);
      },
      (error) => {
        if (!controller.signal.aborted) setError(message(error));
      },
    );
    return () => controller.abort();
  }, [path, reload]);
  useEffect(() => onDraft({ changed, busy: saving }), [changed, saving, onDraft]);

  const loadAgain = () => {
    setSnapshot(undefined);
    setConflict(false);
    setSaved(false);
    setError('');
    setReload((value) => value + 1);
  };
  const save = async () => {
    if (!snapshot || !changed || conflict || saving) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const next = await request<ProjectInstructions>(path, {
        method: 'PUT',
        body: JSON.stringify({ revision: snapshot.revision, text: draft }),
      });
      setSnapshot(next);
      setDraft(next.text);
      setSaved(true);
    } catch (error) {
      setError(message(error));
      setConflict(
        error instanceof ApiError && (error.code === 'INSTRUCTIONS_CONFLICT' || error.uncertain),
      );
    } finally {
      setSaving(false);
      requestAnimationFrame(() => {
        if (editor.current?.checkVisibility()) editor.current.focus();
      });
    }
  };

  return (
    <form
      className="preferences-section project-instructions"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h3>{project.name} · AGENTS.md</h3>
      {snapshot ? (
        <textarea
          ref={editor}
          aria-label={t('AGENTS.md contents')}
          spellCheck={false}
          value={draft}
          disabled={saving}
          onChange={(event) => {
            setDraft(event.target.value);
            setSaved(false);
          }}
        />
      ) : (
        !error && <p role="status">{t('Loading AGENTS.md…')}</p>
      )}
      {error && <p role="alert">{t(error)}</p>}
      {saved && <p role="status">{t('AGENTS.md saved.')}</p>}
      <div className="network-actions">
        {conflict && (
          <button type="button" onClick={loadAgain}>
            {t('Discard draft and reload file')}
          </button>
        )}
        {!snapshot && error && (
          <button type="button" onClick={loadAgain}>
            {t('Retry loading')}
          </button>
        )}
        {snapshot && (
          <button
            className="preferences-done"
            type="submit"
            disabled={!changed || conflict || saving}
          >
            {t(
              saving
                ? 'Saving…'
                : snapshot.revision === null
                  ? 'Create AGENTS.md'
                  : 'Save AGENTS.md',
            )}
          </button>
        )}
      </div>
    </form>
  );
}
