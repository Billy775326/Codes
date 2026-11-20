import { expect, test, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toBeEnabled();
}

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
    await page.getByRole('button', { name: 'Workspace actions', exact: true }).click();
    await page.getByRole('button', { name: 'Add project', exact: true }).click();
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
    await expect(
      page.getByRole('button', { name: 'Workspace actions', exact: true }),
    ).toBeFocused();
    if (width === 320)
      await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
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
  for (const [command, label] of [
    ['/model', 'Model'],
    ['/reasoning', 'Reasoning effort'],
  ] as const) {
    await page.getByLabel('Message Codex').fill(command);
    await page.getByLabel('Message Codex').press('Enter');
    await expect(page.getByLabel(label, { exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Model and reasoning', exact: true }),
    ).toBeFocused();
  }
  await page.getByLabel('Message Codex').fill('/approve');
  await page.getByLabel('Message Codex').press('Enter');
  await expect(page.getByRole('dialog', { name: 'Codex permissions', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Ask for approval/ }).click();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toHaveText(
    'Ask for approval',
  );
  await expect(page.getByTestId('message-user')).toHaveCount(0);
  expect(dispatches).toEqual([]);
});

test('light theme reaches sign-in and portaled archive dialogs', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await page.getByLabel('Workspace theme').selectOption('light');
  await page.keyboard.press('Escape');
  const title = 'Shared theme fixture ' + Date.now();
  await page.getByLabel('Message Codex').fill(title);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Actions for ' + title, exact: true }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive this conversation?', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgb(255, 255, 255)',
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace actions', exact: true }).click();
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
  await page.getByRole('button', { name: 'Actions for ' + title, exact: true }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive this conversation?', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Workspace navigation', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive', exact: true })).toBeFocused();
});
