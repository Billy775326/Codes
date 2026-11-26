import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaultBrowserPreferences } from '../../src/web/browser-preferences';
import { openContextTab } from './sidebar-helpers';
import { chooseSettingsSection } from './settings-helpers';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toBeEnabled();
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  return page.getByRole('dialog', { name: 'Settings', exact: true });
}

test('Tab can be reserved for focus without changing the alternate delivery shortcut', async ({
  page,
}) => {
  await login(page);
  const dialog = await openSettings(page);
  const keyboard = dialog.getByRole('region', { name: 'Keyboard', exact: true });
  const tabToQueue = keyboard.getByRole('switch', { name: 'Tab to queue', exact: true });
  await expect(tabToQueue).toBeChecked();
  await tabToQueue.uncheck();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  const input = page.getByLabel('Message Codex');
  await input.fill('[hold] Keyboard settings fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
  await input.fill('Keep this draft until the alternate shortcut');
  await input.press('Tab');
  await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeFocused();
  await expect(input).toHaveValue('Keep this draft until the alternate shortcut');
  await expect(input).not.toHaveAttribute('aria-keyshortcuts', /\bTab\b/);
  await input.press('Control+Shift+Enter');
  await expect(page.getByRole('region', { name: 'Queued messages', exact: true })).toContainText(
    'Keep this draft until the alternate shortcut',
  );
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
});

test('the new-conversation directory choice is saved and shared by button and shortcut', async ({
  page,
}) => {
  await login(page);
  const input = page.getByLabel('Message Codex');
  await input.fill('Directory preference fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  const dialog = await openSettings(page);
  const directory = dialog.getByRole('combobox', { name: 'New conversation directory' });
  await expect(directory).toHaveValue('current');
  await directory.selectOption('choose');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await input.fill('Do not change my current draft');
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a working directory', exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(input).toHaveValue('Do not change my current draft');
  await page.reload();
  await expect(page.locator('.topbar h1')).toHaveText('Directory preference fixture');
  await input.press('Control+n');
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Use directory', exact: true }).click();
  await expect(page.locator('.topbar h1')).toHaveText('New conversation');
  await expect(input).toHaveValue('');
  await page.getByRole('button', { name: 'Directory preference fixture', exact: true }).click();
  await expect(input).toHaveValue('Do not change my current draft');
});

test('browser preference transfer reviews changes, restores widths and rolls back a failed import', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('widths-initialized')) return;
    sessionStorage.setItem('widths-initialized', 'true');
    localStorage.setItem('codes.navigation-width', '340');
    localStorage.setItem('codes.context-width', '520');
  });
  await login(page);
  const input = page.getByLabel('Message Codex');
  await input.fill('Draft stays in the browser');
  await openContextTab(page, 'Files');
  const dialog = await openSettings(page);
  const theme = dialog.getByRole('combobox', { name: 'Theme', exact: true });
  await theme.selectOption('light');
  const exportButton = dialog.getByRole('button', {
    name: 'Export browser preferences',
    exact: true,
  });
  await expect(exportButton).toHaveCount(0);
  await chooseSettingsSection(dialog, 'Backup & restore');
  const download = page.waitForEvent('download');
  await exportButton.click();
  const exported = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(exported).toEqual({
    format: 'codes-browser-preferences',
    version: 1,
    preferences: { ...defaultBrowserPreferences, theme: 'light' },
    sidebarWidths: { navigation: 340, context: 520 },
  });
  await chooseSettingsSection(dialog, 'General');
  await dialog.getByRole('button', { name: 'Restore default sidebar widths', exact: true }).click();
  await expect(dialog.getByText('Default sidebar widths restored.', { exact: true })).toBeVisible();
  const widths = () =>
    page.evaluate(() => [
      localStorage.getItem('codes.navigation-width'),
      localStorage.getItem('codes.context-width'),
    ]);
  expect(await widths()).toEqual([null, null]);
  await theme.selectOption('dark');
  await chooseSettingsSection(dialog, 'Backup & restore');
  const chooseFile = dialog.getByLabel('Import browser preferences file', { exact: true });
  const load = (data: unknown) =>
    chooseFile.setInputFiles({
      name: 'browser-preferences.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(data)),
    });
  await load({ ...exported, version: 9 });
  await expect(dialog.getByRole('alert')).toContainText(
    'Choose a valid Codes browser preferences file.',
  );
  await load({ ...exported, preferences: { ...exported.preferences, token: 'unexpected' } });
  await expect(dialog.getByRole('alert')).toContainText(
    'Choose a valid Codes browser preferences file.',
  );
  await load(exported);
  const review = dialog.getByRole('group', { name: 'Review imported preferences', exact: true });
  await expect(review.getByRole('list')).toContainText('Theme');
  await expect(review.getByRole('list')).toContainText('Navigation width');
  await expect(review.getByRole('list')).toContainText('Files and changes panel width');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await widths()).toEqual([null, null]);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'codes.preferences') {
        Storage.prototype.setItem = original;
        throw new DOMException('Fixture quota error', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
  });
  const apply = review.getByRole('button', { name: 'Apply preferences', exact: true });
  await apply.click();
  await expect(dialog.getByRole('alert')).toContainText('Could not save the imported preferences');
  expect(await widths()).toEqual([null, null]);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await apply.click();
  await expect(dialog.getByText('Browser preferences imported.', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  const left = page.getByRole('separator', { name: 'Resize navigation' });
  const right = page.getByRole('separator', { name: 'Resize project panel' });
  await expect(left).toHaveAttribute('aria-valuenow', '340');
  await expect(right).toHaveAttribute('aria-valuenow', '520');
  await page.reload();
  await openContextTab(page, 'Files');
  await expect(left).toHaveAttribute('aria-valuenow', '340');
  await expect(right).toHaveAttribute('aria-valuenow', '520');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(input).toHaveValue('Draft stays in the browser');
});

test('the backup page rejects files meant for another settings section', async ({ page }) => {
  await login(page);
  const networkPath = '/api/settings/network';
  const initialNetwork = await (await page.request.get(networkPath)).json();
  const dialog = await openSettings(page);
  const preferences = () => page.evaluate(() => localStorage.getItem('codes.preferences'));
  const initialPreferences = await preferences();
  await chooseSettingsSection(dialog, 'Backup & restore');
  const network = dialog.getByRole('region', { name: 'Network configuration', exact: true });
  const browser = dialog.getByRole('region', { name: 'Browser preferences', exact: true });
  const download = async (label: string) => {
    const pending = page.waitForEvent('download');
    await dialog.getByRole('button', { name: label, exact: true }).click();
    const file = await pending;
    return {
      name: file.suggestedFilename(),
      mimeType: 'application/json',
      buffer: await readFile((await file.path())!),
    };
  };

  const networkFile = await download('Export saved network configuration');
  await browser.getByLabel('Import browser preferences file').setInputFiles(networkFile);
  await expect(browser.getByRole('alert')).toContainText(
    'Choose a valid Codes browser preferences',
  );
  await expect(network.getByRole('alert')).toHaveCount(0);

  const preferencesFile = await download('Export browser preferences');
  await network.getByLabel('Import network settings file').setInputFiles(preferencesFile);
  await expect(network.getByRole('alert')).toContainText('Invalid network configuration');
  await expect(browser.getByRole('group', { name: 'Review imported preferences' })).toHaveCount(0);
  await expect(
    dialog.getByRole('heading', { name: 'Backup & restore', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save network settings' })).toHaveCount(0);
  expect(await (await page.request.get(networkPath)).json()).toEqual(initialNetwork);
  expect(await preferences()).toBe(initialPreferences);
});
