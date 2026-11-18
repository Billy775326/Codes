import { expect, it } from 'vitest';
import { formatMessageTime } from '../src/web/MessageTime';
it('keeps one UTC instant while displaying the browser-selected local date and timezone', () => {
  const value = Date.parse('2026-11-18T03:14:05Z');
  const local = formatMessageTime(value, 'en-US', 'Asia/Shanghai')!;
  const utc = formatMessageTime(value, 'en-US', 'UTC')!;
  expect(local.iso).toBe('2026-11-18T03:14:05.000Z');
  expect(utc.iso).toBe(local.iso);
  expect(local.short).toContain('11:14');
  expect(utc.short).toContain('03:14');
  expect(local.full).toContain('2026');
  expect(local.full).toContain('11:14:05');
  expect(local.full).toContain('GMT+8');
});
it('does not fabricate timestamps from invalid or out-of-range native values', () => {
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_VALUE])
    expect(formatMessageTime(value)).toBeUndefined();
  expect(formatMessageTime(0, 'en-US', 'UTC')?.iso).toBe('1970-01-01T00:00:00.000Z');
});
