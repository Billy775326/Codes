import type { KeyboardEvent } from 'react';
import type { Message } from '../shared/types';

export interface ComposerHistory {
  entries: readonly string[];
  index: number;
  draft: string;
}

function messageText(message: Message) {
  if (message.kind !== 'user' || message.truncated) return;
  // The native transcript appends materialized file attachments to the prompt.
  const context = message.text.search(
    /\n\n(?:File context \{"path":"[^\n]*","fromLine":\d+,"toLine":\d+\}|Uploaded file context \{"name":"[^\n]*"\}):\n/,
  );
  const text = context === -1 ? message.text : message.text.slice(0, context);
  if (text.length <= 50_000 && text.trim()) return text;
}

function canRecall(input: HTMLTextAreaElement) {
  if (input.selectionStart === 0) return true;
  if (input.value.includes('\n')) return false;
  // Preserve vertical navigation in soft-wrapped drafts too. The composer
  // autosizes and its minimum height is less than the height of two lines.
  const style = getComputedStyle(input);
  const twoLines =
    parseFloat(style.lineHeight) * 2 +
    parseFloat(style.paddingTop) +
    parseFloat(style.paddingBottom);
  return input.scrollHeight < twoLines;
}

export function recallComposerMessage(
  event: KeyboardEvent<HTMLTextAreaElement>,
  history: ComposerHistory | undefined,
  messages: () => readonly Message[],
): { text: string; history?: ComposerHistory } | undefined {
  const input = event.currentTarget;
  const older = event.key === 'ArrowUp';
  if (
    (!older && event.key !== 'ArrowDown') ||
    event.defaultPrevented ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    input.readOnly ||
    input.selectionStart !== input.selectionEnd
  )
    return;

  if (!history) {
    if (!older || !canRecall(input)) return;
    const entries: string[] = [];
    for (const message of messages()) {
      const text = messageText(message);
      if (text !== undefined && text !== entries.at(-1)) entries.push(text);
    }
    if (!entries.length) return;
    history = { entries, index: entries.length, draft: input.value };
  } else if (input.selectionStart !== input.value.length) {
    // A caret moved within a recalled multiline message can still move by line.
    return;
  }

  const index = Math.max(0, history.index + (older ? -1 : 1));
  return index === history.entries.length
    ? { text: history.draft }
    : { text: history.entries[index]!, history: { ...history, index } };
}
