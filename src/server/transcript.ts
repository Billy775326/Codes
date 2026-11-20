import { limits, type Message, type TurnInfo, type ImageAttachment } from '../shared/types.js';
import { record } from '../shared/errors.js';
import { fileChanges } from './file-changes.js';
const text = (value: unknown, maximum: number = limits.item) =>
  typeof value === 'string' ? value.slice(0, maximum) : '';
const finiteTime = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER / 1000;

/** Covro stored answered questions as a text envelope, not a live native callback. */
function legacyAnswer(value: string): Message['answeredQuestions'] {
  const match =
    /^\s*<send_user_message_question_reply>([\s\S]*)<\/send_user_message_question_reply>\s*$/.exec(
      value,
    );
  if (!match || value.length > limits.item) return;
  try {
    const entries: unknown = JSON.parse(match[1]!);
    if (
      !Array.isArray(entries) ||
      !entries.length ||
      entries.length > 8 ||
      !entries.every(
        (entry) =>
          record(entry) && typeof entry.question === 'string' && typeof entry.answer === 'string',
      )
    )
      return;
    return entries.map(({ question, answer }) => ({ question, answer }));
  } catch {
    return;
  } // Ordinary text and malformed historical payloads stay readable.
}

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
    const answeredQuestions = legacyAnswer(rawText);
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
  if (raw.type === 'agentMessage')
    return {
      id: raw.id,
      turnId,
      kind: 'assistant',
      text: text(raw.text),
      ...(['commentary', 'partial_answer', 'final_answer'].includes(raw.phase)
        ? { phase: raw.phase }
        : {}),
    };
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
