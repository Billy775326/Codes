import { isAbsolute, resolve } from 'node:path';
import type { Driver } from '../codex/driver.js';
import { AppError, record } from '../shared/errors.js';
import type { ConversationSort, NativeConversationPage, Summary } from '../shared/types.js';

export interface ConversationFilters {
  cwd?: string;
  cursor?: string;
  search?: string;
  archived?: boolean;
  limit?: number;
  sort?: ConversationSort;
}

const secondsToMilliseconds = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value * 1000) : 0;

export function nativeConversation(value: unknown) {
  if (!record(value) || typeof value.id !== 'string' || !value.id || !validCwd(value.cwd)) return;
  const title = value.name || value.preview;
  return {
    id: value.id,
    cwd: value.cwd,
    title: typeof title === 'string' ? title.slice(0, 80) : '',
    status: value.status,
    updatedAt: secondsToMilliseconds(value.updatedAt),
    createdAt: secondsToMilliseconds(value.createdAt),
    forkedFromId: typeof value.forkedFromId === 'string' ? value.forkedFromId : undefined,
  };
}

type NativeConversation = NonNullable<ReturnType<typeof nativeConversation>>;

export function validCwd(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length <= 4096 &&
    !path.includes('\0') &&
    isAbsolute(path) &&
    resolve(path) === path
  );
}

function pageFromNative(value: unknown) {
  if (
    !record(value) ||
    !Array.isArray(value.data) ||
    (value.nextCursor != null && typeof value.nextCursor !== 'string')
  )
    throw new AppError('PROTOCOL_ERROR', 'Invalid conversation page.', 502);
  return { data: value.data as unknown[], nextCursor: (value.nextCursor as string | null) ?? null };
}

export class NativeConversationDirectory {
  constructor(
    private readonly driver: Driver,
    private readonly metadata: {
      revision: () => number;
      observe: (
        row: NativeConversation,
        archived: boolean,
        revision: number,
        projectId?: string,
      ) => Summary;
    },
  ) {}

  async list(
    options: ConversationFilters & { projectId?: string },
    signal?: AbortSignal,
  ): Promise<NativeConversationPage & { scanned: number }> {
    const { projectId, cwd } = options;
    if (cwd !== undefined && !validCwd(cwd))
      throw new AppError('INVALID_DIRECTORY', 'Enter an absolute path on the server.');
    const search = (options.search ?? '').trim().slice(0, 120);
    const archived = options.archived === true;
    const limit = Math.min(50, Math.max(1, options.limit ?? 30));
    const sort = options.sort ?? 'updated_at';
    const filters = JSON.stringify({ projectId, cwd, search, archived, sort });
    let cursor: string | undefined;
    if (options.cursor) {
      try {
        const value: unknown = JSON.parse(Buffer.from(options.cursor, 'base64url').toString());
        if (!record(value) || value.filters !== filters || typeof value.cursor !== 'string')
          throw new Error();
        cursor = value.cursor;
      } catch {
        throw new AppError(
          'LIST_CURSOR',
          'This conversation page no longer matches the current filters.',
        );
      }
    }
    signal?.throwIfAborted();
    await this.driver.start();
    signal?.throwIfAborted();
    if (sort === 'created_at' && !this.driver.supports('conversationSort'))
      throw new AppError(
        'CLI_FEATURE_UNAVAILABLE',
        'The installed Codex CLI cannot sort by creation time.',
        412,
      );
    const serverSearch = !projectId && this.driver.supports('conversationSearch');
    let scanned = 0;
    const seen = new Set(cursor ? [cursor] : []);
    const deadline = Date.now() + 20_000;
    for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
      const remaining = deadline - Date.now();
      signal?.throwIfAborted();
      if (remaining <= 0)
        throw new AppError('LIST_TIMEOUT', 'Conversation browsing timed out. Try again.', 504);
      const revision = this.metadata.revision();
      const page = pageFromNative(
        await this.driver.call(
          'thread/list',
          {
            cwd,
            cursor,
            limit,
            archived,
            sourceKinds: projectId ? ['cli', 'appServer', 'vscode'] : undefined,
            modelProviders: [],
            sortKey: this.driver.supports('conversationSort') ? sort : undefined,
            searchTerm: serverSearch && search ? search : undefined,
          },
          remaining,
        ),
      );
      signal?.throwIfAborted();
      const data: NativeConversationPage['data'] = [];
      const ids = new Set<string>();
      for (const value of page.data) {
        scanned++;
        const row = nativeConversation(value);
        if (!row || (cwd && row.cwd !== cwd) || ids.has(row.id)) continue;
        ids.add(row.id);
        const summary = this.metadata.observe(row, archived, revision, projectId);
        if (
          !!summary.archived === archived &&
          (serverSearch || summary.title.toLowerCase().includes(search.toLowerCase()))
        )
          data.push({ ...summary, cwd: row.cwd, createdAt: row.createdAt });
      }
      if (page.nextCursor && seen.has(page.nextCursor))
        throw new AppError('PROTOCOL_ERROR', 'The CLI repeated a conversation cursor.', 502);
      const nextCursor = page.nextCursor
        ? Buffer.from(JSON.stringify({ filters, cursor: page.nextCursor })).toString('base64url')
        : null;
      if (data.length || !nextCursor || pageNumber === 3) return { data, nextCursor, scanned };
      cursor = page.nextCursor!;
      seen.add(cursor);
    }
    throw new AppError('PROTOCOL_ERROR', 'Invalid conversation scan.', 502);
  }

  async archived(
    row: Pick<NativeConversation, 'id' | 'cwd'>,
    deadline: number,
    errorCode = 'THREAD_NOT_FOUND',
  ) {
    const exact = this.driver.supports('conversationIdFilter');
    const unavailable = () =>
      new AppError(
        errorCode,
        'Codex did not confirm this conversation in the active or archived list.',
        errorCode === 'THREAD_NOT_FOUND' ? 404 : 409,
      );
    for (const archived of [true, false]) {
      const seen = new Set<string>();
      let cursor: string | undefined;
      for (let pageNumber = 0; pageNumber < (exact ? 1 : 4); pageNumber++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw unavailable();
        const page = pageFromNative(
          await this.driver.call(
            'thread/list',
            {
              cwd: row.cwd,
              archived,
              cursor,
              limit: exact ? 1 : 50,
              includedThreadIds: exact ? [row.id] : undefined,
              modelProviders: [],
            },
            Math.min(remaining, 5000),
          ),
        );
        if (
          page.data.some((value) => record(value) && value.id === row.id && value.cwd === row.cwd)
        )
          return archived;
        if (!page.nextCursor) break;
        if (seen.has(page.nextCursor))
          throw new AppError('PROTOCOL_ERROR', 'The CLI repeated a conversation cursor.', 502);
        seen.add(page.nextCursor);
        cursor = page.nextCursor;
      }
    }
    throw unavailable();
  }
}
