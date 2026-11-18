import { expect, test, type Page } from '@playwright/test';
import type { Message, Snapshot } from '../../src/shared/types';
function messages(first: number, last: number): Message[] {
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const n = first + index;
    return {
      id: 'history-item-' + n,
      turnId: 'history-turn-' + Math.floor(n / 2),
      kind: n % 2 ? 'assistant' : 'user',
      text: (n % 2 ? 'Recent answer ' : 'Earlier prompt ') + n,
    };
  });
}
async function fixture(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByLabel('Message Codex').fill('Synthetic latest navigation fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  const base: Snapshot = await page.evaluate(async () =>
    (await fetch('/api/threads/' + localStorage.getItem('codes.thread') + '/snapshot')).json(),
  );
  base.thread.messages = messages(0, 239);
  base.thread.turnId = 'history-turn-119';
  base.thread.turns = [];
  base.thread.olderCursor = 'older-1';
  await page.route('**/api/threads/*/snapshot', (route) => route.fulfill({ json: base }));
  await page.reload();
  await expect(page.getByText('Recent answer 239', { exact: true })).toBeVisible();
  return base;
}
for (const width of [1440, 390])
  test(`older history stays bounded and new live messages remain one click away at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const base = await fixture(page);
    await page.route('**/api/threads/*/history?cursor=*', (route) =>
      route.fulfill({
        json: {
          messages: messages(-24, -1),
          olderCursor: 'older-2',
          turns: [],
        },
      }),
    );
    await page.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Conversation position' })).toContainText(
      'Viewing earlier messages',
    );
    await expect(page.getByText('Recent answer 239', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-message-id]')).toHaveCount(240);
    await page.getByLabel('Message Codex').fill('Keep this reading draft');
    // Another client sends through the isolated simulator; the browsing window must not replace live data.
    await page.evaluate(async (id) => {
      const response = await fetch('/api/threads/' + id + '/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          text: 'New response while reading history',
          settings: { permission: 'read-only' },
          attachments: [],
        }),
      });
      if (!response.ok) throw new Error('Fixture send failed');
    }, base.thread.id);
    await expect(page.getByRole('status', { name: 'Conversation position' })).toContainText(
      'New activity',
    );
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    const back = page.getByRole('button', { name: 'Back to latest messages', exact: true });
    const bounds = await back.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await back.click();
    await expect(
      page.getByTestId('message-user').filter({ hasText: 'New response while reading history' }),
    ).toHaveCount(1);
    await expect(page.getByText('Recent answer 239', { exact: true })).toHaveCount(1);
    await expect(page.getByLabel('Message Codex')).toHaveValue('Keep this reading draft');
    await expect(page.getByRole('status', { name: 'Conversation position' })).toHaveCount(0);
    await expect
      .poll(() =>
        page
          .locator('.conversation')
          .evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight),
      )
      .toBeLessThan(5);
    await page.screenshot({ path: `test-results/history-latest-${width}.png`, fullPage: true });
  });

test('history can continue paging at the display limit, survives reconnect, and returns to the latest snapshot', async ({
  page,
}) => {
  const base = await fixture(page);
  let pages = 0;
  await page.route('**/api/threads/*/history?cursor=*', (route) => {
    pages++;
    return route.fulfill({
      json: {
        messages: messages(-24 * pages, -24 * (pages - 1) - 1),
        turns: [],
        olderCursor: 'older-' + (pages + 1),
      },
    });
  });
  const load = page.getByRole('button', { name: 'Load earlier messages', exact: true });
  await load.click();
  await expect(page.getByText('Earlier prompt -24', { exact: true })).toHaveCount(1);
  await load.click();
  await expect(page.getByText('Earlier prompt -48', { exact: true })).toHaveCount(1);
  await expect(page.locator('[data-message-id]')).toHaveCount(240);
  await expect(load).toBeEnabled();
  base.thread.messages = [...base.thread.messages.slice(2), ...messages(240, 241)];
  base.thread.turnId = 'history-turn-120';
  await page.locator('.connection').click();
  await expect(page.locator('.connection')).toHaveText('Connected');
  await expect(page.getByText('Earlier prompt -48', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('status', { name: 'Conversation position' })).toContainText(
    'New activity',
  );
  await page.getByRole('button', { name: 'Back to latest messages', exact: true }).click();
  await expect(page.getByText('Recent answer 241', { exact: true })).toBeVisible();
  await expect(page.getByText('Earlier prompt -48', { exact: true })).toHaveCount(0);
});

test('a late history response cannot enter a different conversation or block its composer', async ({
  page,
}) => {
  await fixture(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/threads/*/history?cursor=*', async (route) => {
    await pending;
    await route.fulfill({ json: { messages: messages(-24, -1), olderCursor: null } });
  });
  const request = page.waitForRequest((request) => request.url().includes('/history?cursor='));
  await page.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
  await request;
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled(); // Empty draft only.
  await page.getByLabel('Message Codex').fill('Sending remains available while history loads');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.getByLabel('Message Codex').fill('Keep the new conversation draft');
  release();
  await expect(page.getByRole('heading', { name: 'Ask Codex', exact: true })).toBeVisible();
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep the new conversation draft');
  await expect(page.getByRole('status', { name: 'Conversation position' })).toHaveCount(0);
});

test('sending from an older window returns to the live reply and keeps the new turn visible', async ({
  page,
}) => {
  await fixture(page);
  await page.route('**/api/threads/*/history?cursor=*', (route) =>
    route.fulfill({ json: { messages: messages(-24, -1), olderCursor: null } }),
  );
  await page.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Conversation position' })).toBeVisible();
  await page.unroute('**/api/threads/*/snapshot');
  await page.getByLabel('Message Codex').fill('Continue from the latest native turn');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Conversation position' })).toHaveCount(0);
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await expect(
    page.getByTestId('message-user').filter({ hasText: 'Continue from the latest native turn' }),
  ).toHaveCount(1);
  await expect(page.getByTestId('message-assistant').last()).toContainText('simulated response');
  await expect(page.getByLabel('Message Codex')).toHaveValue('');
});
