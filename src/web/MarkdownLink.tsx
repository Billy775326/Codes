import type { ComponentProps } from 'react';
import type { ExtraProps } from 'react-markdown';

function isExternalWebLink(href: string | undefined) {
  if (!href) return false;
  try {
    const destination = new URL(href, window.location.href);
    return (
      (destination.protocol === 'http:' || destination.protocol === 'https:') &&
      destination.origin !== window.location.origin
    );
  } catch {
    return false;
  }
}

export function MarkdownLink({ node: _node, href, ...props }: ComponentProps<'a'> & ExtraProps) {
  const external = isExternalWebLink(href);
  return (
    <a
      {...props}
      href={href}
      target={external ? '_blank' : props.target}
      rel={external ? 'noopener noreferrer' : props.rel}
    />
  );
}
