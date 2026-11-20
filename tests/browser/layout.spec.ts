import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toBeEnabled();
}

test('workspace defaults to persistent navigation, retains drafts through history, and dismisses model menus with keyboard or pointer', async ({
  page,
}) => {
  await login(page);
  await expect(page.getByLabel('Search projects and chats', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New conversation' })).toBeVisible();
  await page.getByLabel('Message Codex').fill('Unsent panel draft');
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await expect(page.getByLabel('Search projects and chats', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Unsent panel draft');
  const menu = page.getByRole('button', { name: 'Model and reasoning', exact: true });
  await menu.click();
  await expect(page.getByLabel('Model', { exact: true })).toBeVisible();
  await page.getByLabel('Reasoning effort').focus();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(page.getByLabel('Model', { exact: true })).toBeHidden();
  await page.getByLabel('Message Codex').fill('/model');
  await page.getByLabel('Message Codex').press('Enter');
  await expect(page.getByLabel('Model', { exact: true })).toBeFocused();
  await page.getByRole('heading', { name: 'New conversation' }).click();
  await expect(page.getByLabel('Model', { exact: true })).toBeHidden();
});

test('edited-file cards open a focused review to the right of chat and preserve read-only behavior', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await page.getByLabel('Message Codex').fill('[changes] Layout fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  const edits = page.getByRole('region', { name: 'Edited files', exact: true });
  await expect(edits).toContainText('Edited 2 files');
  await edits.getByRole('button', { name: /example.ts/ }).click();
  await expect(
    page.getByRole('region', { name: 'Changes in example.ts', exact: true }),
  ).toBeVisible();
  const panel = await page.locator('.context-panel').boundingBox();
  const chat = await page.locator('.main').boundingBox();
  expect(chat!.x + chat!.width).toBeLessThanOrEqual(panel!.x + 1);
  expect(chat!.width).toBeGreaterThanOrEqual(500);
  const navigation = await page.locator('.sidebar').boundingBox();
  expect(navigation!.x + navigation!.width).toBeLessThanOrEqual(chat!.x + 1);
  await expect(
    page.locator('.context-panel').getByRole('button', { name: /Undo|Apply|Stage/ }),
  ).toHaveCount(0);
  await page
    .getByTestId('message-assistant')
    .getByRole('button', { name: 'Copy message', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('simulated response');
  await page.screenshot({ path: 'test-results/ide-panel-desktop-review.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.locator('.context-panel').boundingBox();
  expect(mobile!.width).toBe(390);
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toBeVisible();
});

test('workspace theme persists and follows system color preferences', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await page.getByLabel('Theme').selectOption('light');
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/ide-panel-light.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await page.getByLabel('Theme').selectOption('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
});

for (const width of [1440, 820, 390, 320]) {
  test(`chat composer and model popup fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
    await login(page);
    await page.getByRole('button', { name: 'Model and reasoning', exact: true }).click();
    const popup = await page
      .getByRole('dialog', { name: 'Model and reasoning', exact: true })
      .boundingBox();
    expect(popup!.x).toBeGreaterThanOrEqual(0);
    expect(popup!.x + popup!.width).toBeLessThanOrEqual(width);
    // Geometric visibility alone misses clipping by the composer's overflow.
    for (const label of ['Model', 'Reasoning effort']) {
      const select = page.getByLabel(label, { exact: true });
      expect(
        await select.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          );
          return hit === element || element.contains(hit);
        }),
      ).toBe(true);
    }
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByLabel('Message Codex').fill('A synthetic draft\nwith multiple lines');
    const box = await page.getByRole('button', { name: 'Send message', exact: true }).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/ide-panel-${width}.png`, fullPage: true });
    await page.getByLabel('Message Codex').fill('[slow] Action hit area fixture');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
    await page.getByLabel('Message Codex').fill('Next draft');
    const interrupted = page.waitForRequest(
      (request) => request.url().endsWith('/interrupt') && request.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Stop task', exact: true }).click();
    await interrupted;
    await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Message Codex')).toHaveValue('Next draft');
  });
}
