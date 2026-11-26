import type { FileBrowserResult } from '../shared/project-files';

export type FileCacheKind = 'directory' | 'preview';
const byteBudget = 2 * 1024 * 1024;
const maxEntriesPerKind = 8;
const maxPreviewLength = 64 * 1024;
const lifetime = 30_000;

interface Entry {
  projectId: string;
  kind: FileCacheKind;
  result: FileBrowserResult<unknown>;
  bytes: number;
  expiresAt: number;
}

/** One cache per signed-in tab. Only scoped directory listings and preview text. */
export class FilesReadCache {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private generation = 0;
  private bytes = 0;

  revision = () => this.generation;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  peek<T>(key: string) {
    const entry = this.entries.get(key);
    return entry && entry.expiresAt > Date.now()
      ? (entry.result as FileBrowserResult<T>)
      : undefined;
  }

  touch(key: string) {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
  }

  remember(
    key: string,
    projectId: string,
    kind: FileCacheKind,
    result: FileBrowserResult<unknown>,
  ) {
    this.forget(key);
    if (result.outsideScope) return;
    const value = result.value as { text?: string; entries?: unknown[] };
    if (
      kind === 'preview' &&
      (typeof value.text !== 'string' || value.text.length > maxPreviewLength)
    )
      return;
    const rows = Array.isArray(value) ? value.length : (value.entries?.length ?? 0);
    // Budget strings at two bytes per code unit and account for entry and row objects.
    const bytes = (key.length + JSON.stringify(value).length) * 2 + 256 + rows * 64;
    if (bytes > byteBudget) return;
    for (const [id, entry] of this.entries) if (entry.expiresAt <= Date.now()) this.forget(id);
    const sameKind = [...this.entries].filter(([, entry]) => entry.kind === kind);
    if (sameKind.length >= maxEntriesPerKind) this.forget(sameKind[0]![0]);
    while (this.bytes + bytes > byteBudget) this.forget(this.entries.keys().next().value!);
    this.entries.set(key, { projectId, kind, result, bytes, expiresAt: Date.now() + lifetime });
    this.bytes += bytes;
  }

  forget(key: string) {
    const entry = this.entries.get(key);
    if (entry) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }

  invalidate(projectId: string) {
    for (const [key, entry] of this.entries) if (entry.projectId === projectId) this.forget(key);
    this.generation++;
    for (const listener of this.listeners) listener();
  }
}
