import { expect, test } from '@playwright/test';
test('a server write boundary limits conversation and default permission controls', async ({
  page,
}) => {
  const root = '/synthetic/codes';
  await page.route('**/api/system', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), taskWriteRoot: root } });
  });
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Codex permissions', exact: true }).click();
  const presets = page.getByRole('group', { name: 'Permission presets', exact: true });
  await expect(presets.getByRole('button', { name: /^Full access/ })).toBeDisabled();
  await expect(page.getByLabel('Task write root', { exact: true })).toHaveText(root);
  await presets.getByRole('button', { name: /^Workspace only/ }).click();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toHaveText(
    'Workspace only',
  );
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  const permissions = page.getByLabel('Default permissions', { exact: true });
  await expect(permissions.locator('option[value="danger-full-access"]')).toHaveJSProperty(
    'disabled',
    true,
  );
  await permissions.selectOption('read-only');
  await permissions.press('End');
  await expect(permissions).toHaveValue('workspace-write');
  await expect(permissions.locator('option[value="workspace-write"]')).toHaveText('Workspace only');
  await page.keyboard.press('Escape');
  await page.getByLabel('Message Codex').fill('[hold] Confined task label fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
  try {
    await page.getByLabel('Message Codex').fill('Confined queued label fixture');
    await page.getByRole('button', { name: 'Queue message', exact: true }).click();
    const queue = page.getByRole('region', { name: 'Queued messages', exact: true });
    await queue.getByRole('button', { name: 'Pause queue', exact: true }).click();
    await expect(queue).toContainText('Workspace only');
    await expect(queue).not.toContainText('Ask for approval');
    await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
    await page.getByRole('button', { name: 'Session status', exact: true }).click();
    const status = page.getByRole('dialog', { name: 'Session status', exact: true });
    await expect(
      status
        .locator('dt')
        .filter({ hasText: /^Permissions$/ })
        .locator('+ dd'),
    ).toHaveText('Workspace only');
    await page.keyboard.press('Escape');
  } finally {
    await page.getByRole('button', { name: 'Stop task', exact: true }).click();
    await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
  }
});
