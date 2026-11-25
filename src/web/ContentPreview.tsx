import { useInterfaceLanguage } from './interface-language';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownLink } from './MarkdownLink';
import {
  remarkProjectFileLinks,
  workspaceImagePath,
  type ProjectFileReference,
} from './remarkProjectFileLinks';
import { workspaceImageUrl } from '../shared/images';
import type { FileBrowserResult, FileLocation } from '../shared/project-files';
import { message, request } from './api';
import { fileBrowserUrl } from './file-browser';
import { limits } from '../shared/types';
import { IconButton } from './primitives';
import { InteractionDialog } from './InteractionDialog';
import './content-preview.css';

function htmlPreviewIssue(html: string) {
  if (html.length > limits.file) return 'This HTML is too large to preview.';
  // Parse into inert content. The sandbox still owns how renderable markup is sanitized.
  const template = document.createElement('template');
  template.innerHTML = html;
  const content = template.content;
  const hasScript = !!content.querySelector('script');
  for (const element of content.querySelectorAll(
    'script, title, meta, link, base, template, noscript',
  ))
    element.remove();
  if (
    content.textContent?.trim() ||
    content.querySelector('style, [style], img, hr, input, button, select, progress, table')
  )
    return;
  return hasScript
    ? 'This page needs JavaScript to render. Open the running app to see the page.'
    : 'No visible static HTML to preview.';
}

export function HtmlPreview({ html }: { html: string }) {
  const { t } = useInterfaceLanguage();
  const [open, setOpen] = useState(false);
  const issue = useMemo(() => (open ? htmlPreviewIssue(html) : undefined), [open, html]);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(html, '*');
  }, [html]);
  return (
    <details
      name="codes-html-preview"
      className="html-preview"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t('Preview HTML')}</summary>
      {open && issue && (
        <p className="html-preview-issue" role="status">
          {t(issue)}
        </p>
      )}
      {open && !issue && (
        <iframe
          ref={frame}
          title={t('HTML preview')}
          src="/api/html-preview"
          sandbox="allow-scripts"
          onLoad={() => frame.current?.contentWindow?.postMessage(html, '*')}
        />
      )}
    </details>
  );
}

function PreviewImage({ src, alt }: { src: string; alt: string }) {
  const { t } = useInterfaceLanguage();
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span role="status">
      {t('Image unavailable:') + ' '}
      {alt}
    </span>
  ) : (
    <img
      className="project-preview-image"
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function BrowserImagePreview({
  projectId,
  path,
  showHidden,
  onScopeWarning,
  label = path,
}: {
  projectId?: string;
  path: string;
  showHidden: boolean;
  onScopeWarning: () => void;
  label?: string;
}) {
  const { t } = useInterfaceLanguage();
  const location = fileBrowserUrl('location', path, showHidden, projectId);
  const [result, setResult] = useState<{ key: string; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    void request<FileBrowserResult<FileLocation>>(location, {}, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setResult({ key: location });
        if (value.outsideScope) onScopeWarning();
      },
      (error) => {
        if (!controller.signal.aborted) setResult({ key: location, error: message(error) });
      },
    );
    return () => controller.abort();
  }, [location, onScopeWarning]);
  if (result?.key !== location) return <p role="status">{t('Loading file…')}</p>;
  if (result.error) return <p role="alert">{t(result.error)}</p>;
  return (
    <LinkedImagePreview
      src={'/api' + fileBrowserUrl('image', path, showHidden, projectId)}
      path={label}
    />
  );
}

function LinkedImagePreview({ src, path }: { src: string; path: string }) {
  const { t } = useInterfaceLanguage();
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('Open original: {path}', { path })}
    >
      <PreviewImage key={src} src={src} alt={path} />
    </a>
  );
}

