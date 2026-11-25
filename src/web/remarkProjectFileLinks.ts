import type { Parent, Root } from 'mdast';
import { projectImageType } from '../shared/images';
import type { Project } from '../shared/types';

export function workspaceImagePath(url: string | undefined, projectPath: string | undefined) {
  if (!url) return;
  let path: string;
  try {
    path = decodeURIComponent(url.split(/[?#]/, 1)[0] ?? '').replace(/^(?:\.\/)+/, '');
  } catch {
    return;
  }
  if (
    !projectImageType(path) ||
    path.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(path) ||
    /[\\\x00-\x1f\x7f]/.test(path)
  )
    return;
  const relative = path.replace(/^\//, '');
  if (relative.split('/').some((part) => part === '' || part === '.' || part === '..')) return;
  return path.startsWith('/') ? path : projectPath && `${projectPath.replace(/\/$/, '')}/${path}`;
}

export interface ProjectFileReference {
  projectId?: string;
  path: string;
}

export function resolveProjectFile(
  href: string | undefined,
  projects: readonly Project[],
  includeServerPaths = false,
): ProjectFileReference | undefined {
  if (!href?.startsWith('/') || href.startsWith('//')) return;
  let path: string;
  try {
    const pathname = href.split(/[?#]/, 1)[0]!.replace(/:\d+(?::\d+)?$/, '');
    path = decodeURIComponent(pathname);
  } catch {
    return;
  }
  if (/[\\\x00-\x1f\x7f]/.test(path)) return;
  if (
    path
      .slice(1)
      .split('/')
      .some((part) => part === '' || part === '.' || part === '..')
  )
    return;
  let owner: Project | undefined;
  let prefixLength = 0;
  for (const project of projects) {
    const prefix = project.path.replace(/\/$/, '') + '/';
    if (prefix.length > prefixLength && path.startsWith(prefix) && path.length > prefix.length) {
      owner = project;
      prefixLength = prefix.length;
    }
  }
  if (owner) return { projectId: owner.id, path: path.slice(prefixLength) };
  if (includeServerPaths) return { path };
}

/** Convert plain project-file anchors while keeping arbitrary HTML escaped. */
export function remarkProjectFileLinks({
  projectPath,
  resolveFile,
}: {
  projectPath?: string;
  resolveFile: (href: string | undefined) => ProjectFileReference | undefined;
}) {
  return (tree: Root) => {
    const rewrite = ({ children }: Parent) => {
      for (let index = 0; index < children.length; index++) {
        const node = children[index]!;
        if ('children' in node) rewrite(node);
        if (node.type !== 'html') continue;
        const label = children[index + 1];
        const end = children[index + 2];
        if (label?.type !== 'text' || end?.type !== 'html' || !/^<\/a\s*>$/i.test(end.value))
          continue;
        const match = /^<a\s+href\s*=\s*(?:"([^"]+)"|'([^']+)')\s*>$/i.exec(node.value);
        const href = match?.[1] ?? match?.[2];
        if (href && (resolveFile(href) || workspaceImagePath(href, projectPath))) {
          children.splice(index, 3, { type: 'link', url: href, children: [label] });
        }
      }
    };
    rewrite(tree);
  };
}
