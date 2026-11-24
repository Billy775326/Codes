import { allNotificationEvents, type NotificationEvent } from './browser-preferences';
import type { State, Summary } from '../shared/types';
import { interfaceLanguages, type Translate } from './interface-language';

export function notificationAccess() {
  if (!window.isSecureContext) return 'insecure';
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export function showNotification(title: string, tag: string) {
  const notification = new Notification(title, { tag });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

function attention(row: Summary) {
  if (row.archived) return '';
  switch (row.sidebarActivity) {
    case 'approvalAndInput':
      return 'both';
    case 'needsApproval':
      return 'approval';
    case 'optionalInput':
    case 'needsInput':
      return 'question';
  }
  if (row.state === 'waitingApproval') return 'approval';
  if (row.state === 'waitingInput') return 'question';
  return '';
}

function attentionTitle(kind: ReturnType<typeof attention>, events: NotificationEvent[]) {
  const approval = (kind === 'approval' || kind === 'both') && events.includes('approval');
  const question = (kind === 'question' || kind === 'both') && events.includes('question');
  if (approval && question) return 'Codex needs approval and an answer';
  if (approval) return 'Codex needs approval';
  if (question) return 'Codex has a question';
}

const results = {
  completed: 'Codex task completed',
  failed: 'Codex task failed',
  interrupted: 'Codex task stopped',
} as const;
const recentKey = 'codes.notifications.recent';

/** Coalesce duplicate event deliveries across tabs without storing conversation content. */
function deliver(title: string, tag: string) {
  const notify = () => {
    if (!document.hidden || notificationAccess() !== 'granted') return;
    const recent: string[] = JSON.parse(localStorage.getItem(recentKey) ?? '[]');
    if (recent.includes(tag)) return;
    showNotification(title, tag);
    localStorage.setItem(recentKey, JSON.stringify([...recent.slice(-31), tag]));
  };
  if (navigator.locks) return navigator.locks.request('codes-notifications', notify);
  return Promise.resolve().then(notify);
}

export class ConversationNotifications {
  private readonly previous = new Map<string, { state: State; attention: string }>();

  observe(
    row: Summary,
    live: boolean,
    t: Translate = interfaceLanguages.en.t,
    events: NotificationEvent[] = allNotificationEvents,
  ) {
    const next = { state: row.state, attention: attention(row) } as const;
    const previous = this.previous.get(row.id);
    this.previous.delete(row.id);
    this.previous.set(row.id, next);
    if (this.previous.size > 500) this.previous.delete(this.previous.keys().next().value!);
    if (!previous || !live || row.archived || !document.hidden) return;
    const title =
      next.attention && previous.attention !== next.attention
        ? attentionTitle(next.attention, events)
        : previous.state !== next.state &&
            ['running', 'waitingInput', 'waitingApproval'].includes(previous.state) &&
            (next.state === 'completed' ||
              next.state === 'failed' ||
              next.state === 'interrupted') &&
            events.includes(next.state)
          ? results[next.state]
          : undefined;
    if (title)
      void deliver(t(title), JSON.stringify([row.id, row.updatedAt, title])).catch(() =>
        console.warn('Unable to show a Codes browser notification.'),
      );
  }
}
