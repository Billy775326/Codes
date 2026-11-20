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
  await page.getByLabel('Project', { exact: true }).selectOption(original.id);
  await page.getByLabel('Message Codex').fill('Draft for the original project');
  await page.getByRole('button', { name: 'Browse files', exact: true }).click();
  await page.getByRole('button', { name: 'example.ts', exact: true }).click();
  await page.getByRole('button', { name: 'Attach selection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove example.ts', exact: true })).toBeVisible();
  await page.getByLabel('Project', { exact: true }).selectOption(added.id);
  await expect(page.getByLabel('Message Codex')).toHaveValue('');
  await expect(page.locator('.context-panel')).toHaveCount(0);
  await expect(page.locator('.attachments')).toHaveCount(0);
  await page.getByLabel('Message Codex').fill('Draft for the second project');
  await page.getByLabel('Project', { exact: true }).selectOption(original.id);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Draft for the original project');
  await page.reload();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Draft for the original project');
  await page.getByLabel('Project', { exact: true }).selectOption(added.id);
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
  await page.getByLabel('Project', { exact: true }).selectOption(added.id);
  await expect(page.getByLabel('Message Codex')).toHaveValue('');
  await page.getByLabel('Project', { exact: true }).selectOption(original.id);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep the legacy draft');
});

test('switching projects aborts a delayed file preview and cannot attach its old file', async ({
  page,
}) => {
  await login(page);
  const { original, added } = await projects(page);
  await page.reload();
  await page.getByLabel('Project', { exact: true }).selectOption(original.id);
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
    await page.getByRole('button', { name: 'Browse files', exact: true }).click();
    await page.getByRole('button', { name: 'example.ts', exact: true }).click();
    await processed;
    await page.getByLabel('Project', { exact: true }).selectOption(added.id);
    release();
    await page.getByRole('button', { name: 'Browse files', exact: true }).click();
    await expect(page.locator('.file-preview')).toHaveCount(0);
    await expect(page.locator('.file-breadcrumb')).toContainText(added.name);
    await expect(page.getByRole('button', { name: 'Attach selection', exact: true })).toHaveCount(
      0,
    );
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
  await expect(
    navigation.getByRole('button', { name: 'Close navigation', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    navigation.getByRole('button', { name: 'Workspace actions', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
  await page.getByLabel('Message Codex').fill('[slow] Drawer task fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
  await page.getByLabel('Message Codex').fill('Keep the running follow-up');
  await page.getByRole('button', { name: 'Browse files', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Project context', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Attach selection', exact: true }).click();
  await expect(page.locator('.context-panel')).toHaveCount(0);
  await expect(page.getByLabel('Message Codex')).toBeFocused();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep the running follow-up');
  await expect(page.getByRole('button', { name: 'Remove example.ts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
});
