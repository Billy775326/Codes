import { test, expect, type Page } from '@playwright/test';
const token = 'test-only-browser-token-not-a-real-secret';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill(token);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toBeVisible();
}
async function send(page: Page, text: string) {
  await page.getByLabel('Message Codex').fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}
test('an idle browser receives conversations created on another device without refresh', async ({
  browser,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const originator = await first.newPage();
    const observer = await second.newPage();
    await login(originator);
    await login(observer);
    await expect(observer.getByRole('heading', { name: 'New conversation' })).toBeVisible();
    const prompt = `[approve] New conversation handoff ${Date.now()}`;
    await send(originator, prompt);
    await observer.locator('.thread-link').filter({ hasText: prompt }).click();
    await expect(observer.getByRole('button', { name: 'Approve once' })).toBeVisible();
    await observer.getByRole('button', { name: 'Decline', exact: true }).click();
    await expect(
      originator.locator('.turn-status').getByText('Stopped', { exact: true }),
    ).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});
test('desktop layout, streamed response, reload, and file selection context', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await expect(page.getByRole('heading', { name: 'New conversation' })).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop-workspace.png', fullPage: true });
  await page.getByRole('button', { name: 'Browse files' }).click();
  await page.getByRole('button', { name: 'example.ts', exact: true }).click();
  await page.getByRole('button', { name: 'Attach lines' }).click();
  await page.getByRole('button', { name: 'Close panel' }).click();
  const prompt = `Explain the selected function ${Date.now()}`;
  await send(page, prompt);
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await expect(page.getByTestId('message-assistant')).toContainText('simulated response');
  await page.reload();
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.getByTestId('message-user')).toContainText('File context');
  await expect(page.getByTestId('message-assistant')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/desktop-conversation.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('a phone can approve after the originating desktop page is closed', async ({ browser }) => {
  const desktop = await browser.newContext();
  const page = await desktop.newPage();
  await login(page);
  const prompt = `[approve] Mobile handoff ${Date.now()}`;
  await send(page, prompt);
  await expect(page.getByRole('button', { name: 'Approve once' })).toBeVisible();
  await desktop.close();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await mobile.newPage();
  await login(phone);
  await phone.getByRole('button', { name: 'Open navigation' }).click();
  await phone.locator('.thread-link').filter({ hasText: prompt }).click();
  await expect(phone.getByRole('button', { name: 'Approve once' })).toBeVisible();
  await phone.screenshot({ path: 'test-results/mobile-approval.png', fullPage: true });
  await phone.getByRole('button', { name: 'Approve once' }).click();
  await expect(phone.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mobile.close();
});
test('browser offline recovery preserves the active turn and draft without duplicate sends', async ({
  page,
  context,
}) => {
  await login(page);
  const prompt = `[slow] Offline recovery ${Date.now()}`;
  await send(page, prompt);
  await expect(page.getByRole('button', { name: 'Stop task' })).toBeVisible();
  await page.getByLabel('Message Codex').fill('A draft while Codex works');
  await context.setOffline(true);
  await page.waitForTimeout(500);
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Reconnect', exact: false }).count();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.getByLabel('Message Codex')).toHaveValue('A draft while Codex works');
  await page.reload();
  await expect(page.getByLabel('Message Codex')).toHaveValue('A draft while Codex works');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
});
test('a lost HTTP receipt is checked without resending the task', async ({ page }) => {
  await login(page);
  let intercepted = false;
  await page.route('**/api/threads/*/send', async (route) => {
    const response = await route.fetch();
    intercepted = true;
    await route.abort('failed');
    void response;
  });
  await send(page, `Lost browser receipt ${Date.now()}`);
  await expect.poll(() => intercepted).toBe(true);
  await expect(page.getByTestId('message-assistant')).toContainText('simulated response');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('message-user')).toHaveCount(1);
});
test('stopping a turn cancels the work instead of only changing the button', async ({ page }) => {
  await login(page);
  await send(page, `[slow] Stop acceptance ${Date.now()}`);
  await expect(page.getByRole('button', { name: 'Stop task' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop task' }).click();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
});
test('bounded long history remains usable while typing and switching conversations', async ({
  page,
}) => {
  await login(page);
  await page.evaluate(async () => {
    const projects = await (await fetch('/api/projects')).json();
    await fetch(`/api/projects/${projects[0].id}/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
  });
  await page.reload();
  await page.locator('.thread-link').filter({ hasText: 'Rendering reference' }).click();
  await expect(page.getByTestId('message-assistant')).toHaveCount(12);
  const timings = await page.evaluate(async () => {
    const tasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      tasks.push(...list.getEntries().map((x) => x.duration));
    });
    observer.observe({ type: 'longtask' });
    (window as any).codesTasks = tasks;
    return performance.now();
  });
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(page.getByTestId('message-assistant')).toHaveCount(24);
  await page.getByLabel('Message Codex').fill('Typing remains responsive in a long conversation');
  await expect(page.getByLabel('Message Codex')).toHaveValue(
    'Typing remains responsive in a long conversation',
  );
  const result = await page.evaluate(() => ({
    longTasks: (window as any).codesTasks as number[],
    messages: document.querySelectorAll('[data-testid^="message-"]').length,
  }));
  expect(result.messages).toBe(48);
  expect(Math.max(0, ...result.longTasks)).toBeLessThan(250);
  await test.info().attach('history-metrics.json', {
    body: JSON.stringify({ ...result, measuredAt: timings }),
    contentType: 'application/json',
  });
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New conversation' })).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop-after-history.png' });
});
