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
test('long running conversations scroll inside the workspace at desktop and phone widths', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('switch', { name: 'Scroll with replies', exact: true }).uncheck();
  await settings.getByRole('button', { name: 'Done', exact: true }).click();
  await send(
    page,
    '[hold] Long scroll fixture\n\n' + 'A long message stays inside the transcript.\n\n'.repeat(65),
  );
  const status = page.getByRole('status', { name: 'Running', exact: true });
  await expect(status).toBeVisible();
  await expect(page.getByTestId('message-assistant').last()).toContainText(
    'You can continue the conversation, attach a file, or start a separate task.',
  );
  const transcript = page.locator('.conversation');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 720 });
    const metrics = await status.evaluate((element) => {
      const conversation = element.closest('.conversation')!;
      conversation.scrollTop = 0;
      window.scrollTo(0, document.documentElement.scrollHeight);
      return {
        pageScroll: window.scrollY,
        documentHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        transcriptScrollable: conversation.scrollHeight > conversation.clientHeight,
        statusTop: element.getBoundingClientRect().top,
      };
    });
    expect(metrics.pageScroll).toBe(0);
    expect(metrics.documentHeight).toBe(metrics.viewportHeight);
    expect(metrics.transcriptScrollable).toBe(true);
    expect(metrics.statusTop).toBeGreaterThan(metrics.viewportHeight);
    await transcript.evaluate((element) => (element.scrollTop = element.scrollHeight));
    await expect(status).toBeInViewport();
    await expect(page.getByLabel('Message Codex')).toBeInViewport({ ratio: 1 });
  }
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
  await expect(status).toHaveCount(0);
});
test('desktop layout, streamed response, reload, and file selection context', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await expect(page.getByRole('heading', { name: 'New conversation' })).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop-workspace.png', fullPage: true });
  await page.getByRole('button', { name: 'Browse files' }).click();
  await page.getByRole('button', { name: 'example.ts', exact: true }).click();
  await page
    .getByRole('group', { name: 'File lines', exact: true })
    .getByRole('button')
    .first()
    .click();
  await page.getByRole('button', { name: /^Attach lines/ }).click();
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
test('reload from the workspace header restores the draft and keeps a running turn', async ({
  page,
}) => {
  await login(page);
  const prompt = '[hold] Reload button fixture';
  const draft = 'Keep this draft when reloading';
  await send(page, prompt);
  await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeVisible();
  await page.getByLabel('Message Codex').fill(draft);
  const reload = page.getByRole('button', { name: 'Reload page', exact: true });
  await reload.hover();
  await expect(page.locator('.control-tooltip')).toHaveText('Reload page');
  let duplicateDispatches = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/send')) duplicateDispatches++;
  });

  const loaded = page.waitForEvent('domcontentloaded');
  await reload.click();
  await loaded;
  await expect(page.getByTestId('message-user')).toHaveText(/Reload button fixture/);
  await expect(page.getByLabel('Message Codex')).toHaveValue(draft);
  await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeVisible();
  expect(duplicateDispatches).toBe(0);
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 740 });
  await expect(reload).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.getByRole('button', { name: 'Browse files', exact: true }).click();
  await page.getByRole('button', { name: 'example.ts', exact: true }).click();
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  const confirm = page.waitForEvent('dialog').then(async (dialog) => {
    expect(dialog.message()).toContain('Unsent attachments');
    await dialog.dismiss();
  });
  await reload.click();
  await confirm;
  await expect(page.getByRole('button', { name: 'Remove example.ts', exact: true })).toBeVisible();
  await expect(page.getByLabel('Message Codex')).toHaveValue(draft);
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
  const id = await page.evaluate(() => localStorage.getItem('codes.thread'));
  expect(id).toBeTruthy();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New conversation' })).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop-after-history.png' });

  const conversation = page.locator('.thread-link').filter({ hasText: 'Rendering reference' });
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => (release = resolve));
  const snapshot = '**/api/threads/' + id + '/snapshot';
  await page.route(snapshot, async (route) => {
    await delayed;
    const response = await route.fetch();
    const payload = await response.json();
    const last = payload.thread.messages.findLast(
      (item: { kind: string }) => item.kind === 'assistant',
    );
    last.text = 'The synchronized reply is current.';
    await route.fulfill({ json: payload });
  });
  try {
    const reading = page.waitForRequest((request) =>
      request.url().endsWith('/threads/' + id + '/snapshot'),
    );
    await conversation.click();
    await reading;
    await expect(
      page.getByRole('heading', { name: 'Rendering reference', exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('message-assistant')).toHaveCount(12);
    await expect(page.getByLabel('Message Codex')).toHaveValue(
      'Typing remains responsive in a long conversation',
    );
    await page.getByLabel('Message Codex').fill('Draft edited during synchronization');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await expect(page.getByText('The synchronized reply is current.', { exact: true })).toHaveCount(
      0,
    );
  } finally {
    release();
  }
  await expect(page.getByText('The synchronized reply is current.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Draft edited during synchronization');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.unroute(snapshot);
  await page.route(snapshot, (route) =>
    route.fulfill({
      status: 403,
      json: { error: { code: 'PROJECT_OWNERSHIP', message: 'Conversation access changed.' } },
    }),
  );
  await conversation.click();
  await expect(page.getByRole('heading', { name: 'Unable to load conversation' })).toBeVisible();
  await expect(page.getByTestId('message-assistant')).toHaveCount(0);
});

test('offers a reload for a new web build without replacing the current draft', async ({
  page,
}) => {
  await page.route('**/api/web-build', (route) =>
    route.fulfill({ json: { signature: '/assets/current-build-fixture.js' } }),
  );
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  const composer = page.getByLabel('Message Codex');
  await composer.fill('Keep this draft during the update');
  await expect(
    page.getByRole('button', { name: 'Reload to apply update', exact: true }),
  ).toBeVisible();
  await expect(composer).toHaveValue('Keep this draft during the update');
});
