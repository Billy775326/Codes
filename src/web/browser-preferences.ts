import { chatFontSizes, codeFontSizes } from './font-sizes';
import type { InterfaceLanguage } from './interface-language';

export const notificationEventLabels = {
  question: 'Questions',
  approval: 'Approval requests',
  completed: 'Completed tasks',
  failed: 'Failed tasks',
  interrupted: 'Stopped tasks',
} as const;
export type NotificationEvent = keyof typeof notificationEventLabels;
export const allNotificationEvents = Object.keys(notificationEventLabels) as NotificationEvent[];
export type NotificationPreferences = Pick<Preferences, 'notifications' | 'notificationEvents'>;

export interface Preferences {
  followUp: 'queue' | 'steer';
  enter: 'enter' | 'cmdIfMultiline' | 'cmdAlways';
  tabToQueue: boolean;
  newConversationDirectory: 'current' | 'choose';
  review: 'inline' | 'detached';
  theme: 'dark' | 'light' | 'system';
  language: InterfaceLanguage;
  autoScroll: boolean;
  notifications: boolean;
  notificationEvents: NotificationEvent[];
  showHiddenFiles: boolean;
  chatFontSize?: number;
  codeFontSize?: number;
}

export const defaultBrowserPreferences: Preferences = {
  followUp: 'steer',
  enter: 'enter',
  tabToQueue: true,
  newConversationDirectory: 'current',
  review: 'inline',
  theme: 'dark',
  language: 'en',
  autoScroll: true,
  notifications: false,
  notificationEvents: allNotificationEvents,
  showHiddenFiles: false,
};

export function readBrowserPreferences(
  raw: string,
  initialLanguage: InterfaceLanguage = defaultBrowserPreferences.language,
): Preferences {
  try {
    const value = JSON.parse(raw || '{}');
    return {
      followUp: value.followUp === 'queue' ? 'queue' : defaultBrowserPreferences.followUp,
      enter: ['enter', 'cmdIfMultiline', 'cmdAlways'].includes(value.enter) ? value.enter : 'enter',
      tabToQueue: value.tabToQueue !== false,
      newConversationDirectory: value.newConversationDirectory === 'choose' ? 'choose' : 'current',
      review: value.review === 'detached' ? 'detached' : 'inline',
      theme: ['dark', 'light', 'system'].includes(value.theme) ? value.theme : 'dark',
      language:
        value.language === 'zh-CN' || value.language === 'en' ? value.language : initialLanguage,
      autoScroll: value.autoScroll !== false,
      notifications: value.notifications === true,
      notificationEvents: Array.isArray(value.notificationEvents)
        ? allNotificationEvents.filter((event) => value.notificationEvents.includes(event))
        : allNotificationEvents,
      showHiddenFiles: value.showHiddenFiles === true,
      chatFontSize: chatFontSizes.includes(value.chatFontSize) ? value.chatFontSize : undefined,
      codeFontSize: codeFontSizes.includes(value.codeFontSize) ? value.codeFontSize : undefined,
    };
  } catch {
    return { ...defaultBrowserPreferences, language: initialLanguage };
  }
}
