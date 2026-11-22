import { useInterfaceLanguage } from './interface-language';
import { useRef, useState } from 'react';
import type { Action } from '../shared/types';
import { message, post } from './api';
import { DiffView } from './DiffView';
import './questions.css';

export function Approval({
  action,
  submit,
}: {
  action: Action;
  submit: (
    action: Action,
    input: { decision?: string; answers?: Record<string, string> },
  ) => Promise<void>;
}) {
  const { t } = useInterfaceLanguage();
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (action.questions ?? [])
        .filter((q) => q.options?.length && !q.secret)
        .map((q) => [q.id, q.options![0]!.label]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const sending = useRef(false);
  const answer = async (input: { decision?: string; answers?: Record<string, string> }) => {
    if (sending.current || action.status !== 'pending') return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      await submit(action, input);
    } catch (e) {
      setError(message(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const disabled = busy || action.status !== 'pending';
  const questions = action.questions ?? [];
  const complete = !!questions.length && questions.every((q) => !!answers[q.id]?.trim());
  return (
    <section
      className="approval"
      aria-label={t(action.title)}
      id={'action-' + action.id}
      tabIndex={-1}
    >
      <div className="approval-heading">
        <span className="approval-dot" />
        <strong>{t(action.title)}</strong>
        <span className="badge">
          {action.kind === 'questions'
            ? action.blocking === false
              ? t('OPTIONAL INPUT')
              : t('ANSWER REQUIRED')
            : t('REVIEW REQUIRED')}
        </span>
      </div>
      {action.kind !== 'questions' && <pre>{action.detail}</pre>}
      {!!action.files?.length && (
        <DiffView
          files={action.files}
          truncated={action.truncated}
          title={t('Proposed file changes')}
        />
      )}
      {action.kind === 'questions' && (
        <p className="question-help">
          {action.async
            ? t('You can answer while Codex works or after it finishes.')
            : action.blocking === false
              ? t(
                  'Codex asked for clarification. Submit your choices or skip this optional request.',
                )
              : t(
                  'Codex is waiting for your answers. Review each question before submitting.',
                )}{' '}
          {t('A suggested choice is not sent until you submit.')}
        </p>
      )}
      {questions.map((q, index) => (
        <fieldset className="question" key={q.id} disabled={disabled}>
          <legend>
            <small>
              {q.header || 'Question ' + (index + 1)} · {index + 1}/{questions.length}
            </small>
            {q.question}
          </legend>
          {!!q.options?.length && (
            <div
              className="question-choices"
              role="radiogroup"
              aria-label={t('Options for {question}', { question: q.question })}
            >
              {q.options.map((option) => (
                <label
                  key={option.label}
                  className={
                    'question-choice' +
                    (!Object.hasOwn(custom, q.id) && answers[q.id] === option.label
                      ? ' selected'
                      : '')
                  }
                >
                  <input
                    type="radio"
                    name={action.id + ':' + q.id}
                    checked={!Object.hasOwn(custom, q.id) && answers[q.id] === option.label}
                    value={option.label}
                    onChange={() => {
                      const next = { ...custom };
                      delete next[q.id];
                      setCustom(next);
                      setAnswers({ ...answers, [q.id]: option.label });
                    }}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    {option.description && <small>{option.description}</small>}
                  </span>
                </label>
              ))}
            </div>
          )}
          {(!q.options?.length || q.allowOther) && (
            <input
              type={q.secret ? 'password' : 'text'}
              autoComplete="off"
              aria-label={q.question}
              value={custom[q.id] ?? ''}
              maxLength={4000}
              onChange={(event) => {
                setCustom({ ...custom, [q.id]: event.target.value });
                setAnswers({ ...answers, [q.id]: event.target.value });
              }}
              placeholder={q.options?.length ? t('Or write your own answer') : t('Your answer')}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.nativeEvent.isComposing &&
                  complete &&
                  !disabled
                ) {
                  event.preventDefault();
                  void answer({ answers });
                }
              }}
            />
          )}
        </fieldset>
      ))}
      {error && (
        <p role="alert" className="error-text">
          {t(error)}
        </p>
      )}
      <div className="approval-actions">
        {action.kind === 'questions' ? (
          <>
            <button
              className="primary"
              disabled={disabled || !complete}
              onClick={() => void answer({ answers })}
            >
              {t('Submit answer')}
            </button>
            {action.blocking === false && (
              <button
                className="secondary"
                disabled={disabled}
                onClick={() => void answer({ decision: 'skip' })}
              >
                {t('Skip question')}
              </button>
            )}
            {!action.async && (
              <button
                className="secondary"
                disabled={disabled}
                onClick={() => {
                  if (sending.current) return;
                  sending.current = true;
                  setBusy(true);
                  void post('/threads/' + action.threadId + '/interrupt')
                    .catch((e) => setError(message(e)))
                    .finally(() => {
                      sending.current = false;
                      setBusy(false);
                    });
                }}
              >
                {t('Cancel task')}
              </button>
            )}
          </>
        ) : (
          action.decisions.map((decision) => (
            <button
              key={decision}
              className={decision === 'accept' ? 'primary' : 'secondary'}
              disabled={disabled}
              onClick={() => void answer({ decision })}
            >
              {decision === 'accept'
                ? t('Approve once')
                : decision === 'decline'
                  ? t('Decline')
                  : t('Cancel task')}
            </button>
          ))
        )}
        {action.status === 'responding' && <span role="status">{t('Waiting for Codex…')}</span>}
      </div>
    </section>
  );
}
