import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { projectImageType } from '../shared/images';
import type { FileContent } from '../shared/types';
import { message, request } from './api';
import { HtmlPreview, ProjectImagePreview } from './ContentPreview';
import { Icon } from './primitives';
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
  return (
    <div className="file-state" role="alert">
      <span>{error}</span>
      <button onClick={retry}>Retry</button>
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
  const [page, setPage] = useState(0);
  const [range, setRange] = useState<[number, number]>([1, Math.min(file.lines, 50)]);
  const lines = useMemo(() => file.text.split('\n'), [file.text]);
  const offset = page * linesPerPage;
  const visible = lines.slice(offset, offset + linesPerPage);
  const from = Math.min(...range);
  const to = Math.max(...range);
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
          aria-label="File lines"
          aria-description="Hold Shift to select a range."
        >
          {visible.map((line, index) => {
            const number = offset + index + 1;
            return (
              <button
                key={number}
                aria-pressed={number >= from && number <= to}
                onClick={(event) =>
                  setRange(event.shiftKey ? [range[0], number] : [number, number])
                }
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
            aria-label="Previous lines"
            data-tooltip=""
            disabled={page === 0}
            onClick={() => changePage(page - 1)}
          >
            <Icon name="chevron" size={14} />
          </button>
          <span role="status">
            {offset + 1}–{offset + visible.length} of {lines.length}
          </span>
          <button
            className="icon-button"
            aria-label="Next lines"
            data-tooltip=""
            disabled={offset + visible.length >= lines.length}
            onClick={() => changePage(page + 1)}
          >
            <Icon name="chevron" size={14} />
          </button>
        </div>
      )}
      <div className="selection-toolbar">
        <span>
          Lines {from}–{to}
        </span>
        <button onClick={() => onAttach(file, 1, file.lines)} disabled={attachmentBlocked}>
          Attach file
        </button>
        <button
          className="primary"
          onClick={() => onAttach(file, from, to)}
          disabled={attachmentBlocked}
        >
          Attach selection
        </button>
      </div>
    </>
  );
}

function FilePreview({
  apiBase,
  projectId,
  path,
  narrow,
  close,
  ...attachment
}: AttachmentControls & {
  apiBase: string;
  projectId: string;
  path: string;
  narrow: boolean;
  close: () => void;
}) {
  const image = projectImageType(path);
  const { result, reload } = useRead<FileContent>(
    image ? undefined : `${apiBase}/file?path=${encodeURIComponent(path)}`,
  );
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (narrow) back.current?.focus();
  }, [narrow]);
  return (
    <section className="file-preview" aria-label="File preview">
      <div className="file-title">
        {narrow && (
          <button
            ref={back}
            className="icon-button file-preview-back"
            aria-label="Back to files"
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
        <span className="file-read-only">READ ONLY</span>
        {!narrow && (
          <button
            className="icon-button"
            aria-label="Close file preview"
            data-tooltip=""
            onClick={close}
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {image ? (
        <div className="file-preview-scroll file-image">
          <ProjectImagePreview projectId={projectId} path={path} />
        </div>
      ) : !result ? (
        <p className="file-state" role="status">
          Loading file…
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
  onDirectory: (path: string) => void;
  onFile: (path?: string) => void;
}

export const FilesPanel = memo(function FilesPanel({
  apiBase,
  directoryIssue,
  projectId,
  projectName,
  directory,
  filePath,
  narrow,
  onDirectory,
  onFile,
  ...attachment
}: Props) {
  const { result, reload } = useRead<Entry[]>(
    apiBase && `${apiBase}/files?path=${encodeURIComponent(directory)}`,
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
  return (
    <div className={'files-panel' + (preview ? ' has-file-preview' : '')}>
      <section className="file-directory" aria-label="Project files" hidden={narrow && !!preview}>
        <div className="file-location">
          <nav className="file-breadcrumb" aria-label="File location">
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
          <button
            className="icon-button"
            aria-label="Refresh file list"
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
              {directoryIssue}
            </p>
          ) : !result ? (
            <p className="file-state" role="status">
              {apiBase ? 'Loading files…' : 'Loading project…'}
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
                <span className="file-name" title={entry.name}>
                  {entry.name}
                </span>
                {entry.directory && <Icon name="chevron" size={12} />}
              </button>
            ))
          ) : (
            <p className="file-state" role="status">
              No visible files.
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
          close={closePreview}
          {...attachment}
        />
      )}
    </div>
  );
});
