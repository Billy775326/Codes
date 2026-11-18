import type { Message } from '../shared/types';

export type TranscriptEntry =
  | { kind: 'message'; key: string; item: Message }
  | { kind: 'commands'; key: string; items: Message[] };

/** Preserve native order: prose, file changes and turn boundaries end a command run. */
export function groupActivity(messages: readonly Message[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const item of messages) {
    const previous = entries.at(-1);
    if (item.kind !== 'command') entries.push({ kind: 'message', key: 'message:' + item.id, item });
    else if (previous?.kind === 'commands' && previous.items[0]!.turnId === item.turnId)
      previous.items.push(item);
    else
      entries.push({
        kind: 'commands',
        key: 'commands:' + item.turnId + ':' + item.id,
        items: [item],
      });
  }
  return entries;
}

export function commandCounts(items: readonly Message[]) {
  const counts = { running: 0, failed: 0, stopped: 0, completed: 0, unknown: 0 };
  for (const item of items) {
    if (['inProgress', 'running', 'pending'].includes(item.status ?? '')) counts.running++;
    else if (['failed', 'declined'].includes(item.status ?? '')) counts.failed++;
    else if (['interrupted', 'cancelled'].includes(item.status ?? '')) counts.stopped++;
    else if (item.status === 'completed') counts.completed++;
    else counts.unknown++;
  }
  return counts;
}
