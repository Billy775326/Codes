import { z } from 'zod';
import { allNotificationEvents, type Preferences } from './browser-preferences';
import { sidebarWidthKeys } from './browser-storage';
import { chatFontSizes, codeFontSizes } from './font-sizes';
import { sidebarWidthLimits, type SidebarWidths } from './SidebarResize';

export const browserPreferencesFileLimit = 16 * 1024;
export const defaultSidebarWidths: SidebarWidths = { navigation: null, context: null };

const sidebarWidth = ({ min, max }: { min: number; max: number }) =>
  z.number().int().min(min).max(max).nullable();

const browserPreferencesFile = z.strictObject({
  format: z.literal('codes-browser-preferences'),
  version: z.literal(1),
  preferences: z.strictObject({
    followUp: z.enum(['queue', 'steer']),
    enter: z.enum(['enter', 'cmdIfMultiline', 'cmdAlways']),
    tabToQueue: z.boolean(),
    newConversationDirectory: z.enum(['current', 'choose']),
    review: z.enum(['inline', 'detached']),
    theme: z.enum(['dark', 'light', 'system']),
    language: z.enum(['en', 'zh-CN']),
    autoScroll: z.boolean(),
    notifications: z.boolean(),
    notificationEvents: z
      .array(z.enum(allNotificationEvents))
      .max(allNotificationEvents.length)
      .refine((events) => new Set(events).size === events.length),
    showHiddenFiles: z.boolean(),
    chatFontSize: z
      .number()
      .refine((size) => chatFontSizes.includes(size))
      .optional(),
    codeFontSize: z
      .number()
      .refine((size) => codeFontSizes.includes(size))
      .optional(),
  }),
  sidebarWidths: z.strictObject({
    navigation: sidebarWidth(sidebarWidthLimits.navigation),
    context: sidebarWidth(sidebarWidthLimits.context),
  }),
});

export type BrowserPreferencesFile = z.infer<typeof browserPreferencesFile>;

export function parseBrowserPreferencesFile(text: string) {
  return browserPreferencesFile.parse(JSON.parse(text));
}

export function exportBrowserPreferencesFile(
  preferences: Preferences,
  sidebarWidths: SidebarWidths,
) {
  return JSON.stringify(
    {
      format: 'codes-browser-preferences',
      version: 1,
      preferences,
      sidebarWidths,
    } satisfies BrowserPreferencesFile,
    null,
    2,
  );
}

export const sidebarWidthSettings = (widths: SidebarWidths) =>
  [
    [sidebarWidthKeys.navigation, widths.navigation?.toString() ?? ''],
    [sidebarWidthKeys.context, widths.context?.toString() ?? ''],
  ] as const;
