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
  const files = page.getByRole('button', { name: 'Files and changes', exact: true });
  const settings = page.getByRole('button', { name: 'Interaction settings', exact: true });
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  for (const control of [files, settings, send]) {
    await expect(control).toBeVisible();
    await expect(control).toHaveText('');
  }
  const permissions = page.getByRole('button', { name: 'Codex permissions', exact: true });
  await expect(permissions).toContainText('Codex default');
  const tooltip = page.locator('.control-tooltip');
  await files.hover();
  await expect(tooltip).toHaveText('Files and changes');
  await expect(tooltip).toBeVisible();
  const hintBounds = (await tooltip.boundingBox())!;
  await page.mouse.move(hintBounds.x + hintBounds.width / 2, hintBounds.y + hintBounds.height / 2);
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();

  await files.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(files).toBeFocused();
  await expect(tooltip).toHaveText('Files and changes');
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(files).toHaveAttribute('aria-expanded', 'true');
  const panel = page.getByRole('complementary', { name: 'Project context' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Files', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.topbar').getByRole('button', { name: 'Review code' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Review code', exact: true })).toBeVisible();

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
  test(`one workspace heading and directory dialog preserve keyboard access at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 1000 });
    await login(page);
    await expect(
      page.getByRole('main', { name: 'Conversation workspace', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('New conversation');
    const changeDirectory = page.getByRole('button', {
      name: 'Change working directory',
      exact: true,
    });
    await changeDirectory.click();
    const dialog = page.getByRole('dialog', { name: 'Choose a working directory', exact: true });
    const path = dialog.getByLabel('Working directory', { exact: true });
    await expect(path).toBeFocused();
    await path.fill('/synthetic/project-path');
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Use directory', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(changeDirectory).toBeFocused();
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
  // Native configuration loads after login. The focus check needs an enabled control.
  await expect(
    page.getByRole('combobox', { name: 'Model', exact: true, includeHidden: true }),
  ).toBeEnabled();
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
  await expect(
    page.getByRole('button', { name: 'Edit Codex configuration', exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole('dialog', { name: 'Codex permissions', exact: true })
      .getByRole('button', { name: 'Read only', exact: true }),
  ).toBeVisible();
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
  const context = page.getByRole('button', { name: 'Files and changes', exact: true });
  await context.click();
  const panel = page.getByRole('dialog', { name: 'Project context', exact: true });
  await expect(panel).toBeVisible();
  await page.locator('.context-scrim').click({ position: { x: 20, y: 430 } });
  await expect(panel).toHaveCount(0);
  await expect(context).toBeFocused();
});

for (const width of [1600, 1440, 320]) {
  test('renaming edits the title in its original row at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    if (width === 1440) {
      await page.addInitScript(() => {
        localStorage.setItem('codes.navigation-width', '340');
        localStorage.setItem('codes.context-width', '540');
      });
    }
    await login(page);
    const title =
      width === 1600 ? 'codes' : 'A long conversation title to edit in the workspace header';
    await page.getByLabel('Message Codex').fill(title);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(
      page.locator('.turn-status').getByText('Completed', { exact: true }),
    ).toBeVisible();
    const header = page.locator('.topbar');
    if (width === 1440) {
      await header.getByRole('button', { name: 'Files and changes', exact: true }).click();
      await expect(page.getByRole('separator', { name: 'Resize project panel' })).toBeVisible();
    }
    const cwd = header.locator('.workspace-directory');
    await expect(cwd).toBeVisible();
    const rename = header.getByRole('button', { name: 'Rename conversation', exact: true });
    const renameBox = (await rename.boundingBox())!;
    const headingBox = (await header.getByRole('heading').boundingBox())!;
    const fixed = [header, header.locator('.top-actions')];
    const metadata = [cwd, header.getByRole('button', { name: 'Session status' })];
    const positions = await Promise.all(fixed.map((element) => element.boundingBox()));
    const metadataPositions = await Promise.all(metadata.map((element) => element.boundingBox()));
    await rename.click();
    const input = header.getByRole('textbox', { name: 'Conversation title' });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(title);
    const inputBox = (await input.boundingBox())!;
    expect(inputBox.width).toBeGreaterThanOrEqual(170);
    expect(inputBox.x).toBeCloseTo(headingBox.x, 0);
    expect(inputBox.y + inputBox.height / 2).toBeCloseTo(renameBox.y + renameBox.height / 2, 0);
    await expect(input).toHaveCSS('outline-offset', '-1px');
    await expect(header.getByRole('heading')).toHaveCount(0);
    expect(await Promise.all(fixed.map((element) => element.boundingBox()))).toEqual(positions);
    const editor = header.getByRole('form', { name: 'Rename conversation' });
    await expect(editor).toBeInViewport({ ratio: 1 });
    expect((await editor.boundingBox())!.width).toBeLessThanOrEqual(312);
    if (width === 1600) {
      expect(await Promise.all(metadata.map((element) => element.boundingBox()))).toEqual(
        metadataPositions,
      );
    } else {
      await expect(cwd).toBeHidden();
      await expect(metadata[1]!).toHaveCount(0);
    }
    await input.fill('Unsaved rename');
    await input.press('Escape');
    await expect(rename).toBeFocused();
    await expect(header.getByRole('heading')).toHaveText(title);
    expect(await Promise.all(metadata.map((element) => element.boundingBox()))).toEqual(
      metadataPositions,
    );
  });
}
