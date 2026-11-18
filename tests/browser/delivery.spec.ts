import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '../../src/shared/types';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Mode', { exact: true })).toBeEnabled();
}
async function send(page: Page, text: string) {
  await page.getByLabel('Message Codex').fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}
for (const width of [1440, 320])
  test(`delivery labels distinguish next turn from current task at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page);
    await expect(page.locator('#message-delivery-help')).toContainText('Send starts a new turn');
    await send(page, '[slow] Explicit delivery fixture');
    await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
    await page.getByLabel('Message Codex').fill('Correct the current task');
    await expect(page.locator('.composer-dispatch-actions')).toContainText('Queue');
    await expect(page.locator('.composer-dispatch-actions')).toContainText('Stop');
    await expect(page.locator('#message-delivery-help')).toContainText(
      'Waiting text can be edited',
    );
    const steer = page.waitForRequest(
      (request) => request.url().endsWith('/steer') && request.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Add now instead', exact: true }).click();
    await steer;
    await expect(page.getByTestId('message-user')).toHaveCount(2);
    await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Interaction settings' })).toContainText(
      'Sent history is not edited in place',
    );
    await page.getByLabel('Follow-up behavior').selectOption('steer');
    await page.keyboard.press('Escape');
    await page.getByLabel('Message Codex').fill('Do this in the next turn');
    await expect(
      page.getByRole('button', { name: 'Add to current task', exact: true }),
    ).toBeEnabled();
    await expect(page.locator('#message-delivery-help')).toContainText(
      'Accepted additions cannot be edited',
    );
    await page.getByRole('button', { name: 'Queue instead', exact: true }).click();
    const queue = page.getByRole('region', { name: 'Queued messages', exact: true });
    await expect(queue).toContainText('Waiting · Editable');
    await expect(queue.getByRole('button', { name: 'Edit text', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const controls = await page.locator('.composer-dispatch-actions').boundingBox();
    expect(controls!.x).toBeGreaterThanOrEqual(0);
    expect(controls!.x + controls!.width).toBeLessThanOrEqual(width);
    expect(
      await page.locator('.composer-dispatch-actions > button').evaluateAll((buttons) =>
        buttons.every((button) => {
          const label = button.querySelector('.action-label');
          if (!label) return true;
          const bounds = button.getBoundingClientRect();
          const text = label.getBoundingClientRect();
          return text.left >= bounds.left && text.right <= bounds.right;
        }),
      ),
    ).toBe(true);
    await page.screenshot({ path: `test-results/delivery-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Stop task', exact: true }).click();
    await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
  });
test('a queue edit locks at dispatch and remains recoverable if the entry leaves the queue', async ({
  page,
}) => {
  await login(page);
  await send(page, '[approve] Queue editing boundary fixture');
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  await page.getByLabel('Message Codex').fill('Original waiting text');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Queued messages', exact: true });
  await queue.getByRole('button', { name: 'Edit text', exact: true }).click();
  await expect(queue).toContainText(
    'Queue position, model, permissions and attachments stay unchanged',
  );
  await queue.getByLabel('Edit queued message').fill('Keep this unsubmitted local correction');
  await queue.getByRole('button', { name: 'Pause queue', exact: true }).click();
  await expect(queue.getByLabel('Edit queued message')).toHaveValue(
    'Keep this unsubmitted local correction',
  );
  const base: Snapshot = await page.evaluate(async () =>
    (await fetch('/api/threads/' + localStorage.getItem('codes.thread') + '/snapshot')).json(),
  );
  await page.route('**/api/threads/*/snapshot', (route) => route.fulfill({ json: base }));
  base.thread.queue!.items[0]!.state = 'dispatching';
  let patches = 0;
  page.on('request', (request) => {
    if (request.method() === 'PATCH') patches++;
  });
  await page.locator('.connection').click();
  await expect(queue.getByLabel('Edit queued message')).toHaveAttribute('readonly', '');
  await expect(
    queue.getByRole('button', { name: 'Save queued message', exact: true }),
  ).toBeDisabled();
  await expect(queue).toContainText('Your local edit was not submitted');
  base.thread.queue!.items = [];
  await page.locator('.connection').click();
  await expect(queue.getByLabel('Edit queued message')).toHaveValue(
    'Keep this unsubmitted local correction',
  );
  await expect(queue.getByRole('button', { name: 'Close edit', exact: true })).toBeEnabled();
  expect(patches).toBe(0);
  await page.unroute('**/api/threads/*/snapshot');
  await queue.getByRole('button', { name: 'Close edit', exact: true }).click();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
});
