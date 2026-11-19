import type React from 'react';

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    history: (
      <>
        <path d="M3 5v5h5M3 10a9 9 0 1 1 2 8M12 6v6l4 2" />
      </>
    ),
    settings: (
      <>
        <path d="m10 3-1 3-3 1-3 3 2 2-1 4 3 3 3-1 2 3 4-1 1-3 3-2-1-4-3-1-1-4Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    newchat: (
      <>
        <path d="M13 4H4v16h16v-9M10 14l1-4L20 1l3 3-9 9Z" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    monitor: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8m-4-4v4" />
      </>
    ),
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
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    file: (
      <>
        <path d="M14 3H6v18h12V7Z" />
        <path d="M14 3v5h5M9 12h6m-6 4h6" />
      </>
    ),
    folder: <path d="M3 7V5h7l2 2h9v13H3Z" />,
    review: (
      <>
        <path d="M8 3H4v18h4M16 3h4v18h-4M9 8h6m-3-3v6m-3 5h6" />
      </>
    ),
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
    >
      {paths[name] ?? paths.file}
    </svg>
  );
}
export function Brand() {
  return (
    <span className="brand" role="img" aria-label="Codes">
      <img
        className="brand-dark"
        src="/brand/codes-lockup-dark.svg"
        alt=""
        aria-hidden="true"
        width="140"
        height="48"
      />
      <img
        className="brand-light"
        src="/brand/codes-lockup-light.svg"
        alt=""
        aria-hidden="true"
        width="140"
        height="48"
      />
    </span>
  );
}
