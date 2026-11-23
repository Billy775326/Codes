import { reconnectUpdates } from './sidebar-helpers';
import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '../../src/shared/types';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toBeEnabled();
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
    const dispatch = page.getByRole('group', { name: 'Message actions', exact: true });
    const buttons = dispatch.getByRole('button');
    await expect(buttons).toHaveText(['Queue', 'Add now', 'Stop']);
    await expect(dispatch.getByRole('button', { name: 'Queue message', exact: true })).toHaveClass(
      'delivery-primary',
    );
    await expect(page.locator('#message-delivery-help')).toContainText(
      'Waiting text can be edited',
    );
    const alternate = page.getByRole('button', { name: 'Add to current task', exact: true });
    await alternate.hover();
    const hint = page.locator('.control-tooltip');
    await expect(hint).toHaveText(
      'Add this draft to the running task. Accepted additions cannot be edited. · Ctrl/Cmd+Shift+Enter',
    );
    await expect(alternate).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Shift+Enter Meta+Shift+Enter',
    );
    await expect(hint).toBeVisible();
    const steer = page.waitForRequest(
      (request) => request.url().endsWith('/steer') && request.method() === 'POST',
    );
    await alternate.click();
    await steer;
    await expect(page.getByTestId('message-user')).toHaveCount(2);
    await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Interaction settings' })).toContainText(
      'Sent history is not edited in place',
    );
    await page
      .getByRole('combobox', { name: 'Follow-up delivery', exact: true })
      .selectOption('steer');
    await page.keyboard.press('Escape');
    await page.getByLabel('Message Codex').fill('Do this in the next turn');
    const addNow = page.getByRole('button', { name: 'Add to current task', exact: true });
    await expect(addNow).toBeEnabled();
    await expect(addNow).toHaveClass('delivery-primary');
    await expect(buttons).toHaveText(['Queue', 'Add now', 'Stop']);
    await addNow.hover();
    await expect(hint).toContainText('Add to current task');
    await expect(hint).toBeVisible();
    await expect(page.locator('#message-delivery-help')).toContainText(
      'Accepted additions cannot be edited',
    );
    const queueInstead = page.getByRole('button', { name: 'Queue message', exact: true });
    await queueInstead.hover();
    await expect(hint).toHaveText(
      'Wait for a new turn. Waiting text stays editable. · Ctrl/Cmd+Shift+Enter',
    );
    await queueInstead.click();
    const queue = page.getByRole('region', { name: 'Queued messages', exact: true });
    await expect(queue).toContainText('Waiting · Editable');
    await expect(queue.getByRole('button', { name: 'Edit message', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const controls = await page.locator('.composer-dispatch-actions').boundingBox();
    expect(controls!.x).toBeGreaterThanOrEqual(0);
    expect(controls!.x + controls!.width).toBeLessThanOrEqual(width);
    const tools = await page.locator('.composer-tools').boundingBox();
    if (width <= 320) expect(controls!.y).toBeGreaterThanOrEqual(tools!.y + tools!.height);
    else expect(controls!.y).toBeCloseTo(tools!.y, 0);
    expect(
      await page.locator('.composer-dispatch-actions > button').evaluateAll((buttons) =>
        buttons.every((button) => {
          const label = button.querySelector('.action-label');
          if (!label) return true;
          const bounds = button.getBoundingClientRect();
          const text = label.getBoundingClientRect();
          return (
            text.left >= bounds.left &&
            text.right <= bounds.right &&
            bounds.top === buttons[0]?.getBoundingClientRect().top &&
            bounds.height >= (innerWidth <= 700 ? 40 : 36)
          );
        }),
      ),
    ).toBe(true);
    await page.screenshot({ path: `test-results/delivery-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Stop task', exact: true }).click();
    await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
  });
test('a queue edit locks at dispatch and remains recoverable if the entry leaves the queue', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await login(page);
  await send(page, '[approve] Queue editing boundary fixture');
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  await page.getByLabel('Message Codex').fill('Original waiting text');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Queued messages', exact: true });
  const tooltip = page.locator('.control-tooltip');
  await queue.getByRole('button', { name: 'Pause queue', exact: true }).hover();
  await expect(tooltip).toHaveText('Pause queue');
  await queue.getByRole('button', { name: 'Edit message', exact: true }).click();
  await expect(queue).toContainText('Paused by you.');
  const editor = queue.getByRole('form', { name: 'Queued message editor', exact: true });
  const controls = editor.getByRole('button');
  await expect(controls).toHaveCount(3);
  for (const [name, hint] of [
    ['Stop task', 'Stop current task and pause queue'],
    ['Cancel edit', 'Cancel edit'],
    ['Save queued message', 'Save queued message'],
  ] as const) {
    const action = editor.getByRole('button', { name, exact: true });
    await expect(action).toHaveText(name === 'Stop task' ? 'Stop task' : '');
    await action.hover();
    await expect(tooltip).toHaveText(hint);
    await expect(tooltip).toBeVisible();
  }
  expect(
    await controls.evaluateAll((buttons) => {
      const bounds = buttons.map((button) => button.getBoundingClientRect());
      return bounds.every(
        (box) =>
          box.width >= 40 &&
          box.height >= 40 &&
          box.left >= 0 &&
          box.right <= innerWidth &&
          box.top === bounds[0]?.top,
      );
    }),
  ).toBe(true);
  await editor.getByLabel('Edit queued message').press('Tab');
  await expect(editor.getByRole('button', { name: 'Stop task', exact: true })).toBeFocused();
  await expect(tooltip).toHaveText('Stop current task and pause queue');
  await queue.getByLabel('Edit queued message').fill('Keep this unsubmitted local correction');
  await expect(queue.getByRole('button', { name: 'Resume queue', exact: true })).toBeDisabled();
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
  await reconnectUpdates(page);
  await expect(queue.getByLabel('Edit queued message')).toHaveAttribute('readonly', '');
  await expect(
    queue.getByRole('button', { name: 'Save queued message', exact: true }),
  ).toBeDisabled();
  await expect(queue).toContainText('Your local edit was not submitted');
  base.thread.queue!.items = [];
  await reconnectUpdates(page);
  await expect(queue.getByLabel('Edit queued message')).toHaveValue(
    'Keep this unsubmitted local correction',
  );
  await expect(queue.getByRole('button', { name: 'Close edit', exact: true })).toBeEnabled();
  expect(patches).toBe(0);
  await page.unroute('**/api/threads/*/snapshot');
  await queue.getByRole('button', { name: 'Close edit', exact: true }).click();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
});
