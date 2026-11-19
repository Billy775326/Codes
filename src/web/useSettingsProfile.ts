import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sameSettings, type Settings, type SettingsProfile } from '../shared/types';
import { ApiError, request } from './api';
import { settingsProfileSchema } from '../shared/settings';

const readProfile = async (path: string, init = {}, signal?: AbortSignal) =>
  settingsProfileSchema.parse(await request<SettingsProfile>(path, init, signal));

interface Owner {
  path?: string;
  saved?: SettingsProfile;
  wanted?: Settings;
  queued?: Settings;
  observed?: SettingsProfile;
  loading: boolean;
  saving: boolean;
  error: string;
  conflict: boolean;
}
/** Preferences have idempotent writes and revisions, independently of task receipts. */
export function useSettingsProfile(path?: string) {
  const cache = useRef(new Map<string, Owner>());
  const owner = useMemo(() => {
    if (path && cache.current.has(path)) return cache.current.get(path)!;
    const value: Owner = { path, loading: !!path, saving: false, error: '', conflict: false };
    if (path) {
      cache.current.set(path, value);
      for (const [key, item] of cache.current) {
        if (cache.current.size <= 20) break;
        if (key !== path && !item.saving) cache.current.delete(key);
      }
    }
    return value;
  }, [path]);
  const current = useRef(owner);
  current.current = owner;
  const [state, setState] = useState({ owner, ...owner });
  const publish = useCallback(() => {
    if (current.current === owner) setState({ owner, ...owner });
  }, [owner]);
  const accept = useCallback(
    (value: SettingsProfile, preserveDraft = false) => {
      if (owner.saved && value.revision < owner.saved.revision) return;
      owner.saved = value;
      if (!preserveDraft) owner.wanted = undefined;
      owner.error = '';
      owner.conflict = false;
      publish();
    },
    [owner, publish],
  );
  const sync = useCallback(
    (value?: SettingsProfile) => {
      if (!value) return;
      if (owner.saving) {
        if (!owner.observed || value.revision > owner.observed.revision) owner.observed = value;
        return;
      }
      if (owner.wanted && !sameSettings(owner.wanted, value.settings)) return;
      accept(value);
    },
    [owner, accept],
  );
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!owner.path) return;
      owner.loading = !owner.saved;
      publish();
      try {
        sync(await readProfile(owner.path, {}, signal));
      } catch {
        if (!signal?.aborted) {
          owner.error = 'Unable to load saved settings.';
          publish();
        }
      } finally {
        if (!signal?.aborted) {
          owner.loading = false;
          publish();
        }
      }
    },
    [owner, sync, publish],
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  const save = useCallback(
    async function persist(next: Settings, base: SettingsProfile): Promise<void> {
      if (!owner.path || owner.saving) return;
      owner.wanted = next;
      owner.saving = true;
      owner.error = '';
      publish();
      try {
        const value = await readProfile(owner.path, {
          method: 'PUT',
          body: JSON.stringify({ revision: base.revision, settings: next }),
        });
        accept(value, !!owner.queued);
      } catch (error) {
        // A lost preference response is resolved by reading, never by resending a task.
        let confirmed = false;
        try {
          const value = await readProfile(owner.path);
          if (sameSettings(value.settings, next)) {
            accept(value, !!owner.queued);
            confirmed = true;
          } else owner.saved = value;
        } catch {
          /* Keep the requested choice available for an explicit retry. */
        }
        if (!confirmed) {
          owner.conflict = error instanceof ApiError && error.code === 'SETTINGS_CONFLICT';
          owner.error = owner.conflict
            ? 'Settings changed in another window. Reload saved settings.'
            : 'Settings were not saved. Retry before sending.';
        }
      } finally {
        owner.saving = false;
        const queued = owner.queued;
        owner.queued = undefined;
        const observed = owner.observed;
        owner.observed = undefined;
        if (queued && owner.saved) void persist(queued, owner.saved);
        else {
          if (!owner.error && observed && observed.revision > (owner.saved?.revision ?? -1))
            accept(observed);
          publish();
        }
      }
    },
    [owner, accept, publish],
  );
  const change = useCallback(
    (next: Settings) => {
      if (!owner.saved || owner.loading) return;
      if (owner.saving) {
        owner.queued = next;
        owner.wanted = next;
        publish();
      } else void save(next, owner.saved);
    },
    [owner, save, publish],
  );
  const retry = useCallback(async () => {
    if (!owner.path || owner.saving || owner.loading) return;
    if (owner.conflict || !owner.wanted) {
      owner.wanted = undefined;
      await refresh();
      return;
    }
    const wanted = owner.wanted;
    owner.loading = true;
    publish();
    try {
      const base = await readProfile(owner.path);
      owner.loading = false;
      await save(wanted, base);
    } catch {
      owner.error = 'Unable to load saved settings.';
    } finally {
      owner.loading = false;
      publish();
    }
  }, [owner, refresh, save, publish]);
  const view = state.owner === owner ? state : owner;
  return {
    saved: view.saved,
    value: view.saved
      ? { revision: view.saved.revision, settings: view.wanted ?? view.saved.settings }
      : undefined,
    loading: view.loading,
    saving: view.saving,
    error: view.error,
    conflict: view.conflict,
    change,
    sync,
    retry,
    refresh,
  };
}
