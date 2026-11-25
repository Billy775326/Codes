import { useInterfaceLanguage } from './interface-language';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { projectImageType } from '../shared/images';
import {
  hasHiddenPathSegment,
  type FileBrowserResult,
  type FileEntry,
  type FileLocation,
} from '../shared/project-files';
import type { FileContent } from '../shared/types';
import { ApiError, message, request } from './api';
import { fileBrowserUrl } from './file-browser';
import { BrowserImagePreview, HtmlPreview } from './ContentPreview';
import { InteractionDialog } from './InteractionDialog';
import { Icon, IconButton } from './primitives';
import type { ProjectFileReference } from './remarkProjectFileLinks';
import './files-panel.css';

type ReadResult<T> =
  { url: string; value: T; outsideScope?: boolean } | { url: string; error: string };

function useRead<T>(url: string | undefined, browserUrl?: string, onScopeWarning?: () => void) {
  const [result, setResult] = useState<ReadResult<T>>();
  const [attempt, setAttempt] = useState(0);
  const key = url ?? browserUrl;
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const load = async () => {
      if (url) {
        try {
          return { value: await request<T>(url, {}, controller.signal), outsideScope: false };
        } catch (error) {
          if (!browserUrl || !(error instanceof ApiError) || error.code !== 'PATH_DENIED')
            throw error;
        }
      }
      return request<FileBrowserResult<T>>(browserUrl!, {}, controller.signal);
    };
    void load().then(
      (value) => {
        if (!controller.signal.aborted) {
          setResult({ url: key, ...value });
          if (value.outsideScope) onScopeWarning?.();
        }
      },
      (error) => {
        if (!controller.signal.aborted) setResult({ url: key, error: message(error) });
      },
    );
    return () => controller.abort();
  }, [key, url, browserUrl, attempt, onScopeWarning]);
  return {
    result: result?.url === key ? result : undefined,
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

function TextPreview({ file, attachment }: { file: FileContent; attachment?: AttachmentControls }) {
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
          aria-description={attachment ? t('Shift+click selects a range.') : undefined}
        >
          {visible.map((line, index) => {
            const number = offset + index + 1;
            const content = (
              <>
                <span>{number}</span>
                <code>{line || ' '}</code>
              </>
            );
            return attachment ? (
              <button
                key={number}
                aria-pressed={number >= from && number <= to}
                onClick={(event) => {
                  setChoosingRange(false);
                  setRange(event.shiftKey && range ? [range[0], number] : [number, number]);
                }}
              >
                {content}
              </button>
            ) : (
              <div key={number}>{content}</div>
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
      {attachment && (
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
            <button
              onClick={() => attachment.onAttach(file, 1, file.lines)}
              disabled={attachment.attachmentBlocked}
            >
              {t('Attach file')}
            </button>
            <button
              className="primary"
              onClick={() => attachment.onAttach(file, from, to)}
              disabled={attachment.attachmentBlocked || !selected}
            >
              {selected
                ? t('Attach lines {start}–{end}', { start: from, end: to })
                : t('Attach lines')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function FileTextContents({
  apiBase,
  projectId,
  path,
  showHidden,
  onScopeWarning,
  attachment,
}: {
  apiBase?: string;
  projectId?: string;
  path: string;
  showHidden: boolean;
  onScopeWarning: () => void;
  attachment?: AttachmentControls;
}) {
  const { t } = useInterfaceLanguage();
  const { result, reload } = useRead<FileContent>(
    apiBase && !path.startsWith('/') ? fileReadUrl(apiBase, 'file', path, showHidden) : undefined,
    fileBrowserUrl('file', path, showHidden, projectId),
    onScopeWarning,
  );
  if (!result)
    return (
      <p className="file-state" role="status">
        {t('Loading file…')}
      </p>
    );
  if ('error' in result) return <ReadError error={result.error} retry={reload} />;
  return (
    <TextPreview file={result.value} attachment={result.outsideScope ? undefined : attachment} />
  );
}

export function LinkedFilePreview({
  file,
  showHidden,
  onScopeWarning,
  close,
}: {
  file: ProjectFileReference;
  showHidden: boolean;
  onScopeWarning: () => void;
  close: () => void;
}) {
  const { t } = useInterfaceLanguage();
  return (
    <InteractionDialog
      title={file.path}
      close={close}
      closeOnBackdrop
      className="linked-file-dialog"
    >
      <section className="file-preview" aria-label={t('File preview')}>
        {projectImageType(file.path) ? (
          <div className="file-preview-scroll file-image">
            <BrowserImagePreview
              projectId={file.projectId}
              path={file.path}
              showHidden={showHidden}
              onScopeWarning={onScopeWarning}
            />
          </div>
        ) : (
          <FileTextContents
            apiBase={file.projectId ? '/projects/' + file.projectId : undefined}
            projectId={file.projectId}
            onScopeWarning={onScopeWarning}
            path={file.path}
            showHidden={showHidden}
          />
        )}
      </section>
    </InteractionDialog>
  );
}

function FilePreview({
  apiBase,
  projectId,
  path,
  narrow,
  showHidden,
  onScopeWarning,
  close,
  ...attachment
}: AttachmentControls & {
  apiBase?: string;
  projectId?: string;
  path: string;
  narrow: boolean;
  showHidden: boolean;
  onScopeWarning: () => void;
  close: () => void;
}) {
  const { t } = useInterfaceLanguage();
  const image = projectImageType(path);
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
          <BrowserImagePreview
            projectId={projectId}
            path={path}
            showHidden={showHidden}
            onScopeWarning={onScopeWarning}
          />
        </div>
      ) : (
        <FileTextContents
          apiBase={apiBase}
          projectId={projectId}
          onScopeWarning={onScopeWarning}
          path={path}
          showHidden={showHidden}
          attachment={attachment}
        />
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
  onScopeWarning: () => void;
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
  onScopeWarning,
  ...attachment
}: Props) {
  const { t } = useInterfaceLanguage();
  const absolute = directory.startsWith('/');
  const scopeProject = projectId || undefined;
  const { result, reload } = useRead<FileEntry[]>(
    apiBase && !absolute && !showHidden
      ? fileReadUrl(apiBase, 'files', directory, false)
      : undefined,
    apiBase || absolute
      ? fileBrowserUrl('directory', directory, showHidden, scopeProject)
      : undefined,
    onScopeWarning,
  );
  const preview = apiBase || filePath?.startsWith('/') ? filePath : undefined;
  const location = useRef<HTMLSpanElement>(null);
  const pathButton = useRef<HTMLButtonElement>(null);
  const selectedEntry = useRef<HTMLButtonElement>(null);
  const parts = directory.split('/').filter(Boolean);
  const at = (index: number) => (absolute ? '/' : '') + parts.slice(0, index).join('/');
  const breadcrumbs = [absolute ? t('Server') : projectName, ...parts];
  const [pathInput, setPathInput] = useState<string>();
  const [pathError, setPathError] = useState('');
  const opening = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => opening.current?.abort(), [apiBase]);
  const cancelOpening = () => {
    opening.current?.abort();
    opening.current = undefined;
  };
  const hidePathInput = () => {
    cancelOpening();
    setPathError('');
    setPathInput(undefined);
  };
  const openLocation = async (path: string) => {
    if (!path || opening.current) return;
    const controller = new AbortController();
    opening.current = controller;
    setPathError('');
    try {
      const { value } = await request<FileBrowserResult<FileLocation>>(
        fileBrowserUrl('location', path, showHidden, scopeProject),
        {},
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setPathInput(undefined);
      if (value.directory) navigate(value.path);
      else {
        onDirectory(value.path.slice(0, value.path.lastIndexOf('/')) || '/');
        onFile(value.path);
      }
    } catch (error) {
      if (!controller.signal.aborted) setPathError(message(error));
    } finally {
      if (opening.current === controller) opening.current = undefined;
    }
  };
  const navigate = (path: string) => {
    cancelOpening();
    setPathError('');
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
      if (firstHidden >= 0) onDirectory(at(firstHidden));
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
              const path = at(index);
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
            ref={pathButton}
            icon="open-file"
            label={t('Open server path')}
            aria-expanded={pathInput !== undefined}
            aria-controls={pathInput !== undefined ? 'server-file-path' : undefined}
            onClick={() => {
              if (pathInput !== undefined) hidePathInput();
              else {
                setPathError('');
                setPathInput(directory);
              }
            }}
          />
          <IconButton
            icon={showHidden ? 'eye' : 'hidden'}
            label={t('Show hidden files')}
            className={showHidden ? 'selected' : undefined}
            aria-pressed={showHidden}
            disabled={!apiBase && !absolute}
            onClick={toggleHidden}
          />
          <button
            className="icon-button"
            aria-label={t('Refresh file list')}
            data-tooltip=""
            onClick={reload}
            disabled={!result}
          >
            <Icon name="refresh" size={15} />
          </button>
        </div>
        {pathInput !== undefined && (
          <form
            id="server-file-path"
            className="open-file-path"
            onSubmit={(event) => {
              event.preventDefault();
              void openLocation(pathInput.trim());
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.stopPropagation();
              hidePathInput();
              pathButton.current?.focus();
            }}
          >
            <input
              autoFocus
              aria-label={t('Server file or directory path')}
              placeholder="/"
              maxLength={4096}
              value={pathInput}
              onChange={(event) => {
                cancelOpening();
                setPathError('');
                setPathInput(event.target.value);
              }}
            />
            <IconButton
              icon="check"
              type="submit"
              label={t('Open path')}
              disabled={!pathInput.trim()}
            />
          </form>
        )}
        {pathError && (
          <p className="file-state" role="alert">
            {t(pathError)}
          </p>
        )}
        <div className="file-list" key={directory}>
          {directoryIssue && !absolute ? (
            <p className="file-state" role="status">
              {t(directoryIssue)}
            </p>
          ) : !result ? (
            <p className="file-state" role="status">
              {apiBase || absolute ? t('Loading files…') : t('Loading project…')}
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
                onClick={() => {
                  if (entry.symbolicLink) void openLocation(entry.path);
                  else if (entry.directory) navigate(entry.path);
                  else {
                    cancelOpening();
                    setPathError('');
                    onFile(entry.path);
                  }
                }}
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
      {preview && (
        <FilePreview
          key={preview}
          apiBase={apiBase}
          projectId={scopeProject}
          onScopeWarning={onScopeWarning}
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
