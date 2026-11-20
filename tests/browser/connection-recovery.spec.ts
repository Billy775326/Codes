import { test, expect, type Page } from '@playwright/test';
async function fixture(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  const sent = page.waitForRequest(
    (request) => request.url().endsWith('/send') && request.method() === 'POST',
  );
  const title = 'Connection recovery fixture ' + Date.now();
  await page.getByLabel('Message Codex').fill(title);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const operationId = (await sent).postDataJSON().operationId as string;
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  const id = await page.evaluate(() => localStorage.getItem('codes.thread')!);
  return { id, operationId, title };
}
test('a proxy HTML failure is identified on the first snapshot failure and explicit retry restores the draft', async ({
  page,
}) => {
  const { id } = await fixture(page);
  await page.getByLabel('Message Codex').fill('Keep the draft through a proxy error');
  let fail = true,
    sends = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/send')) sends++;
  });
  await page.route('**/api/threads/' + id + '/snapshot', (route) =>
    fail
      ? route.fulfill({
          status: 502,
          contentType: 'text/html',
          body: '<html>Proxy unavailable</html>',
        })
      : route.continue(),
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Unable to load conversation', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('HTTP 502');
  await expect(page.getByRole('alert')).not.toContainText('Check the result');
  fail = false;
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await expect(page.locator('.connection')).toHaveText('Connected');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.getByLabel('Message Codex')).toHaveValue(
    'Keep the draft through a proxy error',
  );
  expect(sends).toBe(0);
});
test('a proven completed receipt is cleared after snapshot recovery without resending the task', async ({
  page,
}) => {
  const { id, operationId } = await fixture(page);
  await page.getByLabel('Message Codex').fill('Keep the next draft');
  await page.evaluate(
    ({ id, operationId }) => localStorage.setItem('codes.operation.' + id, operationId),
    { id, operationId },
  );
  let sends = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/send')) sends++;
  });
  await page.reload();
  await expect(page.locator('.connection')).toHaveText('Connected');
  await expect
    .poll(() => page.evaluate((id) => localStorage.getItem('codes.operation.' + id), id))
    .toBeNull();
  await expect(
    page.getByText('A request may still be running. Check before continuing.', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep the next draft');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  expect(sends).toBe(0);
});
test('an unknown operation receipt remains protected even when the snapshot has no pending request', async ({
  page,
}) => {
  const { id, operationId } = await fixture(page);
  await page.route('**/api/operations/' + operationId, (route) =>
    route.fulfill({ json: { id: operationId, threadId: id, kind: 'send', state: 'unknown' } }),
  );
  await page.evaluate(
    ({ id, operationId }) => localStorage.setItem('codes.operation.' + id, operationId),
    { id, operationId },
  );
  await page.getByLabel('Message Codex').fill('Do not resend an uncertain task');
  await page.reload();
  await expect(page.locator('.connection')).toHaveText('Connected');
  await expect(page.getByRole('button', { name: 'Check result', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  expect(await page.evaluate((id) => localStorage.getItem('codes.operation.' + id), id)).toBe(
    operationId,
  );
});
test('Check result refreshes a failed subscription after proving the browser request was never recorded', async ({
  page,
}) => {
  const { id } = await fixture(page);
  await page.evaluate(
    (id) => localStorage.setItem('codes.operation.' + id, crypto.randomUUID()),
    id,
  );
  let fail = true,
    sends = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/send')) sends++;
  });
  await page.route('**/api/threads/' + id + '/snapshot', (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: {
            error: { code: 'FIXTURE_UNAVAILABLE', message: 'Synthetic snapshot unavailable.' },
          },
        })
      : route.continue(),
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Unable to load conversation', exact: true }),
  ).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect(page.locator('.connection')).toHaveText('Connected');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText('not recorded');
  expect(sends).toBe(0);
});
test('a hidden tab releases its event connection and resumes from a fresh snapshot', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = window.EventSource;
    (window as any).fixtureSources = [];
    window.EventSource = class extends Original {
      closed = false;
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        (window as any).fixtureSources.push(this);
      }
      close() {
        this.closed = true;
        super.close();
      }
    };
  });
  await fixture(page);
  await page.getByLabel('Message Codex').fill('Keep draft while the tab is hidden');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.connection')).toHaveText('Background');
  expect(
    await page.evaluate(
      () => (window as any).fixtureSources.filter((source: any) => !source.closed).length,
    ),
  ).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.connection')).toHaveText('Connected');
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep draft while the tab is hidden');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  expect(
    await page.evaluate(
      () => (window as any).fixtureSources.filter((source: any) => !source.closed).length,
    ),
  ).toBe(1);
});

test('a new conversation can retry its project subscription without a thread feed', async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  let fail = true;
  await page.route('**/api/projects/*/snapshot', (route) =>
    fail
      ? route.fulfill({
          status: 502,
          contentType: 'text/html',
          body: '<html>Proxy unavailable</html>',
        })
      : route.continue(),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('HTTP 502');
  await page.getByLabel('Message Codex').fill('Keep the new draft through reconnection');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  fail = false;
  await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
  await expect(page.locator('.connection')).toHaveText('Connected');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Message Codex')).toHaveValue(
    'Keep the new draft through reconnection',
  );
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
});
