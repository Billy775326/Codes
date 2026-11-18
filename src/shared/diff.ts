import type { FileChange } from './types.js';

/** Display-only parsing. Paths and patch text are never executed or applied. */
export interface DiffLine {
  kind: 'context' | 'addition' | 'deletion' | 'meta';
  text: string;
  oldLine?: number;
  newLine?: number;
}
export interface DiffFile {
  path: string;
  previousPath?: string;
  kind: 'add' | 'delete' | 'update';
  lines: DiffLine[];
  additions: number;
  deletions: number;
  truncated: boolean;
}
export const diffLimits = { characters: 128 * 1024, files: 100, lines: 8000, window: 200 };

function pathName(value: string, prefixed = true) {
  let path = (value.split('\t')[0] ?? value).slice(0, 4096);
  if (path.startsWith('"') && path.endsWith('"')) {
    // Git quotes UTF-8 bytes using octal escapes, as well as ordinary C escapes.
    const bytes: number[] = [];
    for (const part of path.slice(1, -1).match(/\\[0-7]{1,3}|\\.|[^\\]+/g) ?? []) {
      if (/^\\[0-7]/.test(part)) bytes.push(parseInt(part.slice(1), 8));
      else {
        const escaped: Record<string, string> = {
          '\\t': '\t',
          '\\n': '\n',
          '\\r': '\r',
          '\\"': '"',
          '\\\\': '\\',
        };
        for (const byte of new TextEncoder().encode(escaped[part] ?? part)) bytes.push(byte);
      }
    }
    path = new TextDecoder().decode(new Uint8Array(bytes));
  }
  return prefixed ? path.replace(/^[ab]\//, '') : path;
}

export function parseUnifiedDiff(input: string, fallbackPath = 'Patch'): DiffFile[] {
  const bounded = input.slice(0, diffLimits.characters);
  const source = bounded.split(/\r?\n/);
  if (source.at(-1) === '') source.pop();
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let oldLine = 0,
    newLine = 0,
    inHunk = false,
    rows = 0;
  const begin = (path: string) => {
    file = { path, kind: 'update', lines: [], additions: 0, deletions: 0, truncated: false };
    files.push(file);
    oldLine = newLine = 0;
    inHunk = false;
    return file;
  };
  for (const line of source) {
    if (!file && !line) continue;
    if (line.startsWith('diff --git ')) {
      if (files.length >= diffLimits.files) {
        if (file) file.truncated = true;
        break;
      }
      const match = /^diff --git ("(?:\\.|[^"])*"|a\/.*?) ("(?:\\.|[^"])*"|b\/.*)$/.exec(line);
      const current = begin(match ? pathName(match[2]!) : fallbackPath);
      if (match && pathName(match[1]!) !== current.path) current.previousPath = pathName(match[1]!);
      continue;
    }
    file ??= begin(fallbackPath);
    if (++rows > diffLimits.lines) {
      file.truncated = true;
      break;
    }
    if (!inHunk && line.startsWith('--- ')) {
      const old = pathName(line.slice(4));
      if (old === '/dev/null') file.kind = 'add';
      else file.previousPath = old;
      continue;
    }
    if (!inHunk && line.startsWith('+++ ')) {
      const next = pathName(line.slice(4));
      if (next === '/dev/null') {
        file.kind = 'delete';
        file.path = file.previousPath ?? file.path;
      } else file.path = next;
      continue;
    }
    if (line.startsWith('new file mode ')) {
      file.kind = 'add';
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      file.kind = 'delete';
      continue;
    }
    if (line.startsWith('rename from ')) {
      file.previousPath = pathName(line.slice(12), false);
      continue;
    }
    if (line.startsWith('rename to ')) {
      file.path = pathName(line.slice(10), false);
      continue;
    }
    if (/^(index |similarity index )/.test(line)) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk && Number.isSafeInteger(Number(hunk[1])) && Number.isSafeInteger(Number(hunk[2]))) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      file.lines.push({ kind: 'meta', text: line });
    } else if (inHunk && line.startsWith('+')) {
      file.additions++;
      file.lines.push({ kind: 'addition', text: line.slice(1), newLine: newLine++ });
    } else if (inHunk && line.startsWith('-')) {
      file.deletions++;
      file.lines.push({ kind: 'deletion', text: line.slice(1), oldLine: oldLine++ });
    } else if (inHunk && line.startsWith(' ')) {
      file.lines.push({
        kind: 'context',
        text: line.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    } else if (line) file.lines.push({ kind: 'meta', text: line });
  }
  if (input.length > bounded.length && file) file.truncated = true;
  return files;
}

/** Retain each native edit; concatenating or overwriting edits cannot prove a net diff. */
export function parseFileDiffs(files: FileChange[]): DiffFile[] {
  let characters = diffLimits.characters,
    rows = diffLimits.lines;
  const result = files.slice(0, diffLimits.files).map((file) => {
    const source = file.diff.slice(0, characters);
    characters -= source.length;
    const parsed = parseUnifiedDiff(source, file.movePath ?? file.path);
    const entry = parsed[0] ?? {
      path: file.path,
      kind: file.kind,
      lines: [],
      additions: 0,
      deletions: 0,
      truncated: false,
    };
    const visible = entry.lines.slice(0, rows);
    rows -= visible.length;
    return {
      ...entry,
      path: file.movePath ?? file.path,
      previousPath: file.movePath ? file.path : undefined,
      kind: file.kind,
      lines: visible,
      additions: visible.filter((line) => line.kind === 'addition').length,
      deletions: visible.filter((line) => line.kind === 'deletion').length,
      truncated:
        entry.truncated ||
        !!file.truncated ||
        source.length < file.diff.length ||
        parsed.length > 1 ||
        visible.length < entry.lines.length,
    };
  });
  if (files.length > result.length && result.length) result[result.length - 1]!.truncated = true;
  return result;
}
