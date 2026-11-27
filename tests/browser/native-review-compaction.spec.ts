import { test, expect, type Page } from '@playwright/test';
const origin = 'http://127.0.0.1:19140';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('.connection')).toHaveText('Ready');
}
test.afterEach(async ({ page }) => {
  const id = await page.evaluate(() => localStorage.getItem('codes.thread')).catch(() => null);
  if (id)
    await page.request.post('/api/threads/' + id + '/interrupt', {
      data: {},
      headers: { Origin: origin },
    });
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
      const compaction = page.locator('.work-history .message.compaction');
      await expect(compaction).toHaveText('Compacting context…');
      const sidebarStatus = page.locator('.conversation-row.selected .conversation-status');
      await expect(sidebarStatus).toHaveText('Compacting context');
      const id = await page.evaluate(() => localStorage.getItem('codes.thread'));
      const during = await (await page.request.get('/api/threads/' + id + '/snapshot')).json();
      expect(during.thread.sidebarActivity).toBe('compacting');
      await page.reload();
      await expect(compaction).toHaveText('Compacting context…');
      await expect(sidebarStatus).toHaveText('Compacting context');
      await page.getByLabel('Message Codex').fill('Later queued turn');
      await page.getByRole('button', { name: 'Queue message', exact: true }).click();
      await expect(sidebarStatus).toHaveText('Running', { timeout: 10_000 });
      await expect(page.locator('.conversation-inner > .turn-status')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeVisible();
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
      await expect(
        page.locator('.turn-status').getByText('Stopped', { exact: true }),
      ).toBeVisible();
      await expect(page.locator('.turn-status')).not.toContainText('Compacting');
    },
  );
