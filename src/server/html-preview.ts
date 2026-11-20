import { createHash } from 'node:crypto';
import { limits } from '../shared/types.js';

// This is the only script permitted by the preview document's CSP.
const renderer = String.raw`
const tags = new Set(('a abbr article aside b blockquote br button caption code col colgroup dd details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img input kbd label li main mark nav ol p pre progress s samp section select option small span strong style sub summary sup table tbody td th thead tfoot time tr u ul var').split(' '));
const attributes = new Set('alt checked class colspan datetime disabled dir height id lang max min open role rowspan scope selected style title type value width'.split(' '));
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || typeof event.data !== 'string' || event.data.length > ${limits.file}) return;
  const template = document.createElement('template');
  template.innerHTML = event.data;
  for (const element of template.content.querySelectorAll('*')) {
    const tag = element.localName;
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !tags.has(tag)) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name;
      if (attributes.has(name) || name.startsWith('aria-')) continue;
      if (tag === 'img' && name === 'src' &&
          /^data:image\/(png|jpeg|webp|gif);base64,/i.test(attribute.value)) continue;
      element.removeAttribute(name);
    }
  }
  document.body.replaceChildren(template.content);
});
`;

const digest = createHash('sha256').update(renderer).digest('base64');
export const htmlPreviewPolicy = [
  "default-src 'none'",
  `script-src 'sha256-${digest}'`,
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  'sandbox allow-scripts',
].join('; ');
export const htmlPreviewDocument = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HTML preview</title></head>
<body><script>${renderer}</script></body></html>`;
