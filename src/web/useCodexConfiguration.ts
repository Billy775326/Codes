import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  NativeConfigurationEdits,
  NativeConfigurationSnapshot,
} from '../shared/native-configuration';
import type { Model, System } from '../shared/types';
import { ApiError, request } from './api';

interface CodexConfigurationOptions {
  auth: 'loading' | 'login' | 'ready';
  connection: string;
  contextProjectId: string;
  setBusy(busy: boolean): void;
  setSystem(system: System): void;
  notice(error: unknown): void;
}

/** Reads effective settings for the verified project and writes through Codex. */
export function useCodexConfiguration({
  auth,
  connection,
  contextProjectId,
  setBusy,
  setSystem,
  notice,
}: CodexConfigurationOptions) {
  const [nativeDefaults, setNativeDefaults] = useState<{
    projectId: string;
    value: NativeConfigurationSnapshot;
  }>();
  const codexDefaults =
    nativeDefaults?.projectId === contextProjectId ? nativeDefaults.value : undefined;
  const [models, setModels] = useState<Model[]>([]);
  const [autoReviewReady, setAutoReviewReady] = useState(false);
  const configurationWrite = useRef(false);
  const [modes, setModes] = useState<{ mode?: 'default' | 'plan'; name: string }[]>([]);
  const [configurationRevision, setConfigurationRevision] = useState(0);
  const [catalogRevision, setCatalogRevision] = useState(0);

  const refreshConfiguration = useCallback(
    () => setConfigurationRevision((value) => value + 1),
    [],
  );
  const refreshCatalog = useCallback(() => setCatalogRevision((value) => value + 1), []);
  useEffect(() => {
    if (auth !== 'ready') return;
    window.addEventListener('focus', refreshConfiguration);
    return () => window.removeEventListener('focus', refreshConfiguration);
  }, [auth, refreshConfiguration]);
  useEffect(() => {
    if (auth !== 'ready' || !contextProjectId || connection !== 'Connected') return;
    const controller = new AbortController();
    void request<NativeConfigurationSnapshot>(
      '/projects/' + contextProjectId + '/codex-configuration',
      {},
      controller.signal,
    ).then(
      (value) => {
        if (!controller.signal.aborted) setNativeDefaults({ projectId: contextProjectId, value });
      },
      () => {
        if (!controller.signal.aborted)
          setNativeDefaults((current) =>
            current?.projectId === contextProjectId ? undefined : current,
          );
      },
    );
    return () => controller.abort();
  }, [auth, contextProjectId, connection, configurationRevision]);
  useEffect(() => {
    if (auth !== 'ready') {
      setModels([]);
      setModes([]);
      setAutoReviewReady(false);
      return;
    }
    const controller = new AbortController();
    void Promise.all([
      request<typeof modes>('/modes', {}, controller.signal),
      request<Model[]>('/models', {}, controller.signal),
      request<{ autoReview: boolean }>('/permissions', {}, controller.signal),
    ])
      .then(async ([modes, models, permissions]) => {
        if (controller.signal.aborted) return;
        setModes(modes);
        setModels(models);
        setAutoReviewReady(permissions.autoReview);
        setSystem(await request<System>('/system', {}, controller.signal));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        // The workspace connection status owns native startup diagnostics.
        if (
          error instanceof ApiError &&
          [
            'CLI_UNAVAILABLE',
            'CLI_PROTOCOL_UNSUPPORTED',
            'CLI_VERSION',
            'RUNTIME_OFFLINE',
          ].includes(error.code)
        )
          return;
        notice(error);
      });
    return () => controller.abort();
  }, [auth, catalogRevision]);
  async function saveComposerConfiguration(changes: NativeConfigurationEdits['changes']) {
    if (
      !contextProjectId ||
      !codexDefaults?.writable ||
      !codexDefaults.userVersion ||
      configurationWrite.current
    )
      return;
    const owner = contextProjectId;
    configurationWrite.current = true;
    setBusy(true);
    try {
      const value = await request<NativeConfigurationSnapshot>(
        '/projects/' + encodeURIComponent(owner) + '/codex-configuration',
        { method: 'PUT', body: JSON.stringify({ version: codexDefaults.userVersion, changes }) },
      );
      setNativeDefaults({ projectId: owner, value });
    } catch (error) {
      notice(error);
    } finally {
      configurationWrite.current = false;
      refreshConfiguration();
      setBusy(false);
    }
  }

  return {
    codexDefaults,
    models,
    planReady: modes.some((entry) => entry.mode === 'plan'),
    autoReviewReady,
    refreshConfiguration,
    refreshCatalog,
    saveComposerConfiguration,
  };
}
