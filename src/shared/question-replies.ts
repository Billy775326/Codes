import { record } from './errors.js';
import { limits, type Message } from './types.js';

const opening = '<send_user_message_question_reply>';
const closing = '</send_user_message_question_reply>';

export function encodeQuestionReplies(replies: NonNullable<Message['answeredQuestions']>) {
  return opening + JSON.stringify(replies) + closing;
}

export function parseQuestionReplies(value: string): Message['answeredQuestions'] {
  if (value.length > limits.item) return;
  const content = value.trim();
  if (!content.startsWith(opening) || !content.endsWith(closing)) return;
  try {
    const entries: unknown = JSON.parse(content.slice(opening.length, -closing.length));
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
    return entries.map(({ questionItemId, question, answer }) => ({
      ...(typeof questionItemId === 'string' && questionItemId.length <= 512
        ? { questionItemId }
        : {}),
      question,
      answer,
    }));
  } catch {
    return; // Malformed historical envelopes remain ordinary text.
  }
}

export function questionSourceItemId(id: string) {
  if (!id.startsWith('[')) return id;
  try {
    const value: unknown = JSON.parse(id);
    return Array.isArray(value) &&
      value.length === 3 &&
      value[0] === 'request_user_input_async' &&
      typeof value[1] === 'string' &&
      Number.isInteger(value[2]) &&
      value[2] >= 0 &&
      value[2] < 8
      ? value[1]
      : undefined;
  } catch {
    return undefined;
  }
}
