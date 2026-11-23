import { useInterfaceLanguage } from './interface-language';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { projectImageType } from '../shared/images';
import { hasHiddenPathSegment } from '../shared/project-files';
import type { FileContent } from '../shared/types';
import { message, request } from './api';
import { HtmlPreview, ProjectImagePreview } from './ContentPreview';
import { Icon, IconButton } from './primitives';
import './files-panel.css';

interface Entry {
  name: string;
  path: string;
  directory: boolean;
}

type ReadResult<T> = { url: string; value: T } | { url: string; error: string };

function useRead<T>(url: string | undefined) {
  const [result, setResult] = useState<ReadResult<T>>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    void request<T>(url, {}, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setResult({ url, value });
      },
      (error) => {
        if (!controller.signal.aborted) setResult({ url, error: message(error) });
      },
    );
    return () => controller.abort();
  }, [url, attempt]);
  return {
    result: result?.url === url ? result : undefined,
    reload() {
      setResult(undefined);
      setAttempt((value) => value + 1);
    },
  };
}

function ReadError({ error, retry }: { error: string; retry: () => void }) {
  const { t } = useInterfaceLanguage();
  return (
    <div className="file-state" role="alert">
      <span>{t(error)}</span>
      <button onClick={retry}>{t('Retry')}</button>
    </div>
  );
}

const linesPerPage = 200;

interface AttachmentControls {
  onAttach: (file: FileContent, from: number, to: number) => void;
  attachmentBlocked: boolean;
}

function TextPreview({
  file,
  onAttach,
  attachmentBlocked,
}: AttachmentControls & { file: FileContent }) {
  const { t } = useInterfaceLanguage();
  const [page, setPage] = useState(0);
  const [range, setRange] = useState<[number, number]>();
  const [choosingRange, setChoosingRange] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const lines = useMemo(() => file.text.split('\n'), [file.text]);
  const offset = page * linesPerPage;
  const visible = lines.slice(offset, offset + linesPerPage);
  const first = Number(start);
  const last = Number(end);
  const validRange =
    Number.isInteger(first) &&
    Number.isInteger(last) &&
    first >= 1 &&
    first <= last &&
    last <= file.lines;
  const selected = choosingRange ? (validRange ? [first, last] : undefined) : range;
  const from = selected ? Math.min(...selected) : 0;
  const to = selected ? Math.max(...selected) : 0;
  const scroller = useRef<HTMLDivElement>(null);
  const changePage = (next: number) => {
    setPage(next);
    scroller.current?.scrollTo(0, 0);
  };
  return (
    <>
      <div className="file-preview-scroll" ref={scroller}>
        {/\.html?$/i.test(file.path) && <HtmlPreview html={file.text} />}
        <div
          className="file-lines"
          role="group"
          aria-label={t('File lines')}
          aria-description={t('Shift+click selects a range.')}
        >
          {visible.map((line, index) => {
            const number = offset + index + 1;
            return (
              <button
                key={number}
                aria-pressed={number >= from && number <= to}
                onClick={(event) => {
                  setChoosingRange(false);
                  setRange(event.shiftKey && range ? [range[0], number] : [number, number]);
                }}
              >
                <span>{number}</span>
                <code>{line || ' '}</code>
              </button>
            );
          })}
        </div>
      </div>
      {lines.length > linesPerPage && (
        <div className="file-pages">
          <button
            className="icon-button"
            aria-label={t('Previous lines')}
            data-tooltip=""
            disabled={page === 0}
            onClick={() => changePage(page - 1)}
          >
            <Icon name="chevron" size={14} />
          </button>
          <span role="status">
            {t('{start}–{end} of {total}', {
              start: offset + 1,
              end: offset + visible.length,
              total: lines.length,
            })}
          </span>
          <button
            className="icon-button"
            aria-label={t('Next lines')}
            data-tooltip=""
            disabled={offset + visible.length >= lines.length}
            onClick={() => changePage(page + 1)}
          >
            <Icon name="chevron" size={14} />
          </button>
        </div>
      )}
      <div className="selection-toolbar">
        {choosingRange && (
          <div className="file-range" role="group" aria-label={t('Line range')}>
            <label>
              {t('Start line')}
              <input
                type="number"
                min={1}
                max={file.lines}
                value={start}
                inputMode="numeric"
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
            <label>
              {t('End line')}
              <input
                type="number"
                min={1}
                max={file.lines}
                value={end}
                inputMode="numeric"
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
            {start && end && !validRange && (
              <span role="status">
                {t('Choose a range within the file, with the start before or equal to the end.')}
              </span>
            )}
          </div>
        )}
        <div className="selection-actions" role="group" aria-label={t('Attach file context')}>
          <button
            aria-expanded={choosingRange}
            onClick={() => {
              if (choosingRange) setRange(selected ? [from, to] : undefined);
              else {
                setStart(from ? String(from) : '');
                setEnd(to ? String(to) : '');
              }
              setChoosingRange(!choosingRange);
            }}
          >
            {t(choosingRange ? 'Hide range fields' : 'Select range')}
          </button>
          <button onClick={() => onAttach(file, 1, file.lines)} disabled={attachmentBlocked}>
            {t('Attach file')}
          </button>
          <button
            className="primary"
            onClick={() => onAttach(file, from, to)}
            disabled={attachmentBlocked || !selected}
          >
            {selected
              ? t('Attach lines {start}–{end}', { start: from, end: to })
              : t('Attach lines')}
          </button>
        </div>
      </div>
    </>
  );
}

