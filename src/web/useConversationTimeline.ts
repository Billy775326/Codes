import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from 'react';
import type { Thread } from '../shared/types';
import type { ConversationView } from './conversation-view-cache';
import { ApiError, message, request } from './api';
import {
  earlierWindow,
  linkedToLatest,
  liveRevision,
  refreshHistory,
  type HistoryDirection,
  type HistoryPage,
  type HistoryWindow,
} from './history';

interface ReadingPosition {
  turnId: string;
  offset: number;
  cursor?: string;
}

const positionLimit = 100;
const positionCursorLimit = 512;
const positionKey = (threadId: string, projectId: string) => JSON.stringify([threadId, projectId]);
const turnsIn = (element: HTMLElement) =>
  Array.from(element.querySelectorAll<HTMLElement>('.turn'));

export function useConversationTimeline({
  auth,
  thread,
  preview,
  threadId,
  projectId,
  autoScroll,
  notice,
}: {
  auth: string;
  thread?: Thread;
  preview?: ConversationView;
  threadId: string;
  projectId: string;
  autoScroll: boolean;
  notice: (error: unknown) => void;
}) {
  const selection = useRef({ threadId, projectId });
  selection.current = { threadId, projectId };
  const transcript = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, ReadingPosition>());
  const restoringPosition = useRef<
    { key: string; value: ReadingPosition; requested: boolean } | undefined
  >(undefined);
  const historyAnchor = useRef<{ threadId: string; turnId?: string; offset: number } | undefined>(
    undefined,
  );
  const follow = useRef(true);
  const positionedConversation = useRef<string | undefined>(undefined);
  const historyRead = useRef<AbortController | undefined>(undefined);
  const scrollPosition = useRef(0);
  const touchPosition = useRef<number | undefined>(undefined);
  const restoringScroll = useRef(false);
  const [anchorRevision, setAnchorRevision] = useState(0);
  const automaticHistory = useRef(new Set<string>());
  const scrollDirection = useRef<HistoryDirection | undefined>(undefined);
  const [historyError, setHistoryError] = useState<{
    direction: HistoryDirection;
    message: string;
  }>();
  const [historyWindow, setHistoryWindow] = useState<HistoryWindow>();
  const latestWindow = useRef(historyWindow);
  latestWindow.current = historyWindow;
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [atLatest, setAtLatest] = useState(true);
  const history = historyWindow?.threadId === threadId ? historyWindow : undefined;
  const timelineLatest = !history || (!!thread && linkedToLatest(history, thread));
  const visibleMessages = useMemo(
    () =>
      thread
        ? history
          ? refreshHistory(history, thread)
          : thread.messages
        : (preview?.messages ?? []),
    [thread?.messages, history, preview],
  );
  const recentTurns = thread?.turns ?? preview?.turns;
  const visibleTurns = useMemo(
    () => [
      ...(history?.turns ?? []).filter(
        (turn) => !recentTurns?.some((latest) => latest.id === turn.id),
      ),
      ...(recentTurns ?? []),
    ],
    [history?.turns, recentTurns],
  );
  const reviewMessages = useMemo(() => {
    const latest = thread?.messages ?? [];
    if (!history) return latest;
    const liveIds = new Set(latest.map((item) => item.id));
    return [...visibleMessages.filter((item) => !liveIds.has(item.id)), ...latest];
  }, [visibleMessages, thread?.messages, history]);
  const resetTimeline = useCallback(() => {
    historyRead.current?.abort();
    historyRead.current = undefined;
    historyAnchor.current = undefined;
    restoringPosition.current = undefined;
    setLoadingHistory(false);
    setHistoryError(undefined);
    automaticHistory.current.clear();
    scrollDirection.current = undefined;
    setHistoryWindow(undefined);
    setAtLatest(true);
    follow.current = true;
  }, []);
  const returnToLatest = useCallback(() => {
    const { threadId, projectId } = selection.current;
    positions.current.delete(positionKey(threadId, projectId));
    resetTimeline();
    requestAnimationFrame(() => {
      if (follow.current && transcript.current) {
        transcript.current.scrollTop = transcript.current.scrollHeight;
        scrollPosition.current = transcript.current.scrollTop;
      }
    });
  }, [resetTimeline]);
  const switchConversation = useCallback(
    (nextThreadId: string, nextProjectId: string) => {
      const current = selection.current;
      const key = positionKey(current.threadId, current.projectId);
      const element = transcript.current;
      if (
        element &&
        current.threadId &&
        !restoringPosition.current &&
        positionedConversation.current === current.threadId
      ) {
        positions.current.delete(key);
        const top = element.getBoundingClientRect().top;
        const turn =
          !follow.current &&
          turnsIn(element).find((item) => item.getBoundingClientRect().bottom > top);
        const turnId = turn && turn.dataset.turnId;
        if (turnId) {
          const window = latestWindow.current;
          const cursor =
            window?.threadId === current.threadId
              ? window.pages.find((page) => page.messages.some((item) => item.turnId === turnId))
                  ?.sourceCursor
              : undefined;
          positions.current.set(key, {
            turnId,
            offset: turn.getBoundingClientRect().top - top,
            cursor: cursor && cursor.length <= positionCursorLimit ? cursor : undefined,
          });
          if (positions.current.size > positionLimit)
            positions.current.delete(positions.current.keys().next().value!);
        }
      }
      resetTimeline();
      const nextKey = positionKey(nextThreadId, nextProjectId);
      const saved = positions.current.get(nextKey);
      if (saved) {
        restoringPosition.current = { key: nextKey, value: saved, requested: false };
        follow.current = false;
        setAtLatest(false);
      }
    },
    [resetTimeline],
  );
  useEffect(() => {
    if (auth !== 'ready') {
      positions.current.clear();
      restoringPosition.current = undefined;
    }
  }, [auth]);
  useEffect(() => () => historyRead.current?.abort(), [threadId, projectId, auth]);
  useLayoutEffect(() => {
    const saved = restoringPosition.current;
    const element = transcript.current;
    if (!saved || !element || saved.key !== positionKey(threadId, projectId)) return;
    if ((thread?.id ?? preview?.id) !== threadId) return;
    const turn = turnsIn(element).find((item) => item.dataset.turnId === saved.value.turnId);
    if (!turn) return;
    restoringScroll.current = true;
    element.scrollTop +=
      turn.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.value.offset;
    scrollPosition.current = element.scrollTop;
    if (thread?.id === threadId) restoringPosition.current = undefined;
    requestAnimationFrame(() => {
      restoringScroll.current = false;
    });
  }, [visibleMessages, threadId, projectId, thread?.id, preview?.id]);
  useEffect(() => {
    const saved = restoringPosition.current;
    if (
      auth !== 'ready' ||
      !saved ||
      thread?.id !== threadId ||
      saved.requested ||
      saved.key !== positionKey(threadId, projectId)
    )
      return;
    const cursor = saved.value.cursor;
    if (!cursor) {
      returnToLatest();
      return;
    }
    saved.requested = true;
    const controller = new AbortController();
    historyRead.current = controller;
    setLoadingHistory(true);
    void request<HistoryPage>(
      `/threads/${threadId}/history?cursor=${encodeURIComponent(cursor)}`,
      {},
      controller.signal,
    )
      .then((page) => {
        if (controller.signal.aborted || restoringPosition.current !== saved) return;
        if (!page.messages.some((item) => item.turnId === saved.value.turnId)) {
          returnToLatest();
          return;
        }
        const readPage = { ...page, sourceCursor: cursor };
        setHistoryWindow({
          ...readPage,
          pages: [readPage],
          threadId,
          liveRevision: liveRevision(thread),
        });
      })
      .catch((error) => {
        if (controller.signal.aborted || restoringPosition.current !== saved) return;
        returnToLatest();
        if (error instanceof ApiError && error.status === 401) notice(error);
      })
      .finally(() => {
        if (historyRead.current === controller) {
          historyRead.current = undefined;
          setLoadingHistory(false);
        }
      });
  }, [auth, thread, threadId, projectId, returnToLatest, notice]);
  useLayoutEffect(() => {
    const anchor = historyAnchor.current;
    const element = transcript.current;
    if (anchor && element) {
      restoringScroll.current = true;
      if (anchor.threadId === threadId) {
        const turn = [...element.querySelectorAll<HTMLElement>('.turn')].find(
          (item) => item.dataset.turnId === anchor.turnId,
        );
        if (turn)
          element.scrollTop +=
            turn.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset;
        else element.scrollTop = 0;
      }
      scrollPosition.current = element.scrollTop;
      requestAnimationFrame(() => {
        restoringScroll.current = false;
        setAnchorRevision((value) => value + 1);
      });
      historyAnchor.current = undefined;
    }
  }, [visibleMessages, threadId]);
  useEffect(() => {
    const element = transcript.current;
    if (!timelineLatest || !element) return;
    const current = (thread?.id ?? preview?.id) === threadId ? threadId : undefined;
    const opened = current !== positionedConversation.current;
    positionedConversation.current = current;
    if (follow.current && (autoScroll || opened)) {
      element.scrollTop = element.scrollHeight;
    } else if (!autoScroll) {
      setAtLatest(element.scrollHeight - element.scrollTop - element.clientHeight < 100);
    }
  }, [
    visibleMessages,
    thread?.actions,
    thread?.state,
    thread?.id,
    preview?.id,
    threadId,
    timelineLatest,
    autoScroll,
  ]);
  const loadHistory = async (direction: HistoryDirection = 'older', automatic = false) => {
    const cursor =
      direction === 'older'
        ? history
          ? history.olderCursor
          : thread?.olderCursor
        : history?.newerCursor;
    const key = direction + ':' + cursor;
    if (
      !thread ||
      !cursor ||
      historyRead.current ||
      (automatic &&
        (historyError || automaticHistory.current.has(key) || automaticHistory.current.size >= 32))
    )
      return;
    if (automatic) automaticHistory.current.add(key);
    else {
      automaticHistory.current.clear();
      scrollDirection.current = undefined;
    }
    const id = thread.id;
    const project = projectId;
    const controller = new AbortController();
    historyRead.current = controller;
    setLoadingHistory(true);
    try {
      const page = await request<HistoryPage>(
        `/threads/${id}/history?cursor=${encodeURIComponent(cursor)}`,
        {},
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        selection.current.threadId !== id ||
        selection.current.projectId !== project
      )
        return;
      follow.current = false;
      setAtLatest(false);
      const element = transcript.current;
      if (element) {
        const top = element.getBoundingClientRect().top;
        const turn = [...element.querySelectorAll<HTMLElement>('.turn')].find(
          (item) => item.getBoundingClientRect().bottom > top,
        );
        historyAnchor.current = {
          threadId: id,
          turnId: turn?.dataset.turnId,
          offset: turn ? turn.getBoundingClientRect().top - top : 0,
        };
      }
      setHistoryError(undefined);
      setHistoryWindow((current) =>
        earlierWindow(thread, current, { ...page, sourceCursor: cursor }, direction),
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        setHistoryError({ direction, message: message(error) });
        if (error instanceof ApiError && error.status === 401) notice(error);
      }
    } finally {
      if (historyRead.current === controller) {
        historyRead.current = undefined;
        setLoadingHistory(false);
      }
    }
  };
  useEffect(() => {
    if (loadingHistory || historyError || !scrollDirection.current || restoringScroll.current)
      return;
    const element = transcript.current;
    const direction = scrollDirection.current;
    if (
      element &&
      (direction === 'older'
        ? element.scrollTop < 240
        : !timelineLatest && element.scrollHeight - element.scrollTop - element.clientHeight < 240)
    )
      void loadHistory(direction, true);
  }, [
    loadingHistory,
    history?.olderCursor,
    history?.newerCursor,
    timelineLatest,
    historyError,
    anchorRevision,
  ]);

  const setFollowing = useCallback((value: boolean) => {
    follow.current = value;
  }, []);
  const cancelPositionRestore = () => {
    if (!restoringPosition.current) return;
    restoringPosition.current = undefined;
    historyRead.current?.abort();
    historyRead.current = undefined;
    setLoadingHistory(false);
  };
  const timelineEvents: Pick<
    HTMLAttributes<HTMLDivElement>,
    'onPointerDown' | 'onTouchStart' | 'onTouchMove' | 'onKeyDown' | 'onWheel' | 'onScroll'
  > = {
    onPointerDown: (event) => {
      // Only a scrollbar drag begins scrolling. Clicking prose or a
      // disclosure must not turn programmatic focus scrolling into paging.
      if (
        event.target === event.currentTarget &&
        event.clientX >= event.currentTarget.getBoundingClientRect().right - 24
      ) {
        cancelPositionRestore();
        automaticHistory.current.clear();
        scrollDirection.current ??= 'older';
      }
    },
    onTouchStart: (event) => {
      cancelPositionRestore();
      touchPosition.current = event.touches[0]?.clientY;
      automaticHistory.current.clear();
    },
    onTouchMove: (event) => {
      const y = event.touches[0]?.clientY;
      if (y === undefined || touchPosition.current === undefined || y === touchPosition.current)
        return;
      const direction = y > touchPosition.current ? 'older' : 'newer';
      touchPosition.current = y;
      automaticHistory.current.clear();
      scrollDirection.current = direction;
      const element = event.currentTarget;
      const bottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      if (direction === 'newer' && timelineLatest && bottom < 100) {
        follow.current = true;
        setAtLatest(true);
      }
      if (direction === 'older' ? element.scrollTop < 240 : !timelineLatest && bottom < 240)
        void loadHistory(direction, true);
    },
    onKeyDown: (event) => {
      if (['ArrowUp', 'PageUp', 'Home', 'ArrowDown', 'PageDown', 'End'].includes(event.key)) {
        cancelPositionRestore();
        automaticHistory.current.clear();
        scrollDirection.current = ['ArrowUp', 'PageUp', 'Home'].includes(event.key)
          ? 'older'
          : 'newer';
      }
    },
    onWheel: (event) => {
      if (!event.deltaY) return;
      cancelPositionRestore();
      automaticHistory.current.clear();
      const direction = event.deltaY < 0 ? 'older' : 'newer';
      scrollDirection.current = direction;
      const element = event.currentTarget;
      if (
        direction === 'newer' &&
        timelineLatest &&
        element.scrollHeight - element.scrollTop - element.clientHeight < 100
      ) {
        follow.current = true;
        setAtLatest(true);
      }
      if (
        direction === 'older'
          ? element.scrollTop < 240
          : !timelineLatest && element.scrollHeight - element.scrollTop - element.clientHeight < 240
      )
        void loadHistory(direction, true);
    },
    onScroll: (e) => {
      const el = e.currentTarget;
      const delta = el.scrollTop - scrollPosition.current;
      scrollPosition.current = el.scrollTop;
      if (restoringScroll.current || restoringPosition.current) return;
      const nearBottom = timelineLatest && el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      follow.current = nearBottom;
      setAtLatest(nearBottom);
      if (delta && scrollDirection.current) {
        const direction = delta < 0 ? 'older' : 'newer';
        scrollDirection.current = direction;
        if (
          direction === 'older'
            ? el.scrollTop < 240
            : !timelineLatest && el.scrollHeight - el.scrollTop - el.clientHeight < 240
        )
          void loadHistory(direction, true);
      }
    },
  };
  return {
    transcript,
    history,
    timelineLatest,
    visibleMessages,
    visibleTurns,
    reviewMessages,
    setFollowing,
    returnToLatest,
    switchConversation,
    loadHistory,
    loadingHistory,
    historyError,
    atLatest,
    timelineEvents,
  };
}
