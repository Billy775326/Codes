import type { Driver } from '../codex/driver.js';
import { AppError, record } from '../shared/errors.js';
import { activeTurn } from '../shared/conversation-activity.js';
import { limits, type Message, type State, type TurnInfo } from '../shared/types.js';
import type { Images } from './images.js';
import { readPhase } from './read-diagnostics.js';
import { nativeThreadState, terminal } from './native-thread-status.js';
import { nativeMessage as item, nativeTurn } from './transcript.js';

const nativeHistoryItemPageSize = 1;
const nativeHistoryItemLimit = 2000;

export async function readConversationHistory(
  driver: Driver,
  id: string,
  cwd: string,
  continuation: string | undefined,
  signal: AbortSignal,
  imageReference: (path: string) => ReturnType<Images['transcriptReference']>,
  native?: unknown,
) {
  const deadline = Date.now() + 25_000;
  const call = async (method: string, params: unknown) => {
    signal.throwIfAborted();
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new AppError('HISTORY_TIMEOUT', 'History loading timed out. Try again.', 504);
    const startedAt = performance.now();
    try {
      const result = await driver.call(method, params, remaining);
      signal.throwIfAborted();
      return result;
    } finally {
      readPhase(method, startedAt);
    }
  };
  let cursor: string | undefined;
  let direction: 'older' | 'newer' = 'older';
  if (continuation) {
    try {
      const decoded = JSON.parse(Buffer.from(continuation, 'base64url').toString());
      if (decoded.id !== id || typeof decoded.cursor !== 'string') throw new Error();
      if (decoded.direction !== undefined && !['older', 'newer'].includes(decoded.direction))
        throw new Error();
      direction = decoded.direction ?? 'older';
      cursor = decoded.cursor || undefined;
    } catch {
      throw new AppError('HISTORY_CURSOR', 'Invalid history cursor.');
    }
  }
  const thread =
    native ?? (await call('thread/read', { threadId: id, includeTurns: false })).thread;
  if (!record(thread) || thread.id !== id || thread.cwd !== cwd)
    throw new AppError(
      'PROJECT_OWNERSHIP',
      'The conversation no longer belongs to this project.',
      403,
    );
  const hydrate = async (turns: any[]): Promise<Message[] | undefined> => {
    const messages: Message[] = [];
    let messageBytes = 0;
    const append = (entry: any, turn: any) => {
      const mapped = item(
        entry.item,
        turn.id,
        imageReference,
        Number.isFinite(entry.completedAtMs) && entry.completedAtMs >= 0
          ? 'completed'
          : Number.isFinite(entry.startedAtMs) &&
              entry.startedAtMs >= 0 &&
              turn.status === 'inProgress'
            ? 'inProgress'
            : undefined,
      );
      if (!mapped) return true;
      messageBytes += Buffer.byteLength(mapped.text);
      // A smaller turn page may fit. Discard this attempted page rather than
      // truncating its items or returning a cursor that skips unread history.
      if (messages.length >= 240 || messageBytes > 2 * 1024 * 1024) return false;
      messages.push(mapped);
      return true;
    };
    for (const turn of turns) {
      if (typeof turn.id !== 'string')
        throw new AppError('PROTOCOL_ERROR', 'Invalid turn identity.', 502);
      if (turn.itemsView === 'full') {
        if (!Array.isArray(turn.items))
          throw new AppError('PROTOCOL_ERROR', 'Invalid full turn history.', 502);
        for (const value of turn.items) if (!append({ item: value }, turn)) return;
        continue;
      }
      let next: string | undefined;
      const seen = new Set<string>();
      do {
        const items = await call('thread/items/list', {
          threadId: id,
          turnId: turn.id,
          cursor: next,
          limit: nativeHistoryItemPageSize,
          sortDirection: 'asc',
        });
        if (!Array.isArray(items.data))
          throw new AppError('PROTOCOL_ERROR', 'Invalid item history.', 502);
        for (const entry of items.data) if (!append(entry, turn)) return;
        next = items.nextCursor ?? undefined;
        if (
          next &&
          (seen.has(next) || seen.size >= nativeHistoryItemLimit / nativeHistoryItemPageSize)
        )
          throw new AppError(
            'HISTORY_LIMIT',
            'History pagination exceeded the supported limit.',
            502,
          );
        if (next) seen.add(next);
      } while (next);
    }
    return messages;
  };
  // Legacy stores expose turn pages with full items, but no item-pagination endpoint.
  // Start with one turn so old transcripts cannot create an eager multi-turn payload.
  const legacy = thread.historyMode === 'legacy' || !driver.supports('itemHistory');
  let pageLimit: number = legacy ? 1 : limits.page;
  for (;;) {
    let page;
    try {
      page = await call('thread/turns/list', {
        threadId: id,
        cursor,
        limit: pageLimit,
        sortDirection: direction === 'newer' ? 'asc' : 'desc',
        itemsView: legacy ? 'full' : 'notLoaded',
      });
    } catch (error) {
      // Some native threads materialize on their first turn.
      if (
        !continuation &&
        error instanceof AppError &&
        error.code === 'CLI_ERROR' &&
        error.message.includes(
          'is not materialized yet; thread/turns/list is unavailable before first user message',
        )
      )
        return {
          messages: [] as Message[],
          olderCursor: null,
          newerCursor: null,
          hasNewer: false,
          state: 'idle' as State,
          turns: [] as TurnInfo[],
          interruptedTurns: [] as string[],
        };
      throw error;
    }
    if (!Array.isArray(page.data))
      throw new AppError('PROTOCOL_ERROR', 'Invalid conversation history.', 502);
    for (const value of [page.nextCursor, page.backwardsCursor])
      if (value != null && typeof value !== 'string')
        throw new AppError('PROTOCOL_ERROR', 'Invalid history continuation.', 502);
    const turns: any[] = direction === 'newer' ? page.data.slice() : page.data.slice().reverse();
    const messages = await hydrate(turns);
    if (messages) {
      const latest = turns.at(-1);
      const current = nativeThreadState(thread.status);
      return {
        messages,
        olderCursor: historyCursor(
          id,
          direction === 'older' ? page.nextCursor : page.backwardsCursor,
          'older',
        ),
        // Keep a resumable forward edge even at the live end, so a reader can
        // catch up after the bounded live cache has moved beyond this page.
        newerCursor: historyCursor(
          id,
          direction === 'newer' ? (page.nextCursor ?? cursor) : page.backwardsCursor,
          'newer',
        ),
        hasNewer: direction === 'newer' ? !!page.nextCursor : !!cursor && !!page.backwardsCursor,
        state: (activeTurn(current)
          ? current
          : terminal(latest?.status)
            ? latest.status
            : latest?.status === 'inProgress'
              ? 'unknown'
              : 'idle') as State,
        turns: turns.map(nativeTurn) as TurnInfo[],
        interruptedTurns: turns
          .filter((turn) => turn.status === 'failed' || turn.status === 'interrupted')
          .map((turn) => turn.id) as string[],
      };
    }
    if (pageLimit === 1 || turns.length <= 1)
      throw new AppError(
        'HISTORY_LIMIT',
        'This turn exceeds the display limit. Use the CLI to inspect this conversation.',
        413,
      );
    // Re-read from the same native cursor. The successful, smaller page supplies
    // its own next cursor, keeping older turns reachable without duplicates.
    pageLimit = Math.max(1, Math.min(Math.floor(pageLimit / 2), turns.length - 1));
  }
}
function historyCursor(id: string, cursor: unknown, direction: 'older' | 'newer') {
  return typeof cursor === 'string' && cursor
    ? Buffer.from(JSON.stringify({ id, cursor, direction })).toString('base64url')
    : null;
}
