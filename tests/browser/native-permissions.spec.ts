import { expect, test } from '@playwright/test';

test('native permission presets, approval callbacks and Files / Changes remain available', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Codex permissions', exact: true }).click();
  const presets = page.getByRole('group', { name: 'Permission presets', exact: true });
  await expect(presets.getByRole('button')).toHaveCount(4);
  await expect(presets.getByRole('button', { pressed: true })).toHaveAccessibleName('Read only');
  for (const name of ['Read only', 'Ask for approval', 'Approve for me', 'Full access'])
    await expect(presets.getByRole('button', { name, exact: true })).toBeEnabled();
  await expect(
    presets.getByRole('button', { name: 'Full access', exact: true }),
  ).toHaveAccessibleDescription('Unrestricted server files and network without approval.');
  await expect(page.getByLabel('Task write root', { exact: true })).toHaveCount(0);
  await presets.getByRole('button', { name: /^Ask for approval/ }).click();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toHaveText(
    'Ask for approval',
  );
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation defaults', exact: true }).click();
  const defaults = page.getByLabel('Default permissions', { exact: true });
  await expect(defaults.locator('option[value="danger-full-access"]')).toHaveJSProperty(
    'disabled',
    false,
  );
  await expect(defaults.locator('option[value="workspace-write"]')).toHaveText('Ask for approval');
  await page.keyboard.press('Escape');
  await page.getByLabel('Message Codex').fill('[approve] Native approval rollback fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve once', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Browse files', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Project context', exact: true });
  await expect(panel.getByRole('button', { name: 'Files', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Changes', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'example.ts', exact: true }).click();
  await expect(panel.locator('.file-preview')).toContainText('export function hello');
  await panel.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(panel.getByLabel('Change scope', { exact: true })).toBeVisible();
});
