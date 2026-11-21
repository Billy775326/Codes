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

export function messagePreviewText(value: string) {
  const replies = parseQuestionReplies(value);
  if (!replies) return value;
  if (replies.length === 1) return 'Answer: ' + replies[0]!.answer;
  return 'Answers: ' + replies.map(({ answer }) => answer).join(' · ');
}
