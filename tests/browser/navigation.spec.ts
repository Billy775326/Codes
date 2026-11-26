import { chooseWorkingDirectory, openContextTab } from './sidebar-helpers';
import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toBeEnabled();
}
async function projects(page: Page) {
  return page.evaluate(async () => {
    const list = await (await fetch('/api/projects')).json();
    const original = list.find((project: { name: string }) => project.name === 'sample-project');
    const added = await (
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: original.path + '/conversation-fixtures',
          name: 'zz Navigation fixture',
        }),
      })
    ).json();
    return { original, added };
  });
}

test('new drafts and attachments remain in their project when navigating without sending', async ({
  page,
}) => {
  await login(page);
  const { original, added } = await projects(page);
  await page.reload();
  await chooseWorkingDirectory(page, original.path);
  await page.getByLabel('Message Codex').fill('Draft for the original project');
  await openContextTab(page, 'Files');
  await page.getByRole('button', { name: 'example.ts', exact: true }).click();
  await page
    .getByRole('group', { name: 'File lines', exact: true })
    .getByRole('button')
    .first()
    .click();
  await page.getByRole('button', { name: /^Attach lines/ }).click();
  await expect(page.getByRole('button', { name: 'Remove example.ts', exact: true })).toBeVisible();
  await chooseWorkingDirectory(page, added.path);
  await expect(page.getByLabel('Message Codex')).toHaveValue('');
  await expect(page.locator('.context-panel')).toHaveCount(0);
  await expect(page.locator('.attachments')).toHaveCount(0);
  await page.getByLabel('Message Codex').fill('Draft for the second project');
  await chooseWorkingDirectory(page, original.path);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Draft for the original project');
  await page.reload();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Draft for the original project');
  await chooseWorkingDirectory(page, added.path);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Draft for the second project');
});

test('a legacy new draft migrates once into its selected project', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('codes.draft.new', 'Keep the legacy draft'));
  await login(page);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep the legacy draft');
  const { original, added } = await projects(page);
  await page.reload();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep the legacy draft');
  expect(await page.evaluate(() => localStorage.getItem('codes.draft.new'))).toBeNull();
  await chooseWorkingDirectory(page, added.path);
  await expect(page.getByLabel('Message Codex')).toHaveValue('');
  await chooseWorkingDirectory(page, original.path);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep the legacy draft');
});

test('a new draft stays selected on reload after migrating a legacy conversation view', async ({
  page,
}) => {
  await login(page);
  const { original } = await projects(page);
  await page.getByLabel('Message Codex').fill('Legacy selected conversation');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Legacy selected conversation');
  await page.evaluate((id) => {
    localStorage.setItem(
      'codes.project-views',
      JSON.stringify({ [id]: localStorage.getItem('codes.thread') }),
    );
  }, original.id);
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.getByLabel('Message Codex').fill('Keep this new draft after reload');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New conversation');
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep this new draft after reload');
});

test('switching projects aborts a delayed file preview and cannot attach its old file', async ({
  page,
}) => {
  await login(page);
  const { original, added } = await projects(page);
  await page.reload();
  await chooseWorkingDirectory(page, original.path);
  let release!: () => void, accepted!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const processed = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  await page.route(
    '**/api/projects/*/file?*',
    async (route) => {
      const response = await route.fetch();
      accepted();
      await hold;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  try {
    await openContextTab(page, 'Files');
    await page.getByRole('button', { name: 'example.ts', exact: true }).click();
    await processed;
    await chooseWorkingDirectory(page, added.path);
    release();
    await openContextTab(page, 'Files');
    await expect(page.locator('.file-preview')).toHaveCount(0);
    await expect(page.locator('.file-breadcrumb')).toContainText(added.name);
    await expect(page.getByRole('button', { name: 'Attach lines', exact: true })).toHaveCount(0);
    await page.screenshot({
      path: 'test-results/web-workspace-project-context.png',
      fullPage: true,
    });
  } finally {
    release();
  }
});

test('phone drawers own focus and attaching context returns to the running conversation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const navigation = page.getByRole('dialog', { name: 'Workspace navigation', exact: true });
  const close = navigation.getByRole('button', { name: 'Close navigation', exact: true });
  const brand = navigation.getByRole('img', { name: 'Codes', exact: true });
  await expect(close).toBeFocused();
  expect((await close.boundingBox())!.x).toBeGreaterThan((await brand.boundingBox())!.x);
  await page.keyboard.press('Shift+Tab');
  await expect(navigation.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
  await page.getByLabel('Message Codex').fill('[slow] Drawer task fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
  await page.getByLabel('Message Codex').fill('Keep the running follow-up');
  const files = page.getByRole('button', { name: 'Files and changes', exact: true });
  await files.click();
  await expect(page.getByRole('dialog', { name: 'Project context', exact: true })).toBeVisible();
  const closePanel = page.getByRole('button', { name: 'Close panel', exact: true });
  await expect(closePanel).toBeFocused();
  await closePanel.press('Enter');
  await expect(files).toBeFocused();
  await files.click();
  await expect(page.locator('.main')).toHaveAttribute('inert', '');
  await page
    .getByLabel('Message Codex')
    .evaluate((element: HTMLTextAreaElement) => element.focus());
  expect(
    await page
      .locator('.context-panel')
      .evaluate((element) => element.contains(document.activeElement)),
  ).toBe(true);
  await page.getByRole('button', { name: 'example.ts', exact: true }).click();
  await page
    .getByRole('group', { name: 'File lines', exact: true })
    .getByRole('button')
    .first()
    .click();
  await page.getByRole('button', { name: /^Attach lines/ }).click();
  await expect(page.locator('.context-panel')).toHaveCount(0);
  await expect(page.getByLabel('Message Codex')).toBeFocused();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep the running follow-up');
  await expect(page.getByRole('button', { name: 'Remove example.ts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
});
