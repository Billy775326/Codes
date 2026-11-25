import type { Parent, Root } from 'mdast';
import { isHtmlFile } from './file-browser';
import { encodeFilePath, type ProjectFileReference } from './remarkProjectFileLinks';

const marker = /^\s*\uE200visualize\uE202(\{[^\r\n]{1,8192}\})\uE201\s*$/u;

/** Present a visualization reference as an ordinary, validated HTML file link. */
export function remarkVisualizationLinks({
  resolveFile,
  label,
}: {
  resolveFile: (href: string | undefined) => ProjectFileReference | undefined;
  label: (filename: string) => string;
}) {
  return (tree: Root) => {
    function rewrite({ children }: Parent) {
      for (const node of children) {
        if (node.type !== 'paragraph') {
          if ('children' in node) rewrite(node);
          continue;
        }
        const [text] = node.children;
        if (node.children.length !== 1 || text?.type !== 'text') continue;
        const payload = marker.exec(text.value)?.[1];
        if (!payload) continue;
        try {
          const value: unknown = JSON.parse(payload);
          const path = value && typeof value === 'object' && 'path' in value ? value.path : null;
          if (typeof path !== 'string' || !path.startsWith('/') || !isHtmlFile(path)) continue;
          const url = encodeFilePath(path);
          if (!resolveFile(url)) continue;
          node.children = [
            {
              type: 'link',
              url,
              children: [{ type: 'text', value: label(path.split('/').at(-1)!) }],
            },
          ];
        } catch {
          // Leave malformed metadata visible as message text.
        }
      }
    }
    rewrite(tree);
  };
}
