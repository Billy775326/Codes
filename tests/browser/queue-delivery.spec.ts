import { test, expect } from '@playwright/test';

for (const width of [1440, 390])
  test(`accepted messages leave the queue while their task runs at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page
      .getByLabel('Workspace access token')
      .fill('test-only-browser-token-not-a-real-secret');
    await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    await expect(page.locator('.connection')).toHaveText('Ready');
    const input = page.getByLabel('Message Codex');
    await input.fill('[hold] Original task ' + Date.now());
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
    await input.fill('[hold] Queued delivery');
    await page.getByRole('button', { name: 'Queue message', exact: true }).click();
    const queue = page.getByRole('region', { name: 'Queued messages', exact: true });
    await expect(queue.locator('li')).toHaveCount(1);
    await page.getByRole('button', { name: 'Stop task', exact: true }).click();
    await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
    await queue.getByRole('button', { name: 'Resume queue', exact: true }).click();
    await expect(page.getByTestId('message-user')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
    await expect(queue).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.connection')).toHaveText('Ready');
    await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
    await expect(queue).toHaveCount(0);
    await input.fill('Remaining waiting message');
    await page.getByRole('button', { name: 'Queue message', exact: true }).click();
    await expect(queue.locator('li')).toHaveCount(1);
    await expect(queue).toContainText('1/10');
    await expect(queue).toContainText('Remaining waiting message');
    await expect(queue).not.toContainText('Queued delivery');
    await page.getByRole('button', { name: 'Stop task', exact: true }).click();
    await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
    await expect(queue.locator('li')).toHaveCount(1);
    await expect(queue.locator('.queue-heading')).toContainText('Paused');
    await expect(queue).toContainText(
      'A task stopped or failed. Review the queue before resuming.',
    );
    await expect(queue.getByRole('button', { name: 'Resume queue', exact: true })).toBeVisible();
    await expect(page.getByTestId('message-user')).toHaveCount(2);
    await queue.getByRole('button', { name: 'Remove queued message', exact: true }).click();
    await expect(queue).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
