import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  sameSettings,
  type Attachment,
  type Operation,
  type QueuePayload,
  type QueueState,
  type ReviewTarget,
  type Settings,
  type Thread,
} from '../shared/types';
import { ApiError, post, request } from './api';
import type { Preferences } from './browser-preferences';
import { save, saved } from './browser-storage';

const sameQueueDraft = (a: QueuePayload, b: QueuePayload) =>
  a.text === b.text &&
  sameSettings(a.settings, b.settings) &&
  JSON.stringify(a.attachments) === JSON.stringify(b.attachments);

interface MessageDeliveryOptions {
  auth: 'loading' | 'login' | 'ready';
  connection: string;
  projectId: string;
  threadId: string;
  thread: Thread | undefined;
  threadRef: RefObject<string>;
  loadingConversation: boolean;
  contextReady: boolean;
  directoryBlocked: boolean;
  uploadsPending: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setError: (text: string) => void;
  setThread: Dispatch<SetStateAction<Thread | undefined>>;
  notice: (error: unknown) => void;
  connectionFailure: (error: unknown) => void;
  reconnect: () => Promise<void> | undefined;
  onCreated: (thread: Thread) => void;
  returnToLatest: () => void;
  setFollowing: (following: boolean) => void;
  composer: {
    text: string;
    attachments: Attachment[];
    settings: Settings;
    hasInput: boolean;
    revision: RefObject<number>;
    latestText: RefObject<string>;
    clearAccepted: (threadId: string, revision: number, origin?: string) => void;
    restoreAttachments: (attachments: Attachment[]) => void;
  };
}

