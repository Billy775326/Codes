import { openContextTab } from './sidebar-helpers';
import { chooseSettingsSection } from './settings-helpers';
import { expect, test } from '@playwright/test';

test('native permissions, approval callbacks and Files / Changes remain available', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Codex permissions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Read only', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await chooseSettingsSection(
    page.getByRole('dialog', { name: 'Settings', exact: true }),
    'Execution',
  );
  await expect(page.getByLabel('Permission profile', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Approval policy', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Task write root', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByLabel('Message Codex').fill('[approve] Native approval rollback fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve once', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await openContextTab(page, 'Files');
  const panel = page.getByRole('complementary', { name: 'Project context', exact: true });
  await expect(panel.getByRole('button', { name: 'Files', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Changes', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'example.ts', exact: true }).click();
  await expect(panel.locator('.file-preview')).toContainText('export function hello');
  await panel.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(panel.getByLabel('Change scope', { exact: true })).toBeVisible();
});
