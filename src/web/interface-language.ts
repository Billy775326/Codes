import { createContext, useContext } from 'react';
import { simplifiedChinese } from './zh-CN';

export type InterfaceLanguage = 'en' | 'zh-CN';
export type Translate = (text: string, values?: Record<string, string | number>) => string;

function translator(phrases?: Readonly<Record<string, string>>): Translate {
  return (text, values) => {
    const translated = phrases && Object.hasOwn(phrases, text) ? phrases[text]! : text;
    return values
      ? translated.replace(/\{(\w+)\}/g, (match, key: string) =>
          Object.hasOwn(values, key) ? String(values[key]) : match,
        )
      : translated;
  };
}

export const interfaceLanguages = {
  en: { locale: 'en-US', t: translator() },
  'zh-CN': { locale: 'zh-CN', t: translator(simplifiedChinese) },
};

export const InterfaceLanguageContext = createContext(interfaceLanguages.en);

export function useInterfaceLanguage() {
  return useContext(InterfaceLanguageContext);
}
