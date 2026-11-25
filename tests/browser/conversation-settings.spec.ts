import { chooseSettingsSection } from './settings-helpers';
import { test, expect, type Page } from '@playwright/test';
const origin = 'http://127.0.0.1:19140';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('.connection')).toHaveText('Connected');
}

test.afterEach(async ({ page }) => {
  const id = await page.evaluate(() => localStorage.getItem('codes.thread')).catch(() => null);
  if (!id) return;
  const snapshot = await (await page.request.get('/api/threads/' + id + '/snapshot')).json();
  if (['running', 'waitingApproval', 'waitingInput'].includes(snapshot.thread?.state))
    await page.request.post('/api/threads/' + id + '/interrupt', {
      data: {},
      headers: { Origin: origin },
    });
});

test('native settings save without dispatch, refresh across clients and reject stale edits', async ({
  page,
  browser,
}) => {
  await login(page);
  const observer = await browser.newContext();
  const second = await observer.newPage();
  await login(second);
  const projectId = await page.evaluate(() => localStorage.getItem('codes.project'));
  const path = '/api/projects/' + projectId + '/codex-configuration';
  const before = await (await page.request.get(path)).json();
  try {
    for (const client of [page, second]) {
      await client.getByRole('button', { name: 'Interaction settings', exact: true }).click();
      await chooseSettingsSection(
        client.getByRole('dialog', { name: 'Settings' }),
        'Codex configuration',
      );
      await expect(client.getByRole('button', { name: 'Save Codex configuration' })).toBeDisabled();
    }
    await page.getByRole('textbox', { name: 'Reasoning effort', exact: true }).fill('high');
    await page.getByRole('button', { name: 'Save Codex configuration' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Effective project values' }),
    ).toBeVisible();
    await expect(page.getByTestId('message-user')).toHaveCount(0);
    await second.getByRole('textbox', { name: 'Reasoning effort', exact: true }).fill('low');
    await second.getByRole('button', { name: 'Save Codex configuration' }).click();
    await expect(second.getByRole('alert')).toContainText('Codex configuration changed');
    await second.getByRole('button', { name: 'Reload settings' }).click();
    await expect(
      second.getByRole('textbox', { name: 'Reasoning effort', exact: true }),
    ).toHaveValue('high');
    await second.keyboard.press('Escape');
    await expect(
      second.getByRole('button', { name: 'Model and reasoning', exact: true }),
    ).toContainText('high');
  } finally {
    const current = await (await page.request.get(path)).json();
    await page.request.put(path, {
      data: {
        version: current.userVersion,
        changes: { model_reasoning_effort: before.effort ?? null },
      },
      headers: { Origin: origin },
    });
    await observer.close();
  }
});

test('queued receipt checks preserve settings semantics across serialization and never resend a task', async ({
  page,
}) => {
  await login(page);
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
  await page.getByLabel('Message Codex').fill('Captured queued intent');
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
  let releaseSnapshot!: () => void;
  const waitingForSnapshot = new Promise<void>((resolve) => (releaseSnapshot = resolve));
  await page.route(
    '**/api/threads/' + id + '/snapshot',
    async (route) => {
      await waitingForSnapshot;
      await route.continue();
    },
    { times: 1 },
  );
  await page.reload();
  const check = page.getByRole('button', { name: 'Check queue receipt', exact: true });
  try {
    await expect(check).toBeDisabled();
  } finally {
    releaseSnapshot();
  }
  await check.click();
  await expect(page.getByLabel('Message Codex')).toHaveValue('');
  await expect(
    page.getByRole('region', { name: 'Queued messages', exact: true }).locator('li'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
  await page
    .getByRole('region', { name: 'Queued messages', exact: true })
    .getByRole('button', { name: 'Remove queued message', exact: true })
    .click();
  await expect(page.getByTestId('message-user')).toHaveCount(1);
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 320, height: 640 },
  { width: 390, height: 480 },
])
  test(`native settings remain reachable in both themes at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await login(page);
    await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    for (const theme of ['dark', 'light']) {
      await chooseSettingsSection(dialog, 'General');
      await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
      await chooseSettingsSection(dialog, 'Codex configuration');
      for (const name of [
        'Permission profile',
        'Model',
        'Reasoning effort',
        'Approval reviewer',
        'Service tier',
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
