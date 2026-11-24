import { afterEach, expect, it, vi } from 'vitest';
import { ConversationNotifications } from '../src/web/browser-notifications';
import { allNotificationEvents, readBrowserPreferences } from '../src/web/browser-preferences';
import type { Summary } from '../src/shared/types';

afterEach(() => vi.unstubAllGlobals());

it('preserves existing notification behavior and respects explicitly selected event types', async () => {
  expect(readBrowserPreferences('{"notifications":true}').notificationEvents).toEqual(
    allNotificationEvents,
  );
  expect(readBrowserPreferences('{"notificationEvents":[]}').notificationEvents).toEqual([]);
  const delivered = vi.fn();
  class NotificationFixture {
    static permission = 'granted';
    constructor(title: string) {
      delivered(title);
    }
  }
  const storage = new Map<string, string>();
  vi.stubGlobal('window', { isSecureContext: true, Notification: NotificationFixture });
  vi.stubGlobal('document', { hidden: true });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('Notification', NotificationFixture);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  });

  const notify = new ConversationNotifications();
  const row: Summary = {
    id: 'thread',
    projectId: 'project',
    title: 'Fixture',
    state: 'running',
    archived: false,
    updatedAt: 1,
  };
  notify.observe(row, false);
  notify.observe({ ...row, updatedAt: 2, sidebarActivity: 'approvalAndInput' }, true, undefined, [
    'approval',
  ]);
  await vi.waitFor(() => expect(delivered).toHaveBeenCalledExactlyOnceWith('Codex needs approval'));
  notify.observe({ ...row, updatedAt: 3, state: 'completed' }, true, undefined, ['approval']);
  await Promise.resolve();
  expect(delivered).toHaveBeenCalledTimes(1);
});
