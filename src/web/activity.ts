import type { Message, TurnInfo } from '../shared/types';
import { interfaceLanguages, type Translate } from './interface-language';

export interface TurnActivity {
  id: string;
  prompt?: Message;
  users: Message[];
  work: Message[];
  replies: Message[];
  changes?: Message;
  info?: TurnInfo;
  active: boolean;
}

/** Native turn identity owns one disclosure, even when prose separates tool calls. */
export function groupTurns(
  messages: readonly Message[],
  turns: readonly TurnInfo[] = [],
  activeIds: readonly string[] = [],
): TurnActivity[] {
  const grouped = new Map<string, Message[]>();
  for (const message of messages) {
    const id = message.turnId || `unscoped:${message.id}`;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id)!.push(message);
  }
  return [...grouped].map(([id, items]) => {
    const active = activeIds.includes(id);
    const assistants = items.filter(
      (item) =>
        item.kind === 'assistant' || (item.kind === 'notice' && item.phase === 'final_answer'),
    );
    const declared = assistants.some((item) => item.phase === 'final_answer');
    // Legacy providers do not consistently supply phases. Only infer a final reply
    // after completion, and never promote explicitly marked commentary.
    const legacy = !active && !declared ? assistants.at(-1) : undefined;
    const replies = assistants.filter(
      (item) =>
        item.phase === 'final_answer' ||
        item.phase === 'partial_answer' ||
        (item === legacy && !item.phase),
    );
    const replyIds = new Set(replies.map((item) => item.id));
    const changes = items.filter((item) => item.kind === 'change' && item.files?.length);
    const files = changes.flatMap((item) => item.files ?? []);
    return {
      id,
      active,
      info: turns.find((turn) => turn.id === id),
      prompt: items[0]?.kind === 'user' ? items[0] : undefined,
      users: items.filter((item) => item.kind === 'user'),
      work: items.filter(
        (item) => item.kind !== 'user' && !replyIds.has(item.id) && !changes.includes(item),
      ),
      replies,
      changes: files.length
        ? {
            id: `turn-changes:${id}`,
            turnId: id,
            kind: 'change',
            text: '',
            files: files.slice(0, 100),
            truncated: files.length > 100 || changes.some((item) => item.truncated),
          }
        : undefined,
    };
  });
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

export function workDuration(
  info?: TurnInfo,
  now?: number,
  t: Translate = interfaceLanguages.en.t,
): string | undefined {
  const elapsed =
    info?.durationMs ??
    (info?.startedAtMs !== undefined && (info.completedAtMs ?? now) !== undefined
      ? (info.completedAtMs ?? now)! - info.startedAtMs
      : undefined);
  if (elapsed === undefined || !Number.isFinite(elapsed) || elapsed < 0) return;
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes
    ? t('{minutes}m {seconds}s', { minutes, seconds: seconds % 60 })
    : t('{seconds}s', { seconds });
}
