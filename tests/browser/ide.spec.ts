import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toBeEnabled();
}
async function send(page: Page, text: string) {
  await page.getByLabel('Message Codex').fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}
async function stop(page: Page) {
  await page.getByRole('button', { name: 'Stop task' }).click();
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
}

test('native model, reasoning and Plan mode survive reconnect and expose real plan/context metadata', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Model and reasoning', exact: true }).click();
  await page.getByLabel('Model', { exact: true }).selectOption('simulated-model');
  await page.getByLabel('Reasoning effort').selectOption('high');
  await page.keyboard.press('Escape');
  await page.getByLabel('Message Codex').fill('/plan');
  await page.getByLabel('Message Codex').press('Enter');
  const request = page.waitForRequest(
    (request) => request.url().endsWith('/send') && request.method() === 'POST',
  );
  await send(page, 'Plan mode fixture ' + Date.now());
  expect((await request).postDataJSON().settings).toMatchObject({
    mode: 'plan',
    effort: 'high',
    model: 'simulated-model',
  });
  await expect(page.getByRole('region', { name: 'Task plan' })).toContainText('Propose a change');
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('button', { name: 'Session status', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Session status' });
  await expect(dialog).toContainText('1,200 / 128,000 tokens');
  await expect(dialog).toContainText('3,400 tokens');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Exit Plan mode', exact: true })).toBeVisible();
  await expect(page.getByLabel('Reasoning effort')).toHaveValue('high');
  await page.getByRole('button', { name: 'Exit Plan mode', exact: true }).click();
  await send(page, 'Return to Code mode');
  await expect(page.getByRole('region', { name: 'Task plan' })).toHaveCount(0);
});

test('Ctrl+Shift+Enter steers once, queue Send now joins the same turn, and drafts survive lost HTTP receipts', async ({
  page,
}) => {
  await login(page);
  await send(page, '[slow] Immediate follow-up fixture ' + Date.now());
  const origin = page.getByTestId('message-user').first();
  // A pending bubble uses the client operation UUID until a native item arrives.
  await expect(origin).toHaveAttribute('data-turn-id', /.+/);
  const first = await origin.getAttribute('data-message-id');
  const turnId = await origin.getAttribute('data-turn-id');
  await page.getByLabel('Message Codex').fill('Use the smaller approach');
  await expect(page.getByRole('button', { name: 'Queue message', exact: true })).toBeEnabled();
  await page.getByLabel('Message Codex').press('Control+Shift+Enter');
  await expect(page.getByTestId('message-user')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Immediate follow-ups' })).toContainText(
    'Added to current task',
  );
  await page.getByLabel('Message Codex').fill('Queued then promoted');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Queued messages' });
  await queue
    .getByRole('button', { name: 'Add queued message to current task', exact: true })
    .click();
  await expect(page.getByTestId('message-user')).toHaveCount(3);
  await expect(page.getByTestId('message-user').first()).toHaveAttribute('data-message-id', first!);
  for (const entry of await page.getByTestId('message-user').all())
    await expect(entry).toHaveAttribute('data-turn-id', turnId!);
  await page.getByRole('button', { name: 'Interaction settings' }).click();
  await page.getByLabel('Follow-up behavior').selectOption('steer');
  await page.keyboard.press('Escape');
  await page.route(
    '**/api/threads/*/steer',
    async (route) => {
      await route.fetch();
      await route.abort();
    },
    { times: 1 },
  );
  await page.getByLabel('Message Codex').fill('Only accepted once');
  await page.getByRole('button', { name: 'Add to current task', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Check follow-up receipt', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Check follow-up receipt', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toHaveValue('');
  await expect(page.getByTestId('message-user')).toHaveCount(4);
  await stop(page);
  await expect(page.getByRole('region', { name: 'Immediate follow-ups' })).toHaveCount(0);
});

test('queue/steer inversion, multiline Enter preferences, and Ctrl+N preserve the old draft', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Interaction settings' }).click();
  await page.getByLabel('Enter behavior').selectOption('cmdIfMultiline');
  await page.getByLabel('Follow-up behavior').selectOption('steer');
  await page.keyboard.press('Escape');
  await send(page, '[slow] Inverted queue fixture ' + Date.now());
  await page.getByLabel('Message Codex').fill('Queue with reverse shortcut');
  await expect(
    page.getByRole('button', { name: 'Add to current task', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Message Codex').press('Control+Shift+Enter');
  await expect(page.getByRole('region', { name: 'Queued messages' })).toContainText(
    'Queue with reverse shortcut',
  );
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await stop(page);
  await page.getByLabel('Message Codex').fill('First line\nSecond line');
  await page.getByLabel('Message Codex').press('Enter');
  await expect(page.getByLabel('Message Codex')).toHaveValue('First line\nSecond line\n');
  await page.getByLabel('Message Codex').press('Control+n');
  await expect(page.getByTestId('message-user')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Interaction settings' }).click();
  await expect(page.getByLabel('Enter behavior')).toHaveValue('cmdIfMultiline');
});

test('review uses native targets inline and in a separate conversation while preserving the source', async ({
  page,
}) => {
  await login(page);
  await send(page, 'Review source fixture ' + Date.now());
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  const source = await page.evaluate(() => localStorage.getItem('codes.thread'));
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('button', { name: 'Review code', exact: true }).click();
  await page.getByLabel('Review target').selectOption('baseBranch');
  await page.getByLabel('Review details').fill('main');
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Simulated review:', { exact: false })).toContainText('baseBranch');
  expect(await page.evaluate(() => localStorage.getItem('codes.thread'))).toBe(source);
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('button', { name: 'Review code', exact: true }).click();
  await page.getByLabel('Review delivery', { exact: true }).selectOption('detached');
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Simulated review:', { exact: false })).toContainText(
    'uncommittedChanges',
  );
  expect(await page.evaluate(() => localStorage.getItem('codes.thread'))).not.toBe(source);
  await expect(page.getByTestId('message-user')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toHaveText(
    'Read only',
  );
});

test('slash commands perform local actions and unknown commands never reach the model', async ({
  page,
}) => {
  await login(page);
  await page.getByLabel('Message Codex').fill('/plan');
  await page
    .getByRole('group', { name: 'Commands', exact: true })
    .getByRole('button', { name: '/plan' })
    .click();
  await expect(page.getByRole('button', { name: 'Exit Plan mode', exact: true })).toBeVisible();
  await page.getByLabel('Message Codex').fill('/status');
  await page.getByLabel('Message Codex').press('Enter');
  await expect(page.getByRole('dialog', { name: 'Session status' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByLabel('Message Codex').fill('/unsupported');
  await page.getByLabel('Message Codex').press('Enter');
  await expect(page.getByRole('alert')).toContainText('Unknown command');
  await expect(page.getByTestId('message-user')).toHaveCount(0);
});

test('new controls, review dialog and phone keyboard fit a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByLabel('Message Codex').fill('Phone draft');
  await page.getByLabel('Message Codex').press('Enter');
  await expect(page.getByLabel('Message Codex')).toHaveValue('Phone draft\n');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('button', { name: 'Review code', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/ide-mobile-review.png', fullPage: true });
});

for (const phase of ['create', 'send', 'queue', 'steer'] as const) {
  test(`a delayed ${phase} response preserves a newer follow-up draft`, async ({ page }) => {
    await login(page);
    if (phase === 'queue' || phase === 'steer') {
      await send(page, '[slow] Follow-up receipt ' + phase + ' ' + Date.now());
      await expect(page.getByRole('button', { name: 'Stop task' })).toBeEnabled();
    }
    let release!: () => void, accepted!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const processed = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    const pattern = phase === 'create' ? '**/api/projects/*/threads' : '**/api/threads/*/' + phase;
    await page.route(
      pattern,
      async (route) => {
        const response = await route.fetch();
        accepted();
        await hold;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    try {
      const text = '[slow] Original draft ' + phase + ' ' + Date.now();
      if (phase === 'create' || phase === 'send') await send(page, text);
      else {
        await page.getByLabel('Message Codex').fill(text);
        if (phase === 'queue')
          await page.getByRole('button', { name: 'Queue message', exact: true }).click();
        else await page.getByLabel('Message Codex').press('Control+Shift+Enter');
      }
      await processed;
      await page.getByLabel('Message Codex').fill('Keep the next draft after ' + phase);
      release();
      await expect(page.getByRole('button', { name: 'Queue message', exact: true })).toBeEnabled();
      await expect(page.getByLabel('Message Codex')).toHaveValue(
        'Keep the next draft after ' + phase,
      );
      if (phase === 'create' || phase === 'send')
        await expect(page.getByTestId('message-user').first()).toContainText(text);
      await stop(page);
    } finally {
      release();
    }
  });
}
