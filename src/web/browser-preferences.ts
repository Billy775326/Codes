import { chatFontSizes, codeFontSizes } from './font-sizes';
import type { InterfaceLanguage } from './interface-language';

export interface Preferences {
  followUp: 'queue' | 'steer';
  enter: 'enter' | 'cmdIfMultiline' | 'cmdAlways';
  review: 'inline' | 'detached';
  theme: 'dark' | 'light' | 'system';
  language: InterfaceLanguage;
  autoScroll: boolean;
  notifications: boolean;
  chatFontSize?: number;
  codeFontSize?: number;
}

export const defaultBrowserPreferences: Preferences = {
  followUp: 'queue',
  enter: 'enter',
  review: 'inline',
  theme: 'dark',
  language: 'en',
  autoScroll: true,
  notifications: false,
};

export function readBrowserPreferences(raw: string): Preferences {
  try {
    const value = JSON.parse(raw || '{}');
    return {
      followUp: ['steer', 'interrupt'].includes(value.followUp) ? 'steer' : 'queue',
      enter: ['enter', 'cmdIfMultiline', 'cmdAlways'].includes(value.enter) ? value.enter : 'enter',
      review: value.review === 'detached' ? 'detached' : 'inline',
      theme: ['dark', 'light', 'system'].includes(value.theme) ? value.theme : 'dark',
      language: value.language === 'zh-CN' ? 'zh-CN' : 'en',
      autoScroll: value.autoScroll !== false,
      notifications: value.notifications === true,
      chatFontSize: chatFontSizes.includes(value.chatFontSize) ? value.chatFontSize : undefined,
      codeFontSize: codeFontSizes.includes(value.codeFontSize) ? value.codeFontSize : undefined,
    };
  } catch {
    return defaultBrowserPreferences;
  }
}