export function ImagePreviewDialog({
  path,
  projectId,
  showHidden,
  onScopeWarning,
  close,
}: {
  path: string;
  projectId?: string;
  showHidden: boolean;
  onScopeWarning: () => void;
  close: () => void;
}) {
  const { t } = useInterfaceLanguage();
  return (
    <InteractionDialog
      title={t('Image preview')}
      close={close}
      closeOnBackdrop
      className="workspace-image-dialog"
    >
      <BrowserImagePreview
        path={path}
        label={path.split('/').at(-1)}
        projectId={projectId}
        showHidden={showHidden}
        onScopeWarning={onScopeWarning}
      />
    </InteractionDialog>
  );
}

const PreviewCodeBlock: Components['pre'] = ({ node, children, ...props }) => {
  const { t } = useInterfaceLanguage();
  const [copyStatus, setCopyStatus] = useState('');
  const code = node?.children[0];
  const content =
    code?.type === 'element' && code.tagName === 'code' ? code.children[0] : undefined;
  const source = content?.type === 'text' ? content.value : undefined;
  const classes = code?.type === 'element' ? code.properties.className : undefined;
  const html =
    source &&
    Array.isArray(classes) &&
    classes.some((name) => typeof name === 'string' && /^language-html?$/i.test(name));
  const copy = async () => {
    if (source === undefined) return;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      // Markdown adds one terminal newline to fenced-code nodes.
      await navigator.clipboard.writeText(source.replace(/\n$/, ''));
      setCopyStatus('Code copied');
    } catch {
      setCopyStatus('Copy unavailable. Select the code text.');
    }
  };
  return (
    <>
      <div className="code-block">
        {source !== undefined && (
          <div className="code-block-actions">
            {copyStatus && <span role="status">{t(copyStatus)}</span>}
            <IconButton icon="copy" label={t('Copy code')} size={15} onClick={() => void copy()} />
          </div>
        )}
        <pre {...props}>{children}</pre>
      </div>
      {html && source && <HtmlPreview html={source} />}
    </>
  );
};

const liveMarkdownLimit = 24 * 1024;

export const MessageMarkdown = memo(function MessageMarkdown({
  text,
  projectPath,
  resolveFile,
  onOpenFile,
  onOpenImage,
  assistant,
  streaming = false,
}: {
  text: string;
  projectPath?: string;
  resolveFile: (href: string | undefined) => ProjectFileReference | undefined;
  onOpenFile: (file: ProjectFileReference) => void;
  onOpenImage: (path: string) => void;
  assistant: boolean;
  streaming?: boolean;
}) {
  const components = useMemo<Components>(
    () => ({
      pre: assistant && !streaming ? PreviewCodeBlock : undefined,
      img: ({ node: _node, src, alt, ...props }) => {
        // A partial image target can change as more of the message arrives.
        if (streaming) return alt ? <span>{alt}</span> : null;
        const path = workspaceImagePath(src, projectPath);
        if (!path) return <img src={src} alt={alt} {...props} />;
        const preview = workspaceImageUrl(path);
        return <PreviewImage key={preview} src={preview} alt={alt || path} />;
      },
      a: ({ node: _node, href, children, ...props }) => {
        const image = workspaceImagePath(href, projectPath);
        if (image) {
          return (
            <button type="button" className="project-file-link" onClick={() => onOpenImage(image)}>
              {children}
            </button>
          );
        }
        const file = assistant ? resolveFile(href) : undefined;
        if (file) {
          return (
            <button type="button" className="project-file-link" onClick={() => onOpenFile(file)}>
              {children}
            </button>
          );
        }
        return (
          <MarkdownLink href={href} {...props}>
            {children}
          </MarkdownLink>
        );
      },
    }),
    [assistant, onOpenFile, onOpenImage, projectPath, resolveFile, streaming],
  );
  if (streaming && text.length > liveMarkdownLimit)
    return <div className="stream-text">{text}</div>;
  return (
    <>
      <Markdown
        remarkPlugins={
          assistant
            ? [remarkGfm, [remarkProjectFileLinks, { projectPath, resolveFile }]]
            : [remarkGfm]
        }
        components={components}
      >
        {text}
      </Markdown>
      {assistant && !streaming && /^(?:\s*<!doctype\s+html\b|\s*<html[\s>])/i.test(text) && (
        <HtmlPreview html={text} />
      )}
    </>
  );
});
