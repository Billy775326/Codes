import type React from 'react';

const iconPaths: Record<string, React.ReactNode> = {
  history: (
    <>
      <path d="M3 5v5h5M3 10a9 9 0 1 1 2 8M12 6v6l4 2" />
    </>
  ),
  settings: (
    <>
      <path d="M10 3h4l.8 2.8 1.6.9 2.8-.7 2 3.5-2 2v1.9l2 2-2 3.5-2.8-.7-1.6.9L14 22h-4l-.8-2.9-1.6-.9-2.8.7-2-3.5 2-2v-1.9l-2-2 2-3.5 2.8.7 1.6-.9Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  newchat: (
    <>
      <path d="M12 4H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h1v3l4-3h7a3 3 0 0 0 3-3v-3M17 4v8m-4-4h8" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  link: (
    <path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5m2.5 4.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  moon: <path d="M20.5 15.2A8 8 0 0 1 8.8 3.5 8.9 8.9 0 1 0 20.5 15.2Z" />,
  branch: <path d="M6 3v12a4 4 0 0 0 4 4h5M6 8h8a4 4 0 0 0 4-4M3 3h6M15 1h6M15 16v6" />,
  reply: <path d="m9 5-6 6 6 6M3 11h10a7 7 0 0 1 7 7v2" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  edit: (
    <>
      <path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z" />
    </>
  ),
  archive: (
    <>
      <path d="M4 8h16v13H4ZM3 3h18v5H3Zm6 10h6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5M20 12a8 8 0 0 0-13-6M4 12a8 8 0 0 0 13 6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H6v18h12V7Z" />
      <path d="M14 3v5h5M9 12h6m-6 4h6" />
    </>
  ),
  folder: <path d="M3 7V5h7l2 2h9v13H3Z" />,
  'folder-add': <path d="M3 7V5h7l2 2h9v13H3ZM12 10v7m-3.5-3.5h7" />,
  pin: <path d="M9 4h6l-1 6 4 4H6l4-4-1-6ZM12 14v7" />,
  diff: <path d="M7 3H4v18h3M17 3h3v18h-3M9 8h6m-3-3v6m-3 5h6" />,
  review: (
    <>
      <path d="M11 3H4v18h8m-1-18 4 4h-4Zm-4 9h3m-3 4h2m10 2 3 3" />
      <circle cx="16" cy="15" r="4" />
    </>
  ),
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  upload: <path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" />,
  queue: <path d="M3 6h17M3 12h10M3 18h10m5-5v7m-3.5-3.5h7" />,
  steer: <path d="M4 18v-4a5 5 0 0 1 5-5h11m-5-5 5 5-5 5" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8" cy="9" r="1.5" />
      <path d="m4 18 5-5 3 3 4-6 5 8" />
    </>
  ),
  attach: <path d="m8 12 6-6a4 4 0 0 1 6 6l-8 8a6 6 0 0 1-8-8l8-8m-5 11 8-8" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  terminal: (
    <>
      <path d="m4 5 6 7-6 7m9 0h7" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H4v16h6m-1-8h12m-4-4 4 4-4 4" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  hidden: (
    <>
      <path d="m3 3 18 18M9.5 5.3A11 11 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3 3.9M6 6.1A19 19 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 5-1.2M10 10a3 3 0 0 0 4 4" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {iconPaths[name] ?? iconPaths.file}
    </svg>
  );
}
export function Brand() {
  return (
    <span className="brand" role="img" aria-label="Codes">
      <img src="/brand/codes-lockup-dark.svg" alt="" aria-hidden="true" width="140" height="48" />
      <span className="brand-wordmark" aria-hidden="true" />
    </span>
  );
}
