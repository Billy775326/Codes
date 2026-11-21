import { test, expect, type Page } from '@playwright/test';
import type { NetworkSettingsSnapshot } from '../../src/shared/network-settings';
async function fixture(page: Page, text = 'Settings dialog fixture') {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByLabel('Message Codex').fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  if (!text.includes('[slow]'))
    await expect(
      page.locator('.turn-status').getByText('Completed', { exact: true }),
    ).toBeVisible();
}
test('edits network settings and Cloudflare Access on a narrow screen', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  const settings = page.getByRole('button', { name: 'Interaction settings', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Interaction settings', exact: true });
  const open = async () => {
    await settings.click();
    await dialog.getByRole('button', { name: 'Network & access' }).click();
  };
  const path = '/api/settings/network';
  const read = async (): Promise<NetworkSettingsSnapshot> => (await page.request.get(path)).json();
  await open();
  const initial = await read();
  const listenPort = dialog.getByLabel('Listen port');
  const addresses = dialog.getByLabel('Allowed addresses');
  const save = dialog.getByRole('button', { name: 'Save network settings' });
  try {
    await expect(listenPort).toHaveValue(String(initial.active.port));
    const mode = dialog.getByLabel('Authentication mode');
    await expect(mode).toHaveValue('local');
    await expect(save).toBeDisabled();
    await listenPort.fill('8787');
    await expect(addresses).toHaveValue('http://127.0.0.1:8787');
    await addresses.fill('https://codes.example.test/path');
    await save.click();
    await expect(dialog.getByRole('alert')).toContainText('Allowed address 1');
    await addresses.fill('http://127.0.0.1:8787\nhttps://codes.example.test');
    await save.click();
    await expect(dialog.getByRole('status')).toContainText('Restart Codes to apply');
    expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await open();
    await expect(listenPort).toHaveValue('8787');
    await expect(dialog.getByRole('status')).toContainText(`port ${initial.active.port}`);
    await mode.selectOption('cloudflare-access');
    const team = 'https://example.cloudflareaccess.com';
    const audience = 'a'.repeat(64);
    await dialog.getByLabel('Cloudflare team URL').fill(team);
    await dialog.getByLabel('Application Audience (AUD)').fill(audience);
    await save.click();
    await expect(dialog.getByRole('alert')).toContainText('All allowed addresses must use HTTPS');
    await addresses.fill('https://codes.example.test');
    await save.click();
    await expect(save).toBeDisabled();
    expect(await read()).toMatchObject({
      restartRequired: true,
      active: { authMode: 'local' },
      settings: { authMode: 'cloudflare-access', issuer: team, audience },
    });
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await open();
    await expect(mode).toHaveValue('cloudflare-access');
    await expect(dialog.getByLabel('Cloudflare team URL')).toHaveValue(team);
    expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  } finally {
    const current = await read();
    if (current.revision !== initial.revision) {
      const restored = await page.request.put(path, {
        headers: { origin: baseURL! },
        data: { revision: current.revision, settings: initial.settings },
      });
      expect(restored.ok()).toBe(true);
    }
  }
});
for (const width of [1440, 320]) {
  test(`settings keep close controls visible and keyboard focus contained at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });
    await fixture(page);
    await page.getByLabel('Message Codex').fill('Keep this draft behind settings');
    const trigger = page.getByRole('button', { name: 'Interaction settings', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Interaction settings', exact: true });
    await expect(dialog.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
    await expect(dialog.locator('details')).not.toHaveAttribute('open');
    await expect(page.getByLabel('Display size')).toHaveCount(0);
    const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
    const done = dialog.getByRole('button', { name: 'Done', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(done).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await dialog.getByLabel('Chat text size').selectOption('20');
    const themeSelect = dialog.getByRole('combobox', { name: 'Theme', exact: true });
    await expect(themeSelect).toBeVisible();
    const themeBounds = await themeSelect.boundingBox();
    expect(themeBounds!.width).toBeLessThan(125);
    expect(themeBounds!.height).toBeGreaterThanOrEqual(width === 320 ? 44 : 40);
    for (const theme of ['light', 'dark']) {
      await themeSelect.selectOption(theme);
      await dialog
        .getByRole('combobox', { name: 'Review location', exact: true })
        .selectOption('detached');
      await dialog.getByText('Editing and shortcuts', { exact: true }).click();
      await expect(dialog).toContainText('Sent history is not edited in place');
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(width === 320 ? 640 : 900);
      for (const control of [close, done]) {
        const bounds = await control.boundingBox();
        expect(bounds!.y).toBeGreaterThanOrEqual(box!.y);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(box!.y + box!.height);
      }
      expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      await page.screenshot({
        path: `test-results/preferences-${width}-${theme}.png`,
        fullPage: true,
      });
    }
    await done.click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByLabel('Message Codex')).toHaveValue('Keep this draft behind settings');
  });
}
test('font previews and chat typography persist alongside legacy interaction preferences without scaling navigation', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() =>
    localStorage.setItem(
      'codes.preferences',
      JSON.stringify({
        followUp: 'steer',
        enter: 'cmdAlways',
        review: 'detached',
        theme: 'system',
        displaySize: 'large',
      }),
    ),
  );
  await page.reload();
  await expect(page.locator('.connection')).toHaveText('Connected');
  await page.getByLabel('Message Codex').fill('Preserve draft across font changes');
  const sidebarWidth = (await page.locator('.sidebar').boundingBox())!.width;
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Follow-up delivery', exact: true })).toHaveValue(
    'steer',
  );
  await expect(page.getByRole('combobox', { name: 'Send shortcut', exact: true })).toHaveValue(
    'cmdAlways',
  );
  await expect(page.getByRole('combobox', { name: 'Review location', exact: true })).toHaveValue(
    'detached',
  );
  await page.getByLabel('Chat text size').selectOption('20');
  await page.getByLabel('Code text size').selectOption('16');
  const preview = page.getByRole('region', { name: 'Text preview', exact: true });
  expect(await preview.locator('.prose').evaluate((e) => getComputedStyle(e).fontSize)).toBe(
    '20px',
  );
  expect(await preview.locator('code').evaluate((e) => getComputedStyle(e).fontSize)).toBe('16px');
  await page.keyboard.press('Escape');
  expect(
    await page
      .getByTestId('message-assistant')
      .last()
      .locator('.prose')
      .evaluate((e) => getComputedStyle(e).fontSize),
  ).toBe('20px');
  expect((await page.locator('.sidebar').boundingBox())!.width).toBe(sidebarWidth);
  await page.reload();
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await expect(page.getByLabel('Chat text size')).toHaveValue('20');
  await expect(page.getByLabel('Code text size')).toHaveValue('16');
  await expect(page.getByRole('combobox', { name: 'Follow-up delivery', exact: true })).toHaveValue(
    'steer',
  );
  await page.getByLabel('Chat text size').selectOption('');
  await page.getByLabel('Code text size').selectOption('');
  await page.keyboard.press('Escape');
  await expect(page.locator('.app')).not.toHaveAttribute('data-chat-font-size');
  await expect(page.locator('.app')).not.toHaveAttribute('data-code-font-size');
  expect(
    await page
      .getByTestId('message-assistant')
      .last()
      .locator('.prose')
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe('15px');
  await expect(page.getByLabel('Message Codex')).toHaveValue('Preserve draft across font changes');
});
test('a failed browser preference save keeps the current choice available to retry', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    let fail = true;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'codes.preferences' && fail) {
        fail = false;
        throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
      }
      original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  const dialog = page.getByRole('dialog', { name: 'Interaction settings', exact: true });
  await expect(dialog.getByRole('alert')).toHaveText(
    'Changes apply now, but this browser could not save them.',
  );
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
  await dialog.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
});

test('browser settings can be reset without changing workspace defaults or the draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await fixture(page);
  const before = await (await page.request.get('/api/settings/defaults')).json();
  await page.getByLabel('Message Codex').fill('Keep this settings reset draft');
  const settings = page.getByRole('button', { name: 'Interaction settings', exact: true });
  await settings.click();
  const dialog = page.getByRole('dialog', { name: 'Interaction settings', exact: true });
  const theme = dialog.getByRole('combobox', { name: 'Theme', exact: true });
  const autoScroll = dialog.getByRole('switch', { name: 'Scroll with replies', exact: true });
  await theme.selectOption('light');
  await dialog.getByLabel('Chat text size').selectOption('20');
  await autoScroll.uncheck();
  await page.reload();
  await settings.click();
  await expect(autoScroll).not.toBeChecked();
  const reset = dialog.getByRole('button', { name: 'Reset browser settings', exact: true });
  await reset.click();
  const confirmation = dialog.getByRole('group', { name: 'Reset browser settings confirmation' });
  const cancel = confirmation.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeFocused();
  await cancel.click();
  await expect(reset).toBeFocused();
  await expect(theme).toHaveValue('light');
  await reset.click();
  await confirmation.getByRole('button', { name: 'Confirm reset', exact: true }).click();
  await expect(theme).toHaveValue('dark');
  await expect(dialog.getByLabel('Chat text size')).toHaveValue('');
  await expect(autoScroll).toBeChecked();
  expect(await (await page.request.get('/api/settings/defaults')).json()).toEqual(before);
  await page.reload();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep this settings reset draft');
  await settings.click();
  await expect(theme).toHaveValue('dark');
  await expect(autoScroll).toBeChecked();
});

test('turning off reply scrolling preserves the reading position and keeps a manual jump', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await fixture(page);
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Interaction settings', exact: true });
  await dialog.getByLabel('Chat text size').selectOption('24');
  await dialog.getByRole('switch', { name: 'Scroll with replies', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByLabel('Message Codex').fill('[slow] Test reading a stationary transcript');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const transcript = page.locator('.conversation');
  const position = () => transcript.evaluate((element) => element.scrollTop);
  await expect(
    page
      .getByTestId('message-assistant')
      .filter({ has: page.locator('.caret') })
      .getByRole('heading', { name: 'A clear path forward' }),
  ).toBeVisible();
  const back = page.getByRole('button', { name: 'Back to latest messages', exact: true });
  await expect(back).toBeVisible();
  const before = await position();
  await expect(
    page.locator('.turn-status').getByText('Completed', { exact: true }).last(),
  ).toBeVisible({ timeout: 15_000 });
  expect(Math.abs((await position()) - before)).toBeLessThan(2);
  await back.click();
  await expect(back).toHaveCount(0);
  await expect
    .poll(() =>
      transcript.evaluate((element) => {
        return element.scrollHeight - element.scrollTop - element.clientHeight;
      }),
    )
    .toBeLessThan(5);
});
test('opening and changing settings keeps the active task subscription and draft', async ({
  page,
}) => {
  await fixture(page, '[slow] Keep working while settings are open');
  const reply = page.getByTestId('message-assistant').last();
  await expect(reply).toBeVisible();
  const initialLength = (await reply.innerText()).length;
  const id = await page.evaluate(() => localStorage.getItem('codes.thread'));
  await page.getByLabel('Message Codex').fill('Draft for the next turn');
  let snapshots = 0,
    writes = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/snapshot')) snapshots++;
    if (
      request.method() === 'POST' &&
      /\/(send|steer|queue|review)$/.test(new URL(request.url()).pathname)
    )
      writes++;
  });
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Follow-up delivery', exact: true })
    .selectOption('steer');
  await expect.poll(async () => (await reply.innerText()).length).toBeGreaterThan(initialLength);
  // The simulator emits about 45 chunks at 150 ms each in slow mode.
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Message Codex')).toHaveValue('Draft for the next turn');
  expect(await page.evaluate(() => localStorage.getItem('codes.thread'))).toBe(id);
  expect(snapshots).toBe(0);
  expect(writes).toBe(0);
});

for (const width of [1440, 320]) {
  test(`expanded text sizes preview and survive reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 1000 });
    await fixture(page);
    await page.getByLabel('Message Codex').fill('Keep draft while choosing more text sizes');
    await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
    const chat = page.getByLabel('Chat text size', { exact: true });
    const code = page.getByLabel('Code text size', { exact: true });
    expect(
      await chat
        .locator('option')
        .evaluateAll((options) => options.map((option) => option.getAttribute('value'))),
    ).toEqual(['', ...Array.from({ length: 13 }, (_, index) => String(index + 12))]);
    expect(
      await code
        .locator('option')
        .evaluateAll((options) => options.map((option) => option.getAttribute('value'))),
    ).toEqual(['', ...Array.from({ length: 11 }, (_, index) => String(index + 10))]);
    for (const [chatSize, codeSize] of [
      [12, 10],
      [15, 13],
      [24, 20],
    ]) {
      await chat.selectOption(String(chatSize));
      await code.selectOption(String(codeSize));
      const preview = page.getByRole('region', { name: 'Text preview', exact: true });
      expect(
        await preview.locator('.prose').evaluate((element) => getComputedStyle(element).fontSize),
      ).toBe(chatSize + 'px');
      expect(
        await preview.locator('code').evaluate((element) => getComputedStyle(element).fontSize),
      ).toBe(codeSize + 'px');
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.reload();
      await expect(page.getByLabel('Message Codex')).toHaveValue(
        'Keep draft while choosing more text sizes',
      );
      expect(
        await page
          .getByTestId('message-assistant')
          .last()
          .locator('.prose')
          .evaluate((element) => getComputedStyle(element).fontSize),
      ).toBe(chatSize + 'px');
      await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
      await expect(chat).toHaveValue(String(chatSize));
      await expect(code).toHaveValue(String(codeSize));
      const dialog = page.getByRole('dialog', { name: 'Interaction settings', exact: true });
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await chat.selectOption('');
    await code.selectOption('');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await expect(page.locator('.app')).not.toHaveAttribute('data-chat-font-size');
    await expect(page.locator('.app')).not.toHaveAttribute('data-code-font-size');
    expect(
      await page
        .getByTestId('message-assistant')
        .last()
        .locator('.prose')
        .evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe('15px');
  });
}
