import { limits, type Message, type TurnInfo, type ImageAttachment } from '../shared/types.js';
import { record } from '../shared/errors.js';
import { parseQuestionReplies } from '../shared/question-replies.js';
import { fileChanges } from './file-changes.js';
const text = (value: unknown, maximum: number = limits.item) =>
  typeof value === 'string' ? value.slice(0, maximum) : '';
const finiteTime = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER / 1000;

/** Unknown native timing stays absent; never substitute browser load/arrival time. */
export function nativeTurn(raw: any): TurnInfo {
  return {
    id: raw.id,
    ...(typeof raw.status === 'string' ? { status: raw.status } : {}),
    ...(finiteTime(raw.startedAt) ? { startedAtMs: raw.startedAt * 1000 } : {}),
    ...(finiteTime(raw.completedAt) ? { completedAtMs: raw.completedAt * 1000 } : {}),
    ...(finiteTime(raw.durationMs) ? { durationMs: raw.durationMs } : {}),
  };
}
export function nativeMessage(
  raw: any,
  turnId: string,
  imageReference?: (path: string) => ImageAttachment | undefined,
  lifecycle?: 'inProgress' | 'completed',
): Message | undefined {
  if (!record(raw) || typeof raw.id !== 'string') return;
  if (raw.type === 'contextCompaction')
    return {
      id: raw.id,
      turnId,
      kind: 'compaction',
      text:
        lifecycle === 'inProgress'
          ? 'Compacting context…'
          : lifecycle === 'completed'
            ? 'Context compacted.'
            : 'Context compaction',
      ...(lifecycle ? { status: lifecycle } : {}),
    };
  if (raw.type === 'userMessage') {
    const content = Array.isArray(raw.content) ? raw.content : [];
    const nativeImages = content.filter(
      (entry: any) => entry?.type === 'image' || entry?.type === 'localImage',
    );
    const images = nativeImages
      .slice(0, 4)
      .map((entry: any) =>
        entry.type === 'localImage' && typeof entry.path === 'string'
          ? imageReference?.(entry.path)
          : undefined,
      )
      .filter((entry: ImageAttachment | undefined): entry is ImageAttachment => !!entry);
    const rawText = Array.isArray(raw.content)
      ? content.map((x: any) => text(x?.text)).join('\n')
      : text(raw.text);
    const answeredQuestions = parseQuestionReplies(rawText);
    return {
      id: raw.id,
      turnId,
      kind: answeredQuestions ? 'question' : 'user',
      text: answeredQuestions
        ? answeredQuestions
            .map(({ question, answer }) => `Question: ${question}\n\nAnswer: ${answer}`)
            .join('\n\n')
        : rawText,
      ...(answeredQuestions ? { answeredQuestions } : {}),
      clientId: typeof raw.clientId === 'string' ? raw.clientId : undefined,
      ...(images.length ? { images } : {}),
      ...(nativeImages.length > images.length
        ? { unavailableImages: nativeImages.length - images.length }
        : {}),
    };
  }
  if (raw.type === 'agentMessage') {
    const asyncQuestions =
      Array.isArray(raw.questions) &&
      raw.questions.length > 0 &&
      raw.questions.length <= 8 &&
      raw.questions.every(
        (question: unknown) =>
          record(question) && typeof question.title === 'string' && question.title.trim(),
      )
        ? raw.questions.map((question: { title: string; options?: unknown }, index: number) => ({
            id: JSON.stringify(['request_user_input_async', raw.id, index]),
            question: text(question.title, 4000),
            allowOther: true,
            options: Array.isArray(question.options)
              ? [
                  ...new Set(
                    question.options
                      .filter((value): value is string => typeof value === 'string')
                      .slice(0, 10)
                      .map((value) => text(value, 1000))
                      .filter(Boolean),
                  ),
                ].map((label) => ({ label }))
              : undefined,
          }))
        : undefined;
    return {
      id: raw.id,
      turnId,
      kind: 'assistant',
      text: text(raw.text),
      ...(asyncQuestions ? { asyncQuestions } : {}),
      ...(['commentary', 'partial_answer', 'final_answer'].includes(raw.phase)
        ? { phase: raw.phase }
        : {}),
    };
  }
  if (raw.type === 'commandExecution')
    return {
      id: raw.id,
      turnId,
      kind: 'command',
      text: text([text(raw.command), text(raw.aggregatedOutput)].filter(Boolean).join('\n\n')),
      status: text(raw.status),
      truncated:
        (typeof raw.aggregatedOutput === 'string' ? raw.aggregatedOutput.length : 0) +
          (typeof raw.command === 'string' ? raw.command.length : 0) >
        limits.item,
    };
  if (raw.type === 'fileChange') {
    const changes = fileChanges(raw.changes);
    return {
      id: raw.id,
      turnId,
      kind: 'change',
      text: text(changes.files.map((x) => `${x.path}\n${x.diff}`).join('\n\n')),
      status: text(raw.status),
      files: changes.files,
      truncated: changes.truncated,
    };
  }
  if (raw.type === 'enteredReviewMode' || raw.type === 'exitedReviewMode')
    return {
      id: raw.id,
      turnId,
      kind: 'notice',
      phase: raw.type === 'exitedReviewMode' ? 'final_answer' : 'commentary',
      text:
        text(raw.review) ||
        (raw.type === 'enteredReviewMode' ? 'Code review started.' : 'Code review finished.'),
    };
  if (['mcpToolCall', 'dynamicToolCall', 'webSearch'].includes(raw.type)) {
    const title =
      raw.type === 'webSearch'
        ? `Searched the web: ${text(raw.query, 256)}`
        : raw.type === 'mcpToolCall'
          ? `Used ${text(raw.appContext?.appName, 100) || text(raw.server, 100) || 'integration'}: ${text(raw.tool, 100)}`
          : `Used ${text(raw.namespace, 100) || 'tool'}: ${text(raw.tool, 100)}`;
    // Summarize activity without exposing arbitrary tool arguments or result payloads.
    return {
      id: raw.id,
      turnId,
      kind: 'tool',
      text: title,
      status:
        raw.type === 'dynamicToolCall' && raw.success === false
          ? 'failed'
          : text(raw.status) || undefined,
    };
  }
  if (raw.type === 'plan') return { id: raw.id, turnId, kind: 'assistant', text: text(raw.text) };
  return undefined;
}
