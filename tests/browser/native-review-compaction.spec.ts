import { test, expect, type Page } from '@playwright/test';
const origin = 'http://127.0.0.1:19140';
let originalDefaults: unknown;
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('.connection')).toHaveText('Connected');
}
async function choose(page: Page, name: string) {
  await page.getByRole('button', { name: 'Codex permissions', exact: true }).click();
  await page
    .getByRole('group', { name: 'Permission presets' })
    .getByRole('button', { name: new RegExp('^' + name) })
    .click();
}
test.afterEach(async ({ page }) => {
  if (originalDefaults) {
    const current = await (await page.request.get('/api/settings/defaults')).json();
    await page.request.put('/api/settings/defaults', {
      data: { revision: current.revision, settings: originalDefaults },
      headers: { Origin: origin },
    });
    originalDefaults = undefined;
  }
  const id = await page.evaluate(() => localStorage.getItem('codes.thread')).catch(() => null);
  if (id)
    await page.request.post('/api/threads/' + id + '/interrupt', {
      data: {},
      headers: { Origin: origin },
    });
});
test('Approve for me persists per conversation, is available for defaults, and stays distinct from Full access', async ({
  page,
}) => {
  await login(page);
  originalDefaults = (await (await page.request.get('/api/settings/defaults')).json()).settings;
  await choose(page, 'Approve for me');
  await page.getByLabel('Message Codex').fill('Auto-review browser fixture ' + Date.now());
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.turn-status')).toHaveText('Completed');
  const id = await page.evaluate(() => localStorage.getItem('codes.thread'));
  expect(
    (await (await page.request.get('/api/threads/' + id + '/settings')).json()).settings.permission,
  ).toBe('auto-review');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toContainText(
    'Approve for me',
  );
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await page.getByLabel('Default permissions', { exact: true }).selectOption('auto-review');
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/settings/defaults')).json()).settings.permission,
    )
    .toBe('auto-review');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toContainText(
    'Approve for me',
  );
  await choose(page, 'Full access');
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toContainText(
    'Full access',
  );
  await choose(page, 'Read only');
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toContainText(
    'Read only',
  );
});
test('managed restrictions disable Auto-review in both menus without replacing existing settings', async ({
  page,
}) => {
  await page.route('**/api/permissions', (route) => route.fulfill({ json: { autoReview: false } }));
  await login(page);
  await page.getByRole('button', { name: 'Codex permissions', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Approve for me Keep/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await expect(
    page.getByLabel('Default permissions').getByRole('option', { name: 'Approve for me' }),
  ).toHaveJSProperty('disabled', true);
});
for (const width of [1440, 390])
  test(
    'compaction remains visible across reload and completion does not dispatch the queue at ' +
      width,
    async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await login(page);
      await page
        .getByLabel('Message Codex')
        .fill('[compact] [slow] [hold] Synthetic compaction ' + Date.now());
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(page.locator('.turn-status')).toHaveText('Compacting context…');
      const id = await page.evaluate(() => localStorage.getItem('codes.thread'));
      await page.reload();
      await expect(page.locator('.turn-status')).toHaveText('Compacting context…');
      await page.getByLabel('Message Codex').fill('Later queued turn');
      await page.getByRole('button', { name: 'Queue message', exact: true }).click();
      await expect(page.locator('.turn-status')).toHaveText('Working', { timeout: 10_000 });
      const snapshot = await (await page.request.get('/api/threads/' + id + '/snapshot')).json();
      expect(snapshot.thread.state).toBe('running');
      expect(
        snapshot.thread.queue.items.some((entry: { state: string }) => entry.state === 'queued'),
      ).toBe(true);
      await page.screenshot({
        path: 'test-results/context-compaction-' + width + '.png',
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Stop task', exact: true }).click();
      await expect(page.locator('.turn-status')).toHaveText('Stopped');
      await expect(page.locator('.turn-status')).not.toContainText('Compacting');
    },
  );
