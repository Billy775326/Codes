import { useInterfaceLanguage } from './interface-language';
import { memo, useEffect, useRef, useMemo, useState } from 'react';
import {
  diffLimits,
  parseUnifiedDiff,
  parseFileDiffs,
  type DiffFile,
  type DiffLine,
} from '../shared/diff';
import type { FileChange } from '../shared/types';
import { Icon } from './primitives';
import './diff.css';

type Layout = 'unified' | 'split';
interface SplitLine {
  left?: DiffLine;
  right?: DiffLine;
  meta?: string;
}
function splitLines(lines: DiffLine[]): SplitLine[] {
  const result: SplitLine[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (line.kind === 'meta') {
      result.push({ meta: line.text });
      i++;
    } else if (line.kind === 'context') {
      result.push({ left: line, right: line });
      i++;
    } else {
      const removed: DiffLine[] = [],
        added: DiffLine[] = [];
      while (i < lines.length && ['addition', 'deletion'].includes(lines[i]!.kind)) {
        const next = lines[i++]!;
        (next.kind === 'addition' ? added : removed).push(next);
      }
      for (let j = 0; j < Math.max(removed.length, added.length); j++)
        result.push({ left: removed[j], right: added[j] });
    }
  }
  return result;
}

const FileDiff = memo(function FileDiff({
  file,
  layout,
  expanded,
  openFile,
  focused,
}: {
  file: DiffFile;
  layout: Layout;
  expanded: boolean;
  openFile?: (path: string) => void;
  focused?: boolean;
}) {
  const { t } = useInterfaceLanguage();
  const [open, setOpen] = useState(expanded);
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) {
      setOpen(true);
      element.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [focused]);
  const [page, setPage] = useState(0);
  const [viewed, setViewed] = useState('');
  const revision = useMemo(
    () => JSON.stringify([file.path, file.previousPath, file.kind, file.truncated, file.lines]),
    [file],
  );
  const rows = useMemo(
    () => (layout === 'split' && open ? splitLines(file.lines) : []),
    [file, layout, open],
  );
  const count = layout === 'split' ? rows.length : file.lines.length;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(count / diffLimits.window) - 1));
  const start = currentPage * diffLimits.window;
  return (
    <section
      ref={element}
      className={'diff-file' + (viewed === revision ? ' viewed' : '')}
      aria-label={t('Changes in {path}', { path: file.path })}
    >
      <div className="diff-file-heading">
        <button className="diff-file-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'review' : 'file'} size={14} />
          <span className="diff-file-path" title={file.path}>
            {file.path}
          </span>
          <small>
            {file.previousPath && file.previousPath !== file.path
              ? t('Renamed')
              : file.kind === 'add'
                ? t('Added')
                : file.kind === 'delete'
                  ? t('Deleted')
                  : t('Modified')}
          </small>
          <span className="diff-additions">+{file.additions}</span>
          <span className="diff-deletions">−{file.deletions}</span>
        </button>
        <button
          className="diff-viewed"
          aria-label={t('Mark {path} as viewed', { path: file.path })}
          aria-pressed={viewed === revision}
          onClick={() => setViewed(viewed === revision ? '' : revision)}
        >
          {viewed === revision ? t('Viewed') : t('Mark viewed')}
        </button>
      </div>
      {open && (
        <>
          {file.previousPath && file.previousPath !== file.path && (
            <p className="diff-rename">
              {file.previousPath} → {file.path}
            </p>
          )}
          <div className="diff-file-tools">
            <span>
              {layout === 'split' ? t('Before / After') : t('Before and after line numbers')}
            </span>
            {openFile && file.kind !== 'delete' && (
              <button onClick={() => openFile(file.path)}>{t('Open file')}</button>
            )}
          </div>
          {file.truncated && (
            <p className="diff-truncated" role="status">
              {t(
                'Patch preview is truncated. Counts describe the displayed portion; inspect the workspace for the complete change.',
              )}
            </p>
          )}
          <div
            className={'diff-table-scroll ' + layout}
            tabIndex={0}
            aria-label={t('Patch for {path}', { path: file.path })}
          >
            <table className="diff-table">
              <colgroup>
                <col className="diff-line-gutter" />
                {layout === 'split' && <col />}
                <col className="diff-line-gutter" />
                <col />
              </colgroup>
              <tbody>
                {layout === 'unified'
                  ? file.lines.slice(start, start + diffLimits.window).map((line, i) => (
                      <tr key={start + i} className={line.kind}>
                        <td className="line-number">{line.oldLine ?? ''}</td>
                        <td className="line-number">{line.newLine ?? ''}</td>
                        <td className="diff-code">
                          <code>
                            <span aria-hidden="true">
                              {line.kind === 'addition'
                                ? '+'
                                : line.kind === 'deletion'
                                  ? '−'
                                  : ' '}
                            </span>
                            {line.text || ' '}
                          </code>
                        </td>
                      </tr>
                    ))
                  : rows.slice(start, start + diffLimits.window).map((row, i) =>
                      row.meta !== undefined ? (
                        <tr className="meta" key={start + i}>
                          <td colSpan={4}>
                            <code>{row.meta}</code>
                          </td>
                        </tr>
                      ) : (
                        <tr key={start + i}>
                          <td className={'line-number ' + (row.left?.kind ?? '')}>
                            {row.left?.oldLine ?? ''}
                          </td>
                          <td className={'diff-code ' + (row.left?.kind ?? 'empty')}>
                            <code>{row.left?.text || ' '}</code>
                          </td>
                          <td className={'line-number ' + (row.right?.kind ?? '')}>
                            {row.right?.newLine ?? ''}
                          </td>
                          <td className={'diff-code ' + (row.right?.kind ?? 'empty')}>
                            <code>{row.right?.text || ' '}</code>
                          </td>
                        </tr>
                      ),
                    )}
                {!count && (
                  <tr>
                    <td colSpan={layout === 'split' ? 4 : 3} className="diff-no-lines">
                      {t('No patch lines are available in this preview.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {count > diffLimits.window && (
            <div className="diff-pagination">
              <button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
                {t('Previous patch lines')}
              </button>
              <span>
                {t('{start}–{end} of {total} rows', {
                  start: start + 1,
                  end: Math.min(start + diffLimits.window, count),
                  total: count,
                })}
              </span>
              <button
                disabled={start + diffLimits.window >= count}
                onClick={() => setPage(currentPage + 1)}
              >
                {t('Next patch lines')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
});

export const DiffView = memo(function DiffView({
  patch,
  files,
  truncated,
  title = 'File changes',
  openFile,
  focusPath,
}: {
  patch?: string;
  files?: FileChange[];
  truncated?: boolean;
  title?: string;
  openFile?: (path: string) => void;
  focusPath?: string;
}) {
  const { t } = useInterfaceLanguage();
  const [layout, setLayout] = useState<Layout>('unified');
  const entries = useMemo(
    () => (files?.length ? parseFileDiffs(files) : parseUnifiedDiff(patch ?? '')),
    [patch, files],
  );
  const fileCount = new Set(entries.map((file) => file.path)).size;
  const totals = useMemo(
    () =>
      entries.reduce(
        (sum, file) => ({ add: sum.add + file.additions, del: sum.del + file.deletions }),
        { add: 0, del: 0 },
      ),
    [entries],
  );
  return (
    <section className="diff-view" aria-label={t(title)}>
      <div className="diff-overview">
        <strong>
          {t(fileCount === 1 ? '{count} file' : '{count} files', { count: fileCount })}
          {entries.length > fileCount && <> · {t('{count} edits', { count: entries.length })}</>}
        </strong>
        <span className="diff-additions">+{totals.add}</span>
        <span className="diff-deletions">−{totals.del}</span>
        <div role="group" aria-label={t('Diff layout')}>
          <button aria-pressed={layout === 'unified'} onClick={() => setLayout('unified')}>
            {t('Unified')}
          </button>
          <button aria-pressed={layout === 'split'} onClick={() => setLayout('split')}>
            {t('Side by side')}
          </button>
        </div>
      </div>
      {(truncated || entries.some((file) => file.truncated)) && (
        <p className="diff-truncated" role="status">
          {t('This change preview is incomplete. Inspect the workspace for the full patch.')}
        </p>
      )}
      {entries.length > fileCount && (
        <p className="diff-rename">
          {t(
            'Native edit sequence. Each patch is relative to the preceding edit; counts are not a net working-tree diff.',
          )}
        </p>
      )}
      {entries.map((file, index) => (
        <FileDiff
          key={file.path + ':' + index}
          file={file}
          layout={layout}
          expanded={index === 0}
          openFile={openFile}
          focused={!!focusPath && (file.path === focusPath || file.path.endsWith('/' + focusPath))}
        />
      ))}
      {!entries.length && <p className="diff-no-lines">{t('No file changes were reported.')}</p>}
    </section>
  );
});
