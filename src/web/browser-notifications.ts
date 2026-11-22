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
      return 'Codex needs approval and an answer';
    case 'needsApproval':
      return 'Codex needs approval';
    case 'optionalInput':
    case 'needsInput':
      return 'Codex has a question';
  }
  if (row.state === 'waitingApproval') return 'Codex needs approval';
  if (row.state === 'waitingInput') return 'Codex has a question';
  return '';
}

const results: Partial<Record<State, string>> = {
  completed: 'Codex task completed',
  failed: 'Codex task failed',
  interrupted: 'Codex task stopped',
};
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

  observe(row: Summary, live: boolean, t: Translate = interfaceLanguages.en.t) {
    const next = { state: row.state, attention: attention(row) };
    const previous = this.previous.get(row.id);
    this.previous.delete(row.id);
    this.previous.set(row.id, next);
    if (this.previous.size > 500) this.previous.delete(this.previous.keys().next().value!);
    if (!previous || !live || row.archived || !document.hidden) return;
    const title =
      next.attention && previous.attention !== next.attention
        ? next.attention
        : previous.state !== next.state &&
            ['running', 'waitingInput', 'waitingApproval'].includes(previous.state)
          ? results[next.state]
          : undefined;
    if (title)
      void deliver(t(title), JSON.stringify([row.id, row.updatedAt, title])).catch(() =>
        console.warn('Unable to show a Codes browser notification.'),
      );
  }
}