/** Owns durable browser receipts and the network lifecycle of message delivery. */
export function useMessageDelivery({
  auth,
  connection,
  projectId,
  threadId,
  thread,
  threadRef,
  loadingConversation,
  contextReady,
  directoryBlocked,
  uploadsPending,
  busy,
  setBusy,
  setError,
  setThread,
  notice,
  connectionFailure,
  reconnect,
  onCreated,
  returnToLatest,
  setFollowing,
  composer,
}: MessageDeliveryOptions) {
  const {
    text: draft,
    attachments,
    settings,
    hasInput,
    revision: draftRevision,
    latestText: draftValue,
    clearAccepted: clearAcceptedDraft,
    restoreAttachments: setAttachments,
  } = composer;
  const [steerReceipt, setSteerReceipt] = useState<{
    operationId: string;
    text: string;
    attachments?: Attachment[];
  }>();
  const [queueRequest, setQueueRequest] = useState<{
    operationId: string;
    payload: QueuePayload;
  }>();
  const [receipt, setReceipt] = useState('');
  const queueRevision = useRef(0);
  const queueRevisionAtRender = queueRevision.current;
  const restoreReceipts = () => {
    observeQueue();
    setReceipt(threadId ? saved(`codes.operation.${threadId}`) : '');
    try {
      const stored = saved('codes.queue-request.' + threadId);
      setQueueRequest(stored ? JSON.parse(stored) : undefined);
    } catch {
      setQueueRequest(undefined);
    }
    try {
      setSteerReceipt(JSON.parse(saved('codes.steer.' + threadId) || 'null') ?? undefined);
    } catch {
      setSteerReceipt(undefined);
    }
  };
  const clearSendReceipt = () => {
    save('codes.operation.' + threadId, '');
    setReceipt('');
  };
  const observeQueue = () => {
    queueRevision.current++;
  };
  const applyQueue = (queue: QueueState, revision = queueRevisionAtRender) => {
    setThread((current) =>
      current?.id === threadId && revision === queueRevision.current
        ? { ...current, queue }
        : current,
    );
  };
  useEffect(() => {
    if (
      auth !== 'ready' ||
      connection !== 'Connected' ||
      !receipt ||
      !thread ||
      thread.id !== threadId ||
      thread.pending
    )
      return;
    const controller = new AbortController();
    const id = threadId,
      operationId = receipt;
    void request<Operation>('/operations/' + operationId, {}, controller.signal)
      .then((operation) => {
        if (
          controller.signal.aborted ||
          threadRef.current !== id ||
          operation.threadId !== id ||
          !['completed', 'failed'].includes(operation.state)
        )
          return;
        if (saved('codes.operation.' + id) === operationId) save('codes.operation.' + id, '');
        setReceipt((current) => (current === operationId ? '' : current));
      })
      .catch((error) => {
        if (controller.signal.aborted || (error instanceof ApiError && error.code === 'NOT_FOUND'))
          return;
        connectionFailure(error);
      });
    return () => controller.abort();
  }, [auth, connection, receipt, threadId, thread?.id, thread?.pending?.id, thread?.state]);
  const enqueue = async () => {
    if (
      !threadId ||
      busy ||
      uploadsPending ||
      !!thread?.writerConflict ||
      !hasInput ||
      thread?.archived ||
      thread?.managementPending
    )
      return;
    setBusy(true);
    setError('');
    const version = draftRevision.current;
    const key = 'codes.queue-request.' + threadId;
    let payload = { text: draft, settings, attachments };
    let operationId = crypto.randomUUID();
    try {
      const previous = queueRequest ?? (saved(key) ? JSON.parse(saved(key)) : undefined);
      if (previous) {
        const record = previous;
        if (!sameQueueDraft(record.payload, payload))
          throw new Error('Check the pending queue receipt before changing this draft.');
        operationId = record.operationId;
        payload = record.payload;
      }
      save(key, JSON.stringify({ operationId, payload }));
      setQueueRequest({ operationId, payload });
      const before = queueRevision.current;
      const queue = await post<QueueState>('/threads/' + threadId + '/queue', {
        operationId,
        ...payload,
      });
      applyQueue(queue, before);
      save(key, '');
      setQueueRequest(undefined);
      clearAcceptedDraft(threadId, version);
    } catch (error) {
      notice(error);
      if (error instanceof ApiError && !error.uncertain) {
        save(key, '');
        setQueueRequest(undefined);
      }
    } finally {
      setBusy(false);
    }
  };
  const checkQueueReceipt = async () => {
    if (!queueRequest || !threadId || loadingConversation || busy) return;
    const version = draftRevision.current;
    const acceptedDraft = sameQueueDraft(
      { text: draft, settings, attachments },
      queueRequest.payload,
    );
    setBusy(true);
    setError('');
    try {
      await request('/threads/' + threadId + '/queue/' + queueRequest.operationId);
      const before = queueRevision.current;
      const queue = await request<QueueState>('/threads/' + threadId + '/queue');
      if (acceptedDraft) clearAcceptedDraft(threadId, version);
      save('codes.queue-request.' + threadId, '');
      setQueueRequest(undefined);
      applyQueue(queue, before);
    } catch (error) {
      notice(error);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (
      busy ||
      uploadsPending ||
      !!thread?.writerConflict ||
      queueRequest ||
      !hasInput ||
      !contextReady ||
      directoryBlocked ||
      loadingConversation ||
      connection !== 'Connected' ||
      thread?.archived ||
      thread?.managementPending
    )
      return;
    returnToLatest();
    setBusy(true);
    setError('');
    let id = threadId;
    const origin = threadId;
    const version = draftRevision.current;
    let operationId = '';
    try {
      if (!id) {
        const created = await post<Thread>(`/projects/${projectId}/threads`, settings);
        id = created.id;
        save(`codes.draft.${id}`, threadRef.current === origin ? draftValue.current : draft);
        onCreated(created);
      }
      operationId = crypto.randomUUID();
      save(`codes.operation.${id}`, operationId);
      setReceipt(operationId);
      const operation = await post<Operation>(`/threads/${id}/send`, {
        operationId,
        text: draft,
        settings,
        attachments,
      });
      if (operation.state === 'failed')
        throw new ApiError(operation.error ?? 'The operation failed.', 'OPERATION_FAILED');
      clearAcceptedDraft(id, version, origin);
      setFollowing(true);
      if (operation.state === 'completed') {
        save(`codes.operation.${id}`, '');
        setReceipt('');
      }
      if (threadId === id) void reconnect();
    } catch (e) {
      notice(e);
      if (
        version === draftRevision.current &&
        (threadRef.current === id || threadRef.current === origin)
      )
        setAttachments(attachments);
      if (id && e instanceof ApiError && !e.uncertain) {
        save(`codes.operation.${id}`, '');
        setReceipt('');
      }
    } finally {
      setBusy(false);
    }
  };
  const reconcile = async () => {
    const id = threadId;
    const operationId = receipt;
    if (!id) return;
    setBusy(true);
    try {
      if (operationId) {
        try {
          await request<Operation>(`/operations/${operationId}`);
        } catch (error) {
          if (error instanceof ApiError && error.code === 'NOT_FOUND') {
            if (saved(`codes.operation.${id}`) === operationId) save(`codes.operation.${id}`, '');
            if (threadRef.current === id) {
              setReceipt((current) => (current === operationId ? '' : current));
              setError('This request was not recorded. Your draft is safe; you may send it again.');
              void reconnect();
            }
            return;
          }
          throw error;
        }
      }
      const updated = await post<Thread>(`/threads/${id}/reconcile`);
      if (updated.id !== id)
        throw new ApiError(
          'The service returned a result for a different conversation.',
          'INVALID_RESPONSE',
        );
      if (!updated.pending && saved(`codes.operation.${id}`) === operationId)
        save(`codes.operation.${id}`, '');
      // A slow check belongs to its original conversation, not a newer selection.
      if (threadRef.current !== id) return;
      setThread(updated);
      void reconnect();
      if (!updated.pending) setReceipt((current) => (current === operationId ? '' : current));
      else
        setError(
          'The CLI has not confirmed a terminal result. This conversation remains locked against duplicate sends.',
        );
    } catch (error) {
      if (threadRef.current === id) notice(error);
    } finally {
      setBusy(false);
    }
  };

  const steer = async () => {
    if (!thread?.turnId || !hasInput || steerReceipt || queueRequest) return;
    const id = threadId;
    const text = draft;
    const version = draftRevision.current;
    const record = { operationId: crypto.randomUUID(), text, attachments };
    setBusy(true);
    setError('');
    save('codes.steer.' + id, JSON.stringify(record));
    setSteerReceipt(record);
    try {
      const result = await post<Operation>('/threads/' + id + '/steer', {
        operationId: record.operationId,
        text,
        expectedTurnId: thread.turnId,
        attachments,
      });
      if (result.state === 'unknown' || result.state === 'failed')
        throw new Error(result.error || 'Check the follow-up result.');
      save('codes.steer.' + id, '');
      clearAcceptedDraft(id, version);
      if (threadRef.current === id) setSteerReceipt(undefined);
    } catch (error) {
      notice(error);
      if (error instanceof ApiError && !error.uncertain) {
        save('codes.steer.' + id, '');
        if (threadRef.current === id) setSteerReceipt(undefined);
      }
    } finally {
      setBusy(false);
    }
  };
  const checkSteer = async () => {
    if (!steerReceipt || busy) return;
    const id = threadId;
    const record = steerReceipt;
    const key = 'codes.steer.' + id;
    const version = draftRevision.current;
    const readReceipt = async () => {
      const result = await request<Operation>('/operations/' + record.operationId);
      if (result.id !== record.operationId || result.threadId !== id || result.kind !== 'steer')
        throw new ApiError(
          'The service returned a result for a different conversation.',
          'INVALID_RESPONSE',
        );
      return result;
    };
    let recorded = false;
    setBusy(true);
    setError('');
    try {
      let result = await readReceipt();
      recorded = true;
      if (result.state === 'unknown' || result.state === 'dispatching') {
        await post<Thread>('/threads/' + id + '/reconcile');
        result = await readReceipt();
        if (result.state === 'unknown' || result.state === 'dispatching')
          throw new Error('Follow-up acceptance is still unconfirmed. It will not be resent.');
      }
      save(key, '');
      if (threadRef.current !== id) return;
      if (
        result.state !== 'failed' &&
        draft === record.text &&
        JSON.stringify(attachments) === JSON.stringify(record.attachments ?? [])
      )
        clearAcceptedDraft(id, version);
      setSteerReceipt(undefined);
      if (result.state === 'failed')
        setError(result.error || 'The follow-up was rejected. Your draft is safe.');
    } catch (error) {
      if (!recorded && error instanceof ApiError && error.code === 'NOT_FOUND') {
        save(key, '');
        if (threadRef.current === id) {
          setSteerReceipt(undefined);
          setError('The follow-up was not recorded. Your draft is safe.');
        }
      } else if (threadRef.current === id) notice(error);
    } finally {
      setBusy(false);
    }
  };
  const checkFollowUpStatus = async () => {
    if (!threadId || busy) return;
    const id = threadId;
    const previous = thread?.steering;
    setBusy(true);
    setError('');
    try {
      const updated = await post<Thread>('/threads/' + id + '/reconcile');
      if (updated.id !== id)
        throw new ApiError(
          'The service returned a result for a different conversation.',
          'INVALID_RESPONSE',
        );
      // A status check can finish after a newer event. Only refresh receipts it observed.
      setThread((current) =>
        current?.id === id && current.steering === previous
          ? { ...current, steering: updated.steering }
          : current,
      );
      if (threadRef.current === id && connection !== 'Connected') void reconnect();
    } catch (error) {
      if (threadRef.current === id) notice(error);
    } finally {
      setBusy(false);
    }
  };
  const startReview = async (target: ReviewTarget, delivery: Preferences['review']) => {
    if (!projectId || busy) throw new Error('Choose a project and wait for the current request.');
    let id = threadId;
    setBusy(true);
    try {
      if (delivery === 'detached' || !id) {
        const created = await post<Thread>(`/projects/${projectId}/threads`, {
          mode: 'default',
        });
        id = created.id;
        onCreated(created);
      }
      const operationId = crypto.randomUUID();
      save('codes.operation.' + id, operationId);
      setReceipt(operationId);
      try {
        const operation = await post<Operation>('/threads/' + id + '/review', {
          operationId,
          target,
          settings,
        });
        if (operation.state === 'failed')
          throw new ApiError(operation.error || 'Review failed.', 'OPERATION_FAILED');
        if (operation.state === 'completed') {
          save('codes.operation.' + id, '');
          setReceipt('');
        }
        if (threadId === id) void reconnect();
      } catch (error) {
        if (error instanceof ApiError && !error.uncertain) {
          save('codes.operation.' + id, '');
          setReceipt('');
          throw error;
        }
        notice(error); // Keep the receipt and close the dialog after an uncertain result.
      }
    } finally {
      setBusy(false);
    }
  };
  const stop = () => {
    setBusy(true);
    void post(`/threads/${threadId}/interrupt`)
      .catch(notice)
      .finally(() => setBusy(false));
  };
  return {
    receipt,
    queueRequest,
    steerReceipt,
    restoreReceipts,
    clearSendReceipt,
    observeQueue,
    applyQueue,
    send,
    enqueue,
    steer,
    checkQueueReceipt,
    reconcile,
    checkSteer,
    checkFollowUpStatus,
    startReview,
    stop,
  };
}
