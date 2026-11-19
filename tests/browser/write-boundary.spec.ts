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
});
