import { test, expect, type Page } from '@playwright/test';
async function fixture(page: Page, text = 'Settings dialog fixture') {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByLabel('Message Codex').fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  if (!text.includes('[slow]'))
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
}
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
    for (const theme of ['light', 'dark']) {
      await dialog.getByLabel('Workspace theme').selectOption(theme);
      await dialog.getByLabel('Review delivery preference').selectOption('detached');
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
  await expect(page.getByLabel('Follow-up behavior')).toHaveValue('steer');
  await expect(page.getByLabel('Enter behavior')).toHaveValue('cmdAlways');
  await expect(page.getByLabel('Review delivery preference')).toHaveValue('detached');
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
  await expect(page.getByLabel('Follow-up behavior')).toHaveValue('steer');
  await page.getByLabel('Chat text size').selectOption('');
  await page.getByLabel('Code text size').selectOption('');
  await page.keyboard.press('Escape');
  await expect(page.locator('.app')).not.toHaveAttribute('data-chat-font-size');
  await expect(page.locator('.app')).not.toHaveAttribute('data-code-font-size');
  await expect(page.getByLabel('Message Codex')).toHaveValue('Preserve draft across font changes');
});
test('a failed preference save is visible while current-session changes apply', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'codes.preferences')
        throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await page.getByLabel('Workspace theme').selectOption('light');
  const dialog = page.getByRole('dialog', { name: 'Interaction settings', exact: true });
  await expect(dialog.getByRole('alert')).toHaveText(
    'Changes apply now, but this browser could not save them.',
  );
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
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
  await page.getByLabel('Follow-up behavior').selectOption('steer');
  await expect.poll(async () => (await reply.innerText()).length).toBeGreaterThan(initialLength);
  // The simulator emits about 45 chunks at 150 ms each in slow mode.
  await expect(page.getByText('Completed', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Message Codex')).toHaveValue('Draft for the next turn');
  expect(await page.evaluate(() => localStorage.getItem('codes.thread'))).toBe(id);
  expect(snapshots).toBe(0);
  expect(writes).toBe(0);
});
