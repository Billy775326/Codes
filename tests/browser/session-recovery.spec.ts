import { test, expect, type Page } from '@playwright/test';
const token = 'test-only-browser-token-not-a-real-secret';
async function signin(page: Page) {
  await page.getByLabel('Workspace access token').fill(token);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toBeVisible();
}
async function send(page: Page, text: string) {
  await page.getByLabel('Message Codex').fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
}
async function expire(page: Page) {
  const r = await page.request.post('/api/logout', {
    data: {},
    headers: { Origin: 'http://127.0.0.1:19140' },
  });
  expect(r.ok()).toBe(true);
}

test('an expired snapshot returns to sign-in and restores the selected conversation without resending', async ({
  page,
}) => {
  await page.goto('/');
  await signin(page);
  await send(page, 'Session recovery first ' + Date.now());
  const first = await page.evaluate(() => localStorage.getItem('codes.thread'));
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await send(page, 'Session recovery second ' + Date.now());
  await page.getByLabel('Message Codex').fill('Keep the unsent second draft');
  await expire(page);
  await page.locator('.thread-link').filter({ hasText: 'Session recovery first' }).click();
  await expect(page.getByLabel('Workspace access token')).toBeEnabled();
  await expect(page.getByRole('alert')).toContainText('session has expired');
  await signin(page);
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('codes.thread'))).toBe(first);
  await page.locator('.thread-link').filter({ hasText: 'Session recovery second' }).click();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep the unsent second draft');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
});

test('expired authentication while answering a question restores the pending request', async ({
  page,
}) => {
  await page.goto('/');
  await signin(page);
  await page.getByLabel('Message Codex').fill('[question] Session clarification ' + Date.now());
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Submit answer', exact: true })).toBeEnabled();
  await page.getByLabel('Message Codex').fill('Keep my next draft');
  await expire(page);
  await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await expect(page.getByLabel('Workspace access token')).toBeEnabled();
  await signin(page);
  await expect(page.getByRole('button', { name: 'Submit answer', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep my next draft');
  await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep my next draft');
});

test('an expired sidebar request also returns to sign-in', async ({ page }) => {
  await page.goto('/');
  await signin(page);
  await page.getByLabel('Message Codex').fill('A new project draft');
  await expire(page);
  await page.getByRole('button', { name: 'Refresh conversations', exact: true }).click();
  await expect(page.getByLabel('Workspace access token')).toBeEnabled();
  await signin(page);
  await expect(page.getByLabel('Message Codex')).toHaveValue('A new project draft');
});

test('unavailable snapshots show the cause, block sending and allow explicit retry', async ({
  page,
}) => {
  await page.goto('/');
  await signin(page);
  await send(page, 'Snapshot error fixture ' + Date.now());
  let unavailable = true;
  let requests = 0;
  await page.route('**/api/threads/*/snapshot', async (route) => {
    requests++;
    if (unavailable)
      await route.fulfill({
        status: 404,
        json: {
          error: { code: 'THREAD_NOT_FOUND', message: 'The fixture conversation is unavailable.' },
        },
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.locator('.thread-link').filter({ hasText: 'Snapshot error fixture' }).click();
  await expect(
    page.getByRole('heading', { name: 'Unable to load conversation', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('fixture conversation is unavailable');
  await page.getByLabel('Message Codex').fill('Keep this while loading');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  unavailable = false;
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep this while loading');
  expect(requests).toBe(2);
});
