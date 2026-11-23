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

test('desktop sidebars resize independently and keep their widths through reloads and drawers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await login(page);
  const navigation = page.getByRole('complementary', { name: 'Workspace navigation' });
  const context = page.locator('.context-panel');
  const closeNavigation = page.getByRole('button', { name: 'Close navigation', exact: true });
  const files = page.getByRole('button', { name: 'Browse files', exact: true });
  const left = page.getByRole('separator', { name: 'Resize navigation' });
  const right = page.getByRole('separator', { name: 'Resize project panel' });
  const input = page.getByLabel('Message Codex');
  await expect(page.locator('.topbar')).toContainText('New conversation');
  await expect(
    page.locator('.topbar').getByRole('button', { name: 'Close navigation' }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(navigation.getByRole('button', { name: 'Close navigation' })).toHaveCount(0);
  await input.fill('Keep this draft while resizing');
  await files.click();
  const closeContext = context.getByRole('button', { name: 'Close panel', exact: true });
  expect((await closeContext.boundingBox())!.x).toBeLessThan(
    (await context.getByRole('button', { name: 'Files', exact: true }).boundingBox())!.x,
  );
  const width = (element: typeof navigation) =>
    element.evaluate((node) => node.getBoundingClientRect().width);
  const beginDrag = async (handle: typeof left, distance: number) => {
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + distance, y, { steps: 4 });
  };
  await expect.poll(() => width(navigation)).toBe(260);
  await expect.poll(() => width(context)).toBe(460);
  await beginDrag(left, 80);
  await expect.poll(() => width(navigation)).toBe(340);
  expect(await page.evaluate(() => localStorage.getItem('codes.navigation-width'))).toBeNull();
  await page.mouse.up();
  await expect(left).toHaveAttribute('aria-valuenow', '340');
  await expect.poll(() => width(context)).toBe(460);
  await beginDrag(right, -120);
  await expect.poll(() => width(context)).toBe(580);
  await page.mouse.up();
  await expect(right).toHaveAttribute('aria-valuenow', '580');
  await expect.poll(() => width(navigation)).toBe(340);

  await beginDrag(left, -90);
  await expect.poll(() => width(navigation)).toBe(250);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(() => width(navigation)).toBe(340);
  await right.press('ArrowLeft');
  await expect(right).toHaveAttribute('aria-valuenow', '596');
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(right).toHaveAttribute('aria-valuenow', '320');
  expect((await page.locator('.main').boundingBox())!.width).toBeGreaterThanOrEqual(460);
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect(right).toHaveAttribute('aria-valuenow', '596');
  await expect(left).toHaveAttribute('aria-valuenow', '340');

  await closeContext.click();
  await expect(files).toBeFocused();
  await closeNavigation.click();
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.reload();
  await expect(left).toHaveAttribute('aria-valuenow', '340');
  await page.getByRole('button', { name: 'View changes', exact: true }).click();
  await expect(right).toHaveAttribute('aria-valuenow', '596');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(left).toHaveCount(0);
  await expect(right).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Project context' })).toBeVisible();
  expect((await context.boundingBox())!.width).toBe(390);
  await closeContext.click();
  await page.setViewportSize({ width: 1500, height: 900 });
  await files.click();
  await expect(right).toHaveAttribute('aria-valuenow', '596');
  await right.dblclick();
  await expect(right).toHaveAttribute('aria-valuenow', '460');
  await expect(input).toHaveValue('Keep this draft while resizing');
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
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/ide-panel-light.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
});

test('the toolbar switches theme, shares the settings choice, and fits at 320px', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await login(page);
  const themeButton = (mode: 'light' | 'dark') =>
    page.getByRole('button', { name: `Switch to ${mode} mode`, exact: true });
  const workspace = page.locator('.app');
  await page.getByLabel('Message Codex').fill('Keep the current draft');
  await themeButton('light').hover();
  await expect(page.locator('.control-tooltip')).toHaveText('Switch to light mode');
  await themeButton('light').click();
  await expect(workspace).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true });
  await expect(theme).toHaveValue('light');
  await theme.selectOption('system');
  await expect(workspace).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape');
  await themeButton('light').hover();
  await expect(page.locator('.control-tooltip')).toHaveText('Switch to light mode');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(themeButton('dark')).toBeVisible();
  await expect(page.locator('.control-tooltip')).toHaveText('Switch to dark mode');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('.control-tooltip')).toHaveText('Switch to light mode');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.reload();
  const light = themeButton('light');
  await expect(light).toBeVisible();
  const box = (await light.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  await light.press('Enter');
  await page.reload();
  await expect(workspace).toHaveAttribute('data-theme', 'light');
  await expect(themeButton('dark')).toBeVisible();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep the current draft');
});

test('the theme shortcut renders the light palette under Chromium auto-darkening', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setAutoDarkModeOverride', { enabled: true });
  await login(page);
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Switch to dark mode', exact: true }),
  ).toBeVisible();
  const screenshot = await page.locator('.topbar').screenshot();
  const background = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + base64;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(2, 2, 1, 1).data).slice(0, 3);
  }, screenshot.toString('base64'));
  expect(background).toEqual([250, 250, 250]);
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
