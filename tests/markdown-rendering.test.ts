import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageMarkdown } from '../src/web/ContentPreview';

const code = 'const answer = 42;';
const formats = [
  ['fenced', '```ts\n' + code + '\n```'],
  ['indented', '    ' + code],
] as const;

describe.each(formats)('%s code blocks', (_format, text) => {
  it.each([
    ['user', false, false],
    ['streaming assistant', true, true],
    ['finished assistant', true, false],
  ] as const)('render in a %s message', (_role, assistant, streaming) => {
    const html = renderToStaticMarkup(
      createElement(MessageMarkdown, {
        text,
        assistant,
        streaming,
        resolveFile: () => undefined,
        onOpenFile: () => {},
        onOpenImage: () => {},
      }),
    );
    expect(html).toContain('<pre');
    expect(html).toContain(code);
    if (assistant && !streaming) expect(html).toContain('aria-label="Copy code"');
    else expect(html).not.toContain('aria-label="Copy code"');
  });
});
