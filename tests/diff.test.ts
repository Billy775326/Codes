import { expect, it } from 'vitest';
import { parseUnifiedDiff, parseFileDiffs, diffLimits } from '../src/shared/diff';
import { fileChanges } from '../src/server/file-changes';

it('groups native unified patches and counts changes without treating headers as edits', () => {
  const files = parseUnifiedDiff(
    'diff --git a/one.ts b/one.ts\n--- a/one.ts\n+++ b/one.ts\n@@ -3,2 +3,2 @@\n keep\n-old\n+new\ndiff --git a/two.ts b/two.ts\n--- /dev/null\n+++ b/two.ts\n@@ -0,0 +1 @@\n+hello\n',
  );
  expect(
    files.map(({ path, kind, additions, deletions }) => ({ path, kind, additions, deletions })),
  ).toEqual([
    { path: 'one.ts', kind: 'update', additions: 1, deletions: 1 },
    { path: 'two.ts', kind: 'add', additions: 1, deletions: 0 },
  ]);
  expect(files[0]!.lines).toContainEqual({ kind: 'context', text: 'keep', oldLine: 3, newLine: 3 });
  expect(files[0]!.lines).toContainEqual({ kind: 'deletion', text: 'old', oldLine: 4 });
  expect(files[0]!.lines).toContainEqual({ kind: 'addition', text: 'new', newLine: 4 });
});
it('keeps deleted files, quoted rename paths and Git octal UTF-8 paths readable', () => {
  const renamed = parseUnifiedDiff(
    'diff --git "a/old name" "b/new name"\nsimilarity index 100%\nrename from old name\nrename to new name\n',
  );
  expect(renamed[0]).toMatchObject({ path: 'new name', previousPath: 'old name' });
  const deleted = parseUnifiedDiff(
    'diff --git a/gone b/gone\ndeleted file mode 100644\n--- a/gone\n+++ /dev/null\n@@ -1 +0,0 @@\n-old',
  );
  expect(deleted[0]).toMatchObject({ path: 'gone', kind: 'delete', deletions: 1 });
  expect(
    parseUnifiedDiff(
      '--- "a/\\344\\275\\240.txt"\n+++ "b/\\344\\275\\240.txt"\n@@ -1 +1 @@\n-a\n+b',
    )[0]!.path,
  ).toBe('你.txt');
});
it('preserves header-like content inside a hunk, fallback patches and binary notices as text', () => {
  const file = parseUnifiedDiff('@@ -1 +1 @@\n--- not a header\n+++ not a header', 'a.ts')[0]!;
  expect(file).toMatchObject({ path: 'a.ts', additions: 1, deletions: 1 });
  expect(file.lines.at(-1)?.text).toBe('++ not a header');
  expect(
    parseUnifiedDiff('Binary files a/icon.png and b/icon.png differ')[0]!.lines[0]!.text,
  ).toContain('Binary files');
  expect(parseUnifiedDiff('')).toEqual([]);
});
it('bounds patch rows, file count and characters and exposes truncation', () => {
  expect(parseUnifiedDiff('\n\ndiff --git a/file b/file')[0]!.path).toBe('file');
  expect(parseUnifiedDiff('rename from a/original\nrename to b/renamed')[0]).toMatchObject({
    previousPath: 'a/original',
    path: 'b/renamed',
  });
  expect(
    parseUnifiedDiff('--- "a/' + 'x'.repeat(10000) + '"')[0]!.previousPath!.length,
  ).toBeLessThanOrEqual(4096);
  const rows = parseUnifiedDiff('@@ -0,0 +1,9000 @@\n' + '+x\n'.repeat(9000))[0]!;
  expect(rows.truncated).toBe(true);
  expect(rows.lines.length).toBeLessThanOrEqual(diffLimits.lines);
  const files = parseUnifiedDiff(
    Array.from({ length: 110 }, (_, i) => `diff --git a/f${i} b/f${i}\n@@ -0,0 +1 @@\n+x\n`).join(
      '',
    ),
  );
  expect(files).toHaveLength(diffLimits.files);
  expect(files.at(-1)!.truncated).toBe(true);
  expect(parseUnifiedDiff('x'.repeat(diffLimits.characters + 1))[0]!.truncated).toBe(true);
});
it('keeps structured native file kinds and moves under a shared item budget', () => {
  const parsed = fileChanges([
    { path: 'old.ts', kind: { type: 'update', movePath: 'new.ts' }, diff: 'x'.repeat(100000) },
    { path: 'extra.ts', kind: { type: 'add' }, diff: 'x'.repeat(100000) },
    { path: 'deleted.ts', kind: { type: 'delete' }, diff: '' },
    { path: 3, diff: 'invalid' },
  ]);
  expect(parsed.files[0]).toMatchObject({ path: 'old.ts', kind: 'update', movePath: 'new.ts' });
  expect(parsed.files[2]!.kind).toBe('delete');
  expect(parsed.files.reduce((size, file) => size + file.diff.length, 0)).toBe(
    diffLimits.characters,
  );
  expect(parsed.truncated).toBe(true);
  expect(parsed.files[1]!.truncated).toBe(true);
});
it('retains repeated native edits to the same file under one shared preview budget', () => {
  const files = parseFileDiffs([
    { path: 'same.ts', kind: 'update', diff: '@@ -1 +1 @@\n-first\n+second' },
    { path: 'same.ts', kind: 'update', diff: '@@ -1 +1 @@\n-second\n+third' },
    { path: 'large.ts', kind: 'add', diff: '@@ -0,0 +1,9000 @@\n' + '+x\n'.repeat(9000) },
  ]);
  expect(files.filter((file) => file.path === 'same.ts')).toHaveLength(2);
  expect(files[0]!.lines.at(-1)?.text).toBe('second');
  expect(files[1]!.lines.at(-1)?.text).toBe('third');
  expect(files.reduce((sum, file) => sum + file.lines.length, 0)).toBeLessThanOrEqual(
    diffLimits.lines,
  );
  expect(files[2]!.truncated).toBe(true);
});
