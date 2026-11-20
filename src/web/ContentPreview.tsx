import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { projectImageType, projectImageUrl } from '../shared/images';
import './content-preview.css';

export function HtmlPreview({ html }: { html: string }) {
  const [open, setOpen] = useState(false);
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
      <summary>Preview HTML</summary>
      {open && (
        <iframe
          ref={frame}
          title="HTML preview"
          src="/api/html-preview"
          sandbox="allow-scripts"
          onLoad={() => frame.current?.contentWindow?.postMessage(html, '*')}
        />
      )}
    </details>
  );
}

function PreviewImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span role="status">Image unavailable: {alt}</span>
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

export function ProjectImagePreview({ projectId, path }: { projectId: string; path: string }) {
  const src = projectImageUrl(projectId, path);
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" aria-label={'Open original: ' + path}>
      <PreviewImage key={src} src={src} alt={path} />
    </a>
  );
}

function imagePath(url: string | undefined, root: string | undefined) {
  if (!url) return;
  let path: string;
  try {
    path = decodeURIComponent(url.split(/[?#]/, 1)[0] ?? '');
  } catch {
    return;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) return;
  if (path.startsWith('/')) {
    const prefix = root?.endsWith('/') ? root : root && root + '/';
    if (!prefix || !path.startsWith(prefix)) return;
    path = path.slice(prefix.length);
  }
  path = path.replace(/^(?:\.\/)+/, '');
  if (projectImageType(path) && !path.split(/[\\/]/).some((part) => part.startsWith('.')))
    return path;
}

const PreviewCodeBlock: Components['pre'] = ({ node, children, ...props }) => {
  const code = node?.children[0];
  const html =
    code?.type === 'element' &&
    code.tagName === 'code' &&
    Array.isArray(code.properties.className) &&
    code.properties.className.some(
      (name) => typeof name === 'string' && /^language-html?$/i.test(name),
    ) &&
    code.children[0]?.type === 'text'
      ? code.children[0].value
      : undefined;
  return (
    <>
      <pre {...props}>{children}</pre>
      {html && <HtmlPreview html={html} />}
    </>
  );
};

const liveMarkdownLimit = 24 * 1024;

export const AnswerMarkdown = memo(function AnswerMarkdown({
  text,
  projectId,
  projectPath,
  streaming = false,
}: {
  text: string;
  projectId: string;
  projectPath?: string;
  streaming?: boolean;
}) {
  const components = useMemo<Components>(
    () => ({
      pre: streaming ? undefined : PreviewCodeBlock,
      img: ({ node: _node, src, alt, ...props }) => {
        // A partial image target can change as more of the message arrives.
        if (streaming) return alt ? <span>{alt}</span> : null;
        const path = imagePath(src, projectPath);
        if (!path || !projectId) return <img src={src} alt={alt} {...props} />;
        const preview = projectImageUrl(projectId, path);
        return <PreviewImage key={preview} src={preview} alt={alt || path} />;
      },
      a: ({ node: _node, href, children, ...props }) => {
        const path = imagePath(href, projectPath);
        if (!path || !projectId)
          return (
            <a href={href} {...props}>
              {children}
            </a>
          );
        return (
          <a
            href={projectImageUrl(projectId, path)}
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          >
            {children}
          </a>
        );
      },
    }),
    [projectId, projectPath, streaming],
  );
  if (streaming && text.length > liveMarkdownLimit)
    return <div className="stream-text">{text}</div>;
  return (
    <>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
      {!streaming && /^(?:\s*<!doctype\s+html\b|\s*<html[\s>])/i.test(text) && (
        <HtmlPreview html={text} />
      )}
    </>
  );
});
