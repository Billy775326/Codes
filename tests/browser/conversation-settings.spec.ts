import { test, expect, type Page } from '@playwright/test';
const origin = 'http://127.0.0.1:19140';
let restoreDefaults: unknown;
test.afterEach(async ({ page }) => {
  if (restoreDefaults) {
    const settings = restoreDefaults;
    restoreDefaults = undefined;
    const current = await (await page.request.get('/api/settings/defaults')).json();
    await page.request.put('/api/settings/defaults', {
      data: { revision: current.revision, settings },
      headers: { Origin: origin },
    });
  }
  const id = await page.evaluate(() => localStorage.getItem('codes.thread')).catch(() => null);
  if (id) {
    const response = await page.request.get('/api/threads/' + id + '/snapshot');
    const snapshot = await response.json();
    if (['running', 'waitingApproval', 'waitingInput'].includes(snapshot.thread?.state))
      await page.request.post('/api/threads/' + id + '/interrupt', {
        data: {},
        headers: { Origin: origin },
      });
  }
});

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('.connection')).toHaveText('Connected');
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toBeEnabled();
}
async function send(page: Page, text: string) {
  await page.getByLabel('Message Codex').fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  return (await page.evaluate(() => localStorage.getItem('codes.thread')))!;
}
async function permission(page: Page, name: string) {
  await page.getByRole('button', { name: 'Codex permissions', exact: true }).click();
  await page
    .getByRole('group', { name: 'Permission presets', exact: true })
    .getByRole('button', { name: new RegExp('^' + name) })
    .click();
}
async function model(page: Page, effort: string) {
  await page.getByRole('button', { name: 'Model and reasoning', exact: true }).click();
  await page.getByLabel('Model', { exact: true }).selectOption('simulated-model');
  await page.getByLabel('Reasoning effort', { exact: true }).selectOption(effort);
  await page.keyboard.press('Escape');
}
async function profile(page: Page, id: string) {
  return (await page.request.get('/api/threads/' + id + '/settings')).json();
}

test('conversation choices persist without sending and stay independent across switches and reload', async ({
  page,
}) => {
  await login(page);
  const a = 'Settings A ' + Date.now(),
    b = 'Settings B ' + Date.now();
  const first = await send(page, a);
  await permission(page, 'Ask for approval');
  await model(page, 'high');
  await page.getByRole('button', { name: 'Model and reasoning', exact: true }).click();
  await page.getByRole('switch', { name: 'Fast mode', exact: true }).check();
  await page.getByLabel('Task mode', { exact: true }).selectOption('plan');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await profile(page, first)).settings)
    .toEqual({
      permission: 'workspace-write',
      model: 'simulated-model',
      effort: 'high',
      fast: true,
      mode: 'plan',
    });
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toContainText(
    'Read only',
  );
  await expect(
    page.getByRole('button', { name: 'Model and reasoning', exact: true }),
  ).toContainText('Medium');
  const second = await send(page, b);
  await model(page, 'low');
  await page.locator('.thread-link').filter({ hasText: a }).click();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toContainText(
    'Ask for approval',
  );
  await expect(
    page.getByRole('button', { name: 'Model and reasoning', exact: true }),
  ).toContainText('High');
  await expect(page.getByRole('button', { name: 'Exit Plan mode', exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Model and reasoning', exact: true }),
  ).toContainText('High');
  expect((await profile(page, second)).settings).toMatchObject({
    permission: 'read-only',
    effort: 'low',
  });
  expect((await profile(page, first)).settings.fast).toBe(true);
  await expect(page.getByTestId('message-user')).toHaveCount(1);
});

