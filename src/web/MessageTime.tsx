import { useMemo } from 'react';
/** Native turn timing, formatted in the browser's local timezone. */
export function formatMessageTime(value: number, locale?: string, timeZone?: string) {
  const date = new Date(value);
  if (!Number.isFinite(value) || !Number.isFinite(date.getTime())) return;
  const short = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(date);
  const full = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    hourCycle: 'h23',
    timeZone,
  }).format(date);
  return { short, full, iso: date.toISOString() };
}
export function MessageTime({
  value,
  kind,
  locale,
}: {
  value?: number;
  kind: 'started' | 'finished';
  locale?: string;
}) {
  const formatted = useMemo(
    () => (value === undefined ? undefined : formatMessageTime(value, locale)),
    [value, locale],
  );
  if (!formatted) return null;
  const label = `Turn ${kind}: ${formatted.full}`;
  return (
    <time
      className={`message-time ${kind === 'started' ? 'user-message-time' : ''}`}
      dateTime={formatted.iso}
      title={label}
      aria-label={label}
    >
      {formatted.short}
    </time>
  );
}