function FilePreview({
  apiBase,
  projectId,
  path,
  narrow,
  showHidden,
  close,
  ...attachment
}: AttachmentControls & {
  apiBase: string;
  projectId: string;
  path: string;
  narrow: boolean;
  showHidden: boolean;
  close: () => void;
}) {
  const { t } = useInterfaceLanguage();
  const image = projectImageType(path);
  const { result, reload } = useRead<FileContent>(
    image ? undefined : fileReadUrl(apiBase, 'file', path, showHidden),
  );
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (narrow) back.current?.focus();
  }, [narrow]);
  return (
    <section className="file-preview" aria-label={t('File preview')}>
      <div className="file-title">
        {narrow && (
          <button
            ref={back}
            className="icon-button file-preview-back"
            aria-label={t('Back to files')}
            data-tooltip=""
            onClick={close}
          >
            <Icon name="chevron" size={16} />
          </button>
        )}
        <Icon name={image ? 'image' : 'file'} size={15} />
        <span className="file-name" title={path}>
          {path.split('/').at(-1)}
        </span>
        <span className="file-read-only">{t('READ ONLY')}</span>
        {!narrow && (
          <button
            className="icon-button"
            aria-label={t('Close file preview')}
            data-tooltip=""
            onClick={close}
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {image ? (
        <div className="file-preview-scroll file-image">
          <ProjectImagePreview projectId={projectId} path={path} showHidden={showHidden} />
        </div>
      ) : !result ? (
        <p className="file-state" role="status">
          {t('Loading file…')}
        </p>
      ) : 'error' in result ? (
        <ReadError error={result.error} retry={reload} />
      ) : (
        <TextPreview file={result.value} {...attachment} />
      )}
    </section>
  );
}

interface Props extends AttachmentControls {
  apiBase?: string;
  directoryIssue?: string;
  projectId: string;
  projectName: string;
  directory: string;
  filePath?: string;
  narrow: boolean;
  showHidden: boolean;
  onShowHiddenChange: (show: boolean) => void;
  onDirectory: (path: string) => void;
  onFile: (path?: string) => void;
}

function fileReadUrl(
  apiBase: string,
  endpoint: 'file' | 'files',
  path: string,
  showHidden: boolean,
) {
  return `${apiBase}/${endpoint}?path=${encodeURIComponent(path)}${showHidden ? '&showHidden=true' : ''}`;
}

export const FilesPanel = memo(function FilesPanel({
  apiBase,
  directoryIssue,
  projectId,
  projectName,
  directory,
  filePath,
  narrow,
  showHidden,
  onShowHiddenChange,
  onDirectory,
  onFile,
  ...attachment
}: Props) {
  const { t } = useInterfaceLanguage();
  const { result, reload } = useRead<Entry[]>(
    apiBase && fileReadUrl(apiBase, 'files', directory, showHidden),
  );
  const preview = apiBase ? filePath : undefined;
  const location = useRef<HTMLSpanElement>(null);
  const selectedEntry = useRef<HTMLButtonElement>(null);
  const parts = directory ? directory.split('/') : [];
  const breadcrumbs = [projectName, ...parts];
  const navigate = (path: string) => {
    onDirectory(path);
    requestAnimationFrame(() => location.current?.focus());
  };
  const closePreview = () => {
    const entry = selectedEntry.current;
    onFile();
    requestAnimationFrame(() => (entry?.isConnected ? entry : location.current)?.focus());
  };
  const toggleHidden = () => {
    if (showHidden) {
      const firstHidden = parts.findIndex(hasHiddenPathSegment);
      if (firstHidden >= 0) onDirectory(parts.slice(0, firstHidden).join('/'));
      else if (preview && hasHiddenPathSegment(preview)) onFile();
    }
    onShowHiddenChange(!showHidden);
  };
  return (
    <div className={'files-panel' + (preview ? ' has-file-preview' : '')}>
      <section
        className="file-directory"
        aria-label={t('Project files')}
        hidden={narrow && !!preview}
      >
        <div className="file-location">
          <nav className="file-breadcrumb" aria-label={t('File location')}>
            {breadcrumbs.map((part, index) => {
              const path = parts.slice(0, index).join('/');
              const current = index === breadcrumbs.length - 1;
              return (
                <span key={path}>
                  {index > 0 && <Icon name="chevron" size={11} />}
                  {current ? (
                    <span ref={location} tabIndex={-1} aria-current="location" title={path || part}>
                      {part}
                    </span>
                  ) : (
                    <button title={path || part} onClick={() => navigate(path)}>
                      {part}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
          <IconButton
            icon={showHidden ? 'eye' : 'hidden'}
            label={t('Show hidden files')}
            className={showHidden ? 'selected' : undefined}
            aria-pressed={showHidden}
            disabled={!apiBase}
            onClick={toggleHidden}
          />
          <button
            className="icon-button"
            aria-label={t('Refresh file list')}
            data-tooltip=""
            onClick={reload}
            disabled={!apiBase || !result}
          >
            <Icon name="refresh" size={15} />
          </button>
        </div>
        <div className="file-list" key={directory}>
          {directoryIssue ? (
            <p className="file-state" role="status">
              {t(directoryIssue)}
            </p>
          ) : !result ? (
            <p className="file-state" role="status">
              {apiBase ? t('Loading files…') : t('Loading project…')}
            </p>
          ) : 'error' in result ? (
            <ReadError error={result.error} retry={reload} />
          ) : result.value.length ? (
            result.value.map((entry) => (
              <button
                className="file-entry"
                key={entry.path}
                ref={preview === entry.path ? selectedEntry : undefined}
                aria-current={preview === entry.path ? 'true' : undefined}
                onClick={() => (entry.directory ? navigate(entry.path) : onFile(entry.path))}
              >
                <Icon
                  name={
                    entry.directory ? 'folder' : projectImageType(entry.path) ? 'image' : 'file'
                  }
                  size={16}
                />
                <span className="file-name" data-tooltip-overflow="">
                  {entry.name}
                </span>
                {entry.directory && <Icon name="chevron" size={12} />}
              </button>
            ))
          ) : (
            <p className="file-state" role="status">
              {t('No visible files.')}
            </p>
          )}
        </div>
      </section>
      {apiBase && preview && (
        <FilePreview
          key={preview}
          apiBase={apiBase}
          projectId={projectId}
          path={preview}
          narrow={narrow}
          showHidden={showHidden}
          close={closePreview}
          {...attachment}
        />
      )}
    </div>
  );
});