test('new-conversation defaults persist on the server and leave an existing conversation unchanged', async ({
  page,
  browser,
}) => {
  await login(page);
  const original = await (await page.request.get('/api/settings/defaults')).json();
  restoreDefaults = original.settings;
  const id = await send(page, 'Existing defaults fixture ' + Date.now());
  const previous = await profile(page, id);
  const other = await browser.newContext();
  try {
    await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
    const section = page.getByRole('region', { name: 'New conversation defaults', exact: true });
    await section
      .getByLabel('Default permissions', { exact: true })
      .selectOption('workspace-write');
    await section.getByLabel('Default model', { exact: true }).selectOption('simulated-model');
    await section.getByLabel('Default reasoning effort', { exact: true }).selectOption('low');
    await section.getByLabel('Default task mode', { exact: true }).selectOption('plan');
    await section.getByRole('switch', { name: 'Default fast mode', exact: true }).check();
    await expect
      .poll(
        async () => (await (await page.request.get('/api/settings/defaults')).json()).settings.fast,
      )
      .toBe(true);
    await page.keyboard.press('Escape');
    expect(await profile(page, id)).toEqual(previous);
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Codex permissions', exact: true }),
    ).toContainText('Ask for approval');
    await expect(
      page.getByRole('button', { name: 'Model and reasoning', exact: true }),
    ).toContainText('Low');
    await expect(page.getByRole('button', { name: 'Exit Plan mode', exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Model and reasoning', exact: true }),
    ).toContainText('Low');
    const observer = await other.newPage();
    await login(observer);
    await expect(
      observer.getByRole('button', { name: 'Codex permissions', exact: true }),
    ).toContainText('Ask for approval');
    await expect(
      observer.getByRole('button', { name: 'Model and reasoning', exact: true }),
    ).toContainText('Low');
    await expect(observer.getByTestId('message-user')).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test('changing future settings does not reconfigure the active task or existing queued messages', async ({
  page,
}) => {
  await login(page);
  await page.getByLabel('Message Codex').fill('[hold] Active profile fixture ' + Date.now());
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
  const id = (await page.evaluate(() => localStorage.getItem('codes.thread')))!;
  await page.getByLabel('Message Codex').fill('Old queued settings');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  await permission(page, 'Ask for approval');
  await model(page, 'high');
  await page.getByLabel('Message Codex').fill('New queued settings');
  await expect(page.getByRole('button', { name: 'Add now instead', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  const snapshot = await (await page.request.get('/api/threads/' + id + '/snapshot')).json();
  expect(snapshot.thread.settings.permission).toBe('read-only');
  expect(
    snapshot.thread.queue.items.map(
      (item: { settings: { permission: string } }) => item.settings.permission,
    ),
  ).toEqual(['read-only', 'workspace-write']);
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
  const queue = page.getByRole('region', { name: 'Queued messages', exact: true });
  await queue.getByRole('button', { name: 'Remove', exact: true }).first().click();
  await queue.getByRole('button', { name: 'Remove', exact: true }).first().click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toContainText(
    'Ask for approval',
  );
  await expect(
    page.getByRole('button', { name: 'Model and reasoning', exact: true }),
  ).toContainText('High');
});

test('a late save acknowledgement cannot change another conversation', async ({ page }) => {
  await login(page);
  const a = 'Late settings A ' + Date.now(),
    b = 'Late settings B ' + Date.now();
  const first = await send(page, a);
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  const second = await send(page, b);
  await page.locator('.thread-link').filter({ hasText: a }).click();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercept = true;
  await page.route('**/api/threads/' + first + '/settings', async (route) => {
    if (route.request().method() !== 'PUT' || !intercept) return route.continue();
    intercept = false;
    const response = await route.fetch();
    await hold;
    await route.fulfill({ response });
  });
  await permission(page, 'Ask for approval');
  await expect(page.getByText('Saving conversation settings…', { exact: true })).toBeVisible();
  await page.locator('.thread-link').filter({ hasText: b }).click();
  release();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toContainText(
    'Read only',
  );
  expect((await profile(page, second)).settings.permission).toBe('read-only');
  await page.locator('.thread-link').filter({ hasText: a }).click();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toContainText(
    'Ask for approval',
  );
});

for (const queueAnotherChoice of [false, true])
  test(`a remote update during a delayed save preserves revision ordering (queued=${queueAnotherChoice})`, async ({
    page,
  }) => {
    await login(page);
    const id = await send(page, 'Concurrent settings ' + Date.now());
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let intercept = true;
    await page.route('**/api/threads/' + id + '/settings', async (route) => {
      if (route.request().method() !== 'PUT' || !intercept) return route.continue();
      intercept = false;
      const response = await route.fetch();
      await hold;
      await route.fulfill({ response });
    });
    await permission(page, 'Ask for approval');
    await expect(page.getByText('Saving conversation settings…', { exact: true })).toBeVisible();
    if (queueAnotherChoice) await permission(page, 'Read only');
    const saved = await profile(page, id);
    const remote = await page.request.put('/api/threads/' + id + '/settings', {
      data: { revision: saved.revision, settings: { permission: 'danger-full-access' } },
      headers: { Origin: origin },
    });
    expect(remote.status()).toBe(200);
    release();
    if (queueAnotherChoice) {
      await expect(
        page.getByRole('button', { name: 'Reload settings', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Reload settings', exact: true }).click();
    }
    await expect(
      page.getByRole('button', { name: 'Codex permissions', exact: true }),
    ).toContainText('Full access');
    expect((await profile(page, id)).settings.permission).toBe('danger-full-access');
    await expect(page.getByTestId('message-user')).toHaveCount(1);
  });

test('a lost save response is confirmed by reading without creating task receipts', async ({
  page,
}) => {
  await login(page);
  const id = await send(page, 'Lost settings response ' + Date.now());
  let writes = 0;
  let intercept = true;
  await page.route('**/api/threads/' + id + '/settings', async (route) => {
    if (route.request().method() !== 'PUT' || !intercept) return route.continue();
    intercept = false;
    writes++;
    await route.fetch();
    await route.abort();
  });
  await permission(page, 'Ask for approval');
  await page.getByLabel('Message Codex').fill('Unsent follow-up');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(
    page.getByText('A request may still be running. Check before continuing.', { exact: true }),
  ).toHaveCount(0);
  expect(writes).toBe(1);
  expect((await profile(page, id)).settings.permission).toBe('workspace-write');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
});

test('queued receipt checks preserve settings semantics across serialization and never resend a task', async ({
  page,
}) => {
  await login(page);
  await model(page, 'high');
  await page.getByLabel('Message Codex').fill('[hold] Settings receipt fixture ' + Date.now());
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
  const id = (await page.evaluate(() => localStorage.getItem('codes.thread')))!;
  let intercept = true;
  await page.route('**/api/threads/' + id + '/queue', async (route) => {
    if (route.request().method() !== 'POST' || !intercept) return route.continue();
    intercept = false;
    await route.fetch();
    await route.abort();
  });
  await page.getByLabel('Message Codex').fill('Captured pending settings');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Check queue receipt', exact: true }),
  ).toBeVisible();
  await page.evaluate((id) => {
    const key = 'codes.queue-request.' + id;
    const record = JSON.parse(localStorage.getItem(key)!);
    const { permission, ...other } = record.payload.settings;
    record.payload.settings = { permission, ...other };
    localStorage.setItem(key, JSON.stringify(record));
  }, id);
  await page.reload();
  await page.getByRole('button', { name: 'Check queue receipt', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toHaveValue('');
  await expect(
    page.getByRole('region', { name: 'Queued messages', exact: true }).locator('li'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
  await page
    .getByRole('region', { name: 'Queued messages', exact: true })
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  await expect(page.getByTestId('message-user')).toHaveCount(1);
});

test('failed saves block dispatch and allow explicit retry', async ({ page }) => {
  await login(page);
  const id = await send(page, 'Failed settings save ' + Date.now());
  let intercept = true;
  await page.route('**/api/threads/' + id + '/settings', async (route) => {
    if (route.request().method() !== 'PUT' || !intercept) return route.continue();
    intercept = false;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Fixture unavailable' } }),
    });
  });
  await permission(page, 'Ask for approval');
  await page.getByLabel('Message Codex').fill('Keep this unsent draft');
  await expect(page.getByRole('button', { name: 'Retry settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep this unsent draft');
  expect((await profile(page, id)).settings.permission).toBe('workspace-write');
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 320, height: 640 },
  { width: 390, height: 480 },
])
  test(`default settings remain reachable in both themes at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await login(page);
    await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Interaction settings', exact: true });
    for (const theme of ['dark', 'light']) {
      await page.getByLabel('Workspace theme', { exact: true }).selectOption(theme);
      for (const name of [
        'Default permissions',
        'Default model',
        'Default reasoning effort',
        'Default task mode',
        'Default fast mode',
      ]) {
        const control = dialog.getByLabel(name, { exact: true });
        await control.scrollIntoViewIfNeeded();
        expect(
          await control.evaluate((element) => {
            const b = element.getBoundingClientRect();
            const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            return hit === element || element.contains(hit);
          }),
        ).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `test-results/default-settings-${viewport.width}-${theme}.png`,
        fullPage: true,
      });
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
