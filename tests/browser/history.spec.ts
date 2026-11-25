import { reconnectUpdates } from './sidebar-helpers';
import { expect, test, type Page } from '@playwright/test';
import type { Action, Message, Snapshot } from '../../src/shared/types';
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
async function fixture(page: Page, actions: Omit<Action, 'threadId'>[] = []) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByLabel('Message Codex').fill('Synthetic latest navigation fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  const base: Snapshot = await page.evaluate(async () =>
    (await fetch('/api/threads/' + localStorage.getItem('codes.thread') + '/snapshot')).json(),
  );
  base.thread.messages = messages(0, 239);
  base.thread.turnId = 'history-turn-119';
  base.thread.turns = [];
  base.thread.olderCursor = 'older-1';
  base.thread.actions = actions.map((action) => ({ ...action, threadId: base.thread.id }));
  await page.route('**/api/threads/*/snapshot', (route) => route.fulfill({ json: base }));
  await page.reload();
  await expect(page.getByText('Recent answer 239', { exact: true })).toBeVisible();
  return base;
}

test('a long active turn keeps the original prompt in history without recreating it at the bottom', async ({
  page,
}) => {
  const base = await fixture(page);
  const turnId = 'long-active-turn';
  const prompt: Message = {
    id: 'native-long-prompt',
    clientId: 'long-prompt-operation',
    turnId,
    kind: 'user',
    text: 'Review this long task',
  };
  const work: Message[] = Array.from({ length: 245 }, (_, index) => ({
    id: 'long-task-command-' + index,
    turnId,
    kind: 'command',
    text: `Activity ${index}`,
    status: 'completed',
  }));
  const commentary: Message = {
    id: 'long-task-progress',
    turnId,
    kind: 'assistant',
    phase: 'commentary',
    text: [
      'The long task is still working.',
      ...Array(32).fill('Additional progress details.'),
    ].join('\n\n'),
  };
  base.thread.state = 'running';
  base.thread.turnId = turnId;
  base.thread.turns = [{ id: turnId, status: 'inProgress', startedAtMs: Date.now() }];
  base.thread.pending = {
    id: prompt.clientId!,
    kind: 'send',
    state: 'dispatching',
    text: prompt.text,
  };
  base.thread.messages = [];
  const bubbles = page.getByTestId('message-user').filter({ hasText: prompt.text });
  const timeline = page.getByRole('region', { name: 'Conversation timeline', exact: true });
  const bar = page.getByRole('button', { name: /^Turn message/ });
  const jump = page.getByRole('button', { name: 'Go to original message', exact: true });
  const detail = timeline.locator('.turn-prompt-detail');
  const scrollToEnd = () => timeline.evaluate((entry) => (entry.scrollTop = entry.scrollHeight));
  await reconnectUpdates(page);
  await expect(bubbles).toHaveCount(1);
  await expect(bubbles).toHaveAttribute('data-message-id', prompt.clientId!);

  base.thread.pending = { ...base.thread.pending, state: 'acknowledged', turnId };
  const older = 'earlier-long-turn';
  base.thread.messages = [
    { id: 'older-prompt', turnId: older, kind: 'user', text: 'Earlier request' },
    { ...commentary, id: 'older-answer', turnId: older, phase: 'final_answer' },
    prompt,
    commentary,
  ];
  await reconnectUpdates(page);
  await expect(bubbles).toHaveCount(1);
  await expect(bubbles).toHaveAttribute('data-message-id', prompt.id);
  await bubbles.evaluate((entry) => entry.scrollIntoView({ block: 'start' }));
  await expect(bar).toHaveCount(0);
  await scrollToEnd();
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-expanded', 'false');
  await expect(jump).toBeVisible();
  await expect(detail).toBeHidden();
  expect((await bar.boundingBox())!.y).toBeCloseTo((await timeline.boundingBox())!.y + 1, 0);
  await bar.press('Space');
  await expect(bar).toHaveAttribute('aria-expanded', 'true');
  await expect(bar).not.toContainText(prompt.text);
  await expect(detail).toContainText(prompt.text);
  await expect(jump).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar).toBeFocused();
  await expect(bar).toHaveAttribute('aria-expanded', 'false');
  await bar.click();
  await page
    .getByTestId('message-assistant')
    .first()
    .evaluate((entry) => {
      entry.scrollIntoView({ block: 'start' });
    });
  await expect(bar).toContainText('Earlier request');
  await expect(bar).toHaveAttribute('aria-expanded', 'false');
  await expect(detail).toBeHidden();
  await scrollToEnd();
  await expect(bar).toContainText(prompt.text);
  await expect(bar).toHaveAttribute('aria-expanded', 'false');
  await jump.click();
  await expect(bubbles).toBeFocused();
  await expect(bar).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();
  base.thread.messages = [prompt, ...work, commentary];
  await reconnectUpdates(page);
  await scrollToEnd();
  await expect(page.getByText('The long task is still working.', { exact: true })).toBeVisible();
  await expect(page.getByText('239 activities', { exact: true }).first()).toBeVisible();
  await expect(bubbles).toHaveCount(0);
  await expect(bar).toContainText(prompt.text);

  await page.route('**/api/threads/*/history?cursor=*', (route) =>
    route.fulfill({ json: { messages: [prompt, ...work.slice(0, 9)], olderCursor: null } }),
  );
  const toggleBounds = (await bar.boundingBox())!;
  const jumpBounds = (await jump.boundingBox())!;
  expect(jumpBounds.y).toBeCloseTo(toggleBounds.y, 0);
  expect(jumpBounds.x).toBeGreaterThanOrEqual(toggleBounds.x + toggleBounds.width - 0.5);
  expect(jumpBounds.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(detail).toBeHidden();
  await jump.click();
  await expect(bubbles).toHaveCount(1);
  await expect(bubbles).toHaveAttribute('data-message-id', prompt.id);
  await expect(bubbles).toBeFocused();
  await expect(
    page.locator('[data-turn-id="long-active-turn"]').getByTestId('message-user'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to latest messages', exact: true }).click();
  await expect(bubbles).toHaveCount(0);
});

test('the pinned message follows confirmed same-turn input and jumps to that message', async ({
  page,
}) => {
  const base = await fixture(page);
  const turnId = 'follow-up-pinned-turn';
  const first: Message = {
    id: 'first-turn-user',
    clientId: 'first-send-operation',
    turnId,
    kind: 'user',
    text: 'Original task instructions',
  };
  const later: Message = {
    id: 'confirmed-follow-up',
    clientId: 'steer-operation',
    turnId,
    kind: 'user',
    text: 'Confirmed new instructions in the same turn',
  };
  const progress: Message = {
    id: 'long-work',
    turnId,
    kind: 'assistant',
    phase: 'commentary',
    text: Array(60).fill('Task progress continues.').join('\n\n'),
  };
  base.thread.state = 'running';
  base.thread.turnId = turnId;
  base.thread.turns = [{ id: turnId, status: 'inProgress', startedAtMs: Date.now() }];
  base.thread.pending = {
    id: first.clientId!,
    turnId,
    kind: 'send',
    state: 'acknowledged',
    text: first.text,
  };
  base.thread.messages = [first, progress];
  const timeline = page.getByRole('region', { name: 'Conversation timeline', exact: true });
  const end = () => timeline.evaluate((node) => (node.scrollTop = node.scrollHeight));
  const bar = page.getByRole('button', { name: /^Turn message/ });
  await reconnectUpdates(page);
  await end();
  await expect(bar).toContainText(first.text);
  base.thread.steering = [
    {
      id: 'unconfirmed-steer',
      threadId: base.thread.id,
      kind: 'steer',
      turnId,
      state: 'unknown',
      text: 'Unconfirmed instructions',
    },
  ];
  await reconnectUpdates(page);
  await end();
  await expect(bar).toContainText(first.text);
  base.thread.steering = [
    {
      id: later.clientId!,
      threadId: base.thread.id,
      kind: 'steer',
      turnId,
      state: 'acknowledged',
      text: later.text,
    },
  ];
  await reconnectUpdates(page);
  await end();
  await expect(bar).toContainText(later.text);
  await expect(bar).not.toContainText(first.text);
  await expect(
    page.getByRole('button', { name: 'Go to original message', exact: true }),
  ).toHaveCount(0);
  base.thread.steering[0]!.text = later.text.slice(0, 20);
  base.thread.messages = [first, progress, later, { ...progress, id: 'after-follow-up' }];
  await reconnectUpdates(page);
  await end();
  await expect(bar).toContainText(later.text);
  await expect(bar).not.toContainText(first.text);
  base.thread.steering = [];
  await reconnectUpdates(page);
  await end();
  await expect(bar).toContainText(later.text);
  await bar.click();
  const detail = timeline.locator('.turn-prompt-detail');
  await expect(detail).toContainText(later.text);
  await expect(detail).not.toContainText(first.text);
  await page.getByRole('button', { name: 'Go to original message', exact: true }).click();
  await expect(page.getByTestId('message-user').filter({ hasText: later.text })).toBeFocused();
  await page.reload();
  await end();
  await expect(bar).toContainText(later.text);
});

test('an answered question appears only when its original turn is loaded', async ({ page }) => {
  await fixture(page, [
    {
      id: 'old-answered-question',
      turnId: 'history-turn--1',
      afterMessageId: 'history-item--2',
      kind: 'questions',
      title: 'Codex question',
      detail: '',
      decisions: [],
      async: true,
      blocking: false,
      status: 'answered',
      questions: [{ id: 'mode', question: 'Which mode should I use?' }],
      submittedAnswers: { mode: 'Use local mode' },
    },
  ]);
  await page.route('**/api/threads/*/history?cursor=*', (route) =>
    route.fulfill({ json: { messages: messages(-24, -1), olderCursor: null, turns: [] } }),
  );
  const question = page.getByRole('region', { name: 'Codex question', exact: true });
  await expect(question).toHaveCount(0);
  await page.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
  const originalTurn = page.locator('.turn').filter({ hasText: 'Recent answer -1' });
  await expect(originalTurn.getByRole('region', { name: 'Codex question' })).toContainText(
    'Answer: Use local mode',
  );
  await expect(question).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to latest messages', exact: true }).click();
  await expect(question).toHaveCount(0);
});
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
      'Earlier messages',
    );
    await expect(page.getByText('Recent answer 239', { exact: true })).toHaveCount(1);
    await expect(page.locator('[data-message-id]')).toHaveCount(264);
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
    await expect(
      page.locator('.turn-status').getByText('Completed', { exact: true }),
    ).toBeVisible();
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
  await expect(page.locator('[data-message-id]')).toHaveCount(288);
  await expect(load).toBeEnabled();
  base.thread.messages = [...base.thread.messages.slice(2), ...messages(240, 241)];
  base.thread.turnId = 'history-turn-120';
  await reconnectUpdates(page);
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
  await expect(page.getByRole('heading', { name: 'New conversation', exact: true })).toBeVisible();
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
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await expect(
    page.getByTestId('message-user').filter({ hasText: 'Continue from the latest native turn' }),
  ).toHaveCount(1);
  await expect(page.getByTestId('message-assistant').last()).toContainText('simulated response');
  await expect(page.getByLabel('Message Codex')).toHaveValue('');
});
