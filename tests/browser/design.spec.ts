import { expect, test, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toBeEnabled();
}

test('compact tools retain precise names and show hints on hover and keyboard focus', async ({
  page,
}) => {
  await login(page);
  const files = page.getByRole('button', { name: 'Browse files', exact: true });
  const changes = page.getByRole('button', { name: 'View changes', exact: true });
  const settings = page.getByRole('button', { name: 'Interaction settings', exact: true });
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  for (const control of [files, changes, settings, send]) {
    await expect(control).toBeVisible();
    await expect(control).toHaveText('');
  }
  const permissions = page.getByRole('button', { name: 'Codex permissions', exact: true });
  await expect(permissions).toContainText('Codex default');
  const tooltip = page.locator('.control-tooltip');
  await files.hover();
  await expect(tooltip).toHaveText('Browse files');
  await expect(tooltip).toBeVisible();
  const hintBounds = (await tooltip.boundingBox())!;
  await page.mouse.move(hintBounds.x + hintBounds.width / 2, hintBounds.y + hintBounds.height / 2);
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();

  await files.focus();
  await page.keyboard.press('Tab');
  await expect(changes).toBeFocused();
  await expect(tooltip).toHaveText('View changes');
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(changes).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Project context' })).toBeVisible();

  await permissions.hover();
  await expect(tooltip).toHaveText('Permissions for future tasks');
  await permissions.press('Tab');
  const model = page.getByRole('button', { name: 'Model and reasoning', exact: true });
  await expect(model).toBeFocused();
  await expect(tooltip).toHaveText('Demo model');
  await expect(tooltip).toBeVisible();
});

test('full names appear on hover only when the displayed title is clipped', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await login(page);
  const title = page.getByRole('heading', { level: 1 });
  const hint = page.locator('.control-tooltip');
  await page.clock.install();
  await title.hover();
  await page.clock.runFor(350);
  await expect(hint).toBeHidden();
  const prompt = '[hold] A conversation title with a long name';
  await page.getByLabel('Message Codex').fill(prompt);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(title).toHaveText(prompt);
  expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await title.hover();
  await page.clock.runFor(350);
  await expect(hint).toHaveText(prompt);
  await expect(hint).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(hint).toBeHidden();
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
});

for (const width of [1440, 320]) {
  test(`one workspace heading and project dialog preserve keyboard access at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 1000 });
    await login(page);
    await expect(
      page.getByRole('main', { name: 'Conversation workspace', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('New conversation');
    if (width === 320)
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expect(page.locator('.project-card-name[aria-current="true"]')).toHaveCount(1);
    const add = page.getByRole('button', { name: 'Add project', exact: true });
    await add.click();
    const dialog = page.getByRole('dialog', { name: 'Add a project', exact: true });
    await expect(
      page.getByRole('dialog', { name: 'Workspace navigation', exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByLabel('Project directory on server')).toBeFocused();
    await dialog.getByLabel('Project directory on server').fill('/synthetic/project-path');
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Add project', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
    if (width === 320)
      await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Explore this project', exact: true }).click();
    await expect(page.getByLabel('Message Codex')).toHaveValue(
      'Explain the architecture of this project and its main entry points.',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/design-workspace-${width}.png`, fullPage: true });
  });
}

test('composer commands retain focus and permissions without dispatching a task', async ({
  page,
}) => {
  await login(page);
  const dispatches: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/(send|steer|queue|review)$/.test(request.url()))
      dispatches.push(request.url());
  });
  const input = page.getByLabel('Message Codex');
  const modelButton = page.getByRole('button', { name: 'Model and reasoning', exact: true });
  await input.fill('/model');
  // Dismiss the picker before the browser reports the native disclosure toggle.
  await input.evaluate((element) => {
    const press = (target: Element, key: string) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    press(element, 'Enter');
    if (document.activeElement?.getAttribute('aria-label') !== 'Model')
      throw new Error('The configuration action did not receive focus');
    press(document.activeElement, 'Escape');
  });
  await expect(modelButton).toBeFocused();
  await expect(modelButton).toHaveAttribute('aria-expanded', 'false');
  for (const [command, label] of [
    ['/model', 'Model'],
    ['/reasoning', 'Reasoning effort'],
  ] as const) {
    await input.fill(command);
    await input.press('Enter');
    await expect(page.getByRole('combobox', { name: label, exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(modelButton).toBeFocused();
  }
  await page.getByLabel('Message Codex').fill('/approve');
  await page.getByLabel('Message Codex').press('Enter');
  await expect(page.getByRole('dialog', { name: 'Codex permissions', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Codex configuration', exact: true }).click();
  await expect(page.getByLabel('Permission profile', { exact: true })).toBeVisible();
  await expect(page.getByTestId('message-user')).toHaveCount(0);
  expect(dispatches).toEqual([]);
});

test('light theme reaches sign-in and portaled archive dialogs', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await page.keyboard.press('Escape');
  const title = 'Shared theme fixture ' + Date.now();
  await page.getByLabel('Message Codex').fill(title);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive ' + title, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive this conversation?', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgb(255, 255, 255)',
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Workspace access token')).toBeVisible();
  expect(
    await page
      .locator('.login-shell')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe('rgb(250, 250, 250)');
});

test('a phone archive confirmation owns the modal while navigation stays inert', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await login(page);
  const title = 'Phone modal priority ' + Date.now();
  await page.getByLabel('Message Codex').fill(title);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const archive = page.getByRole('button', { name: 'Archive ' + title, exact: true });
  await archive.click();
  const dialog = page.getByRole('dialog', { name: 'Archive this conversation?', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Workspace navigation', exact: true }),
  ).toBeVisible();
  await expect(archive).toBeFocused();
});

for (const width of [320, 390]) {
  test(`direct workspace tools fit the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await login(page);
    const header = page.locator('header.topbar');
    await expect(header.getByRole('button', { name: 'Conversation actions' })).toHaveCount(0);
    for (const control of await header.getByRole('button').all()) {
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    const status = header.getByRole('button', { name: 'Session status', exact: true });
    await status.click();
    await expect(page.getByRole('dialog', { name: 'Session status', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(status).toBeFocused();
  });
}

test('dismissing the tablet context drawer returns focus to its launcher', async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 800 });
  await login(page);
  const changes = page.getByRole('button', { name: 'View changes', exact: true });
  await changes.click();
  const panel = page.getByRole('dialog', { name: 'Project context', exact: true });
  await expect(panel).toBeVisible();
  await page.locator('.context-scrim').click({ position: { x: 20, y: 430 } });
  await expect(panel).toHaveCount(0);
  await expect(changes).toBeFocused();
});
