import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionCheck, System } from '../shared/types';
import { request } from './api';

export function useCodexConnection(
  connected: boolean,
  projectId: string,
  setSystem: (system: System) => void,
) {
  const [result, setResult] = useState<{ projectId: string; value: ConnectionCheck }>();
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [manual, setManual] = useState(0);
  const handledManual = useRef(0);
  const checkedAt = useRef(0);
  const invalidate = useCallback(() => setRevision((value) => value + 1), []);
  const retry = useCallback(() => setManual((value) => value + 1), []);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    const retry = handledManual.current !== manual;
    const check = async (force = false) => {
      setChecking(true);
      try {
        const value = await request<ConnectionCheck>(
          '/connection/codex' + (projectId ? '?projectId=' + encodeURIComponent(projectId) : ''),
          force ? { method: 'POST' } : {},
          controller.signal,
          25_000,
        );
        if (!controller.signal.aborted) {
          setCheckFailed(false);
          setResult({ projectId, value });
          setSystem(value.system);
          checkedAt.current = Date.now();
          handledManual.current = manual;
        }
      } catch {
        if (!controller.signal.aborted) {
          setCheckFailed(true);
          setResult(undefined);
          checkedAt.current = Date.now();
          handledManual.current = manual;
        }
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    };
    let pending = true;
    const run = (force = false) => {
      pending = true;
      void check(force).finally(() => {
        pending = false;
      });
    };
    const focus = () => {
      if (
        document.visibilityState === 'visible' &&
        !pending &&
        Date.now() - checkedAt.current >= 60_000
      )
        run();
    };
    run(retry);
    window.addEventListener('focus', focus);
    return () => {
      controller.abort();
      window.removeEventListener('focus', focus);
    };
  }, [connected, projectId, revision, manual, setSystem]);
  return {
    account: connected && result?.projectId === projectId ? result.value.account : undefined,
    checking: connected && checking,
    checkFailed: connected && checkFailed,
    invalidate,
    retry,
  };
}
