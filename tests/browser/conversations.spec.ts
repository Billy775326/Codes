import { activeProjectCard, projectCard, reconnectUpdates } from './sidebar-helpers';
import { test, expect, type Page } from '@playwright/test';
const token = 'test-only-browser-token-not-a-real-secret';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill(token);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toBeVisible();
}
async function create(page: Page, title: string) {
  if (
    (page.viewportSize()?.width ?? 1440) <= 1099 &&
    (await page.getByRole('button', { name: 'Close navigation', exact: true }).isVisible())
  )
    await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.getByLabel('Message Codex').fill(title);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
}
async function rename(page: Page, old: string, title: string) {
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText(old);
  const trigger = page.getByRole('button', { name: 'Rename conversation', exact: true });
  await trigger.click();
  const input = page.getByRole('textbox', { name: 'Conversation title', exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(old);
  await input.fill(title);
  await input.press('Enter');
  await expect(heading).toHaveText(title);
  await expect(trigger).toBeFocused();
}
test('rename, search, draft preservation, archive, reload, and restoration keep native history', async ({
  page,
}) => {
  await login(page);
  const first = 'Conversation fixture ' + Date.now();
  const renamed = 'Renamed fixture ' + Date.now();
  await create(page, first);
  await page.getByLabel('Message Codex').fill('Keep this unsent draft');
  await create(page, 'Second fixture ' + Date.now());
  await page.getByRole('button', { name: first, exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep this unsent draft');
  await rename(page, first, renamed);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(renamed);
  await page.getByRole('button', { name: renamed, exact: true }).click();
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep this unsent draft');
  await page.getByLabel('Search projects and chats', { exact: true }).fill(renamed.toUpperCase());
  await expect(page.locator('.thread-link')).toHaveCount(1);
  await expect(page.getByRole('button', { name: renamed, exact: true })).toBeVisible();
  await expect(page.locator('.conversation-row.selected').getByRole('button')).toHaveCount(2);
  const archive = page.getByRole('button', { name: 'Archive ' + renamed, exact: true });
  await archive.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(renamed);
  await expect(page.getByRole('dialog')).toContainText('Restore from Archived projects and chats.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(archive).toBeFocused();
  await archive.click();
  await page.getByRole('button', { name: 'Archive conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: renamed, exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Message Codex')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(renamed);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep this unsent draft');
  const archives = page.getByRole('button', { name: 'Archived projects and chats', exact: true });
  await archives.click();
  await expect(page.getByRole('button', { name: renamed, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore ' + renamed, exact: true }).click();
  await expect(page.getByLabel('Message Codex')).not.toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await archives.click();
  await expect(page.getByRole('button', { name: renamed, exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/conversation-management-desktop.png',
    fullPage: true,
  });
});
test('native cursor navigation reaches conversations beyond the local 200-summary window', async ({
  page,
}) => {
  await login(page);
  const fixture = await page.evaluate(async () => {
    const projects = await (await fetch('/api/projects')).json();
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: projects[0].path + '/conversation-fixtures',
        name: 'zz Conversation fixtures',
      }),
    });
    const fixture = await response.json();
    await fetch('/api/projects/' + fixture.id + '/seed-conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ count: 250 }),
    });
    return fixture;
  });
  await page.reload();
  const card = projectCard(page, fixture.id);
  const projectName = card.getByRole('button', { name: fixture.name, exact: true });
  const disclosure = card.locator('.project-card-disclosure');
  await expect(projectName).toHaveAttribute('aria-expanded', 'false');
  await expect(disclosure).toHaveAccessibleName('Expand ' + fixture.name);
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(card.getByRole('button')).toHaveCount(2);
  await expect(card.locator('.thread-link')).toHaveCount(0);
  await projectName.press('Enter');
  await expect(card.locator('.thread-link')).toHaveCount(30);
  await expect(card.locator('h3')).toHaveCount(0);
  await expect(
    card.getByRole('button', { name: 'Fixture conversation 249', exact: true }),
  ).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await card.getByRole('button', { name: 'Next conversation page' }).click();
    await expect(card.locator('.conversation-pagination')).toContainText('Page ' + (i + 2));
    await expect(card).toHaveAttribute('aria-busy', 'false');
  }
  await expect(card.locator('.thread-link')).toHaveCount(10);
  await expect(
    card.getByRole('button', { name: 'Fixture conversation 0', exact: true }),
  ).toBeVisible();
  await card.getByRole('button', { name: 'Previous conversation page' }).click();
  await expect(card.locator('.conversation-pagination')).toContainText('Page 8');
  await expect(disclosure).toHaveAccessibleName('Collapse ' + fixture.name);
  await disclosure.press('Space');
  await expect(projectName).toHaveAttribute('aria-expanded', 'false');
  await expect(disclosure).toBeFocused();
  await expect(disclosure).toHaveAccessibleName('Expand ' + fixture.name);
  await page
    .getByLabel('Search projects and chats', { exact: true })
    .fill('FIXTURE CONVERSATION 0');
  // Searches scan at most four native pages per request. Continue through sparse results.
  await expect(card).toHaveAttribute('aria-busy', 'false');
  await expect(card.locator('.conversation-pagination')).toContainText('Page 1');
  for (
    let i = 0;
    i < 2 &&
    !(await card.getByRole('button', { name: 'Fixture conversation 0', exact: true }).count());
    i++
  ) {
    await card.getByRole('button', { name: 'Next conversation page' }).click();
    await expect(card).toHaveAttribute('aria-busy', 'false');
  }
  await expect(
    card.getByRole('button', { name: 'Fixture conversation 0', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
});
test('another client sees metadata changes, and renaming never clears a live execution receipt', async ({
  browser,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const owner = await first.newPage();
    const observer = await second.newPage();
    await login(owner);
    await login(observer);
    // Force the summary handoff gap: selection must seed navigation from its snapshot.
    await owner.route('**/api/events?threadId=*', (route) => route.abort());
    const title = '[approve] Managed task ' + Date.now();
    await owner.getByLabel('Message Codex').fill(title);
    await owner.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(owner.getByRole('button', { name: 'Approve once' })).toBeVisible();
    await expect(owner.getByRole('button', { name: title, exact: true })).toBeVisible();
    await owner.unroute('**/api/events?threadId=*');
    await reconnectUpdates(owner);
    await expect(owner.locator('.connection')).toHaveText('Connected');
    await observer.getByRole('button', { name: title, exact: true }).click();
    await owner.bringToFront();
    const newTitle = 'Active renamed ' + Date.now();
    const id = await owner.evaluate(() => localStorage.getItem('codes.thread'));
    await rename(owner, title, newTitle);
    await expect(observer.getByRole('heading', { level: 1 })).toHaveText(newTitle);
    expect(
      await owner.evaluate((id) => localStorage.getItem('codes.operation.' + id), id),
    ).toBeTruthy();
    const archive = owner.getByRole('button', { name: 'Archive ' + newTitle, exact: true });
    await expect(archive).toBeDisabled();
    await observer.getByRole('button', { name: 'Decline', exact: true }).click();
    await expect(owner.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
    await archive.click();
    await owner.getByRole('button', { name: 'Archive conversation', exact: true }).click();
    await expect(
      observer.getByRole('button', { name: 'Restore conversation', exact: true }),
    ).toBeVisible();
    await expect(observer.getByLabel('Message Codex')).toHaveAttribute('readonly', '');
  } finally {
    await first.close();
    await second.close();
  }
});
test.describe('touch sidebar controls', () => {
  test.use({ hasTouch: true });
  test('mobile row actions and archive confirmation fit narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    const original = 'Mobile managed ' + Date.now();
    const title = 'A longer mobile conversation title that needs to wrap in the archive dialog';
    await create(page, original);
    await page.setViewportSize({ width: 320, height: 740 });
    const edit = page.getByRole('button', { name: 'Rename conversation', exact: true });
    await edit.tap();
    await page.getByRole('textbox', { name: 'Conversation title' }).press('Escape');
    await expect(edit).toBeFocused();
    await rename(page, original, title);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const card = activeProjectCard(page);
    const projectName = await card.locator('.project-card-name').innerText();
    await card.getByRole('button', { name: 'Project actions for ' + projectName }).tap();
    const projectActions = card.getByRole('group', { name: 'Project actions: ' + projectName });
    await expect(projectActions).toBeInViewport();
    for (const label of ['Rename', 'Pin', 'Archive project']) {
      const action = projectActions.getByRole('button', { name: label, exact: true });
      await expect(action.getByText(label, { exact: true })).toBeVisible();
      expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(40);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Workspace navigation' })).toBeVisible();
    await expect(projectActions).toHaveCount(0);
    await expect(
      card.getByRole('button', { name: 'Project actions for ' + projectName }),
    ).toBeFocused();
    const archive = page.getByRole('button', { name: 'Archive ' + title, exact: true });
    await expect(archive).toBeVisible();
    expect((await archive.boundingBox())?.height).toBeGreaterThanOrEqual(40);
    await archive.tap();
    await expect(
      page.getByRole('dialog', { name: 'Archive this conversation?', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const dialog = page.getByRole('dialog', { name: 'Archive this conversation?', exact: true });
    const bounds = await dialog.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(320);
    const cancel = await dialog.getByRole('button', { name: 'Cancel', exact: true }).boundingBox();
    const confirm = await dialog
      .getByRole('button', { name: 'Archive conversation', exact: true })
      .boundingBox();
    expect(confirm?.y).toBe(cancel?.y);
    await page.screenshot({
      path: 'test-results/conversation-management-mobile.png',
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Archive this conversation?', exact: true }),
    ).toHaveCount(0);
  });
});

test('a delayed list response cannot undo a title already received through live events', async ({
  page,
}) => {
  await login(page);
  const title = 'List race fixture ' + Date.now();
  await create(page, title);
  await expect(activeProjectCard(page)).toHaveAttribute('aria-busy', 'false');
  let captured!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const owner = await page.evaluate(() => localStorage.getItem('codes.project'));
  await page.route(
    '**/api/projects/' + owner + '/conversations?**',
    async (route) => {
      const response = await route.fetch();
      captured();
      await paused;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Refresh projects and chats' }).click();
  await ready;
  const renamed = 'Live event wins ' + Date.now();
  try {
    await page.evaluate(async (name) => {
      const id = localStorage.getItem('codes.thread');
      const response = await fetch('/api/threads/' + id + '/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operationId: crypto.randomUUID(), name }),
      });
      if (!response.ok) throw new Error('Fixture rename failed');
    }, renamed);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(renamed);
  } finally {
    release();
  }
  await expect(activeProjectCard(page)).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: renamed, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0);
});

test('sidebar keeps task and paused queue status across selection, reload, themes and narrow layouts', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await login(page);
  const title = '[approve] Sidebar status ' + Date.now();
  await page.getByLabel('Message Codex').fill(title);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  const row = page
    .locator('.conversation-row')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
  await expect(row.locator('.conversation-status')).toHaveText('Needs approval');
  await expect
    .poll(() =>
      row
        .locator('.conversation-status')
        .evaluate((status) => getComputedStyle(status, '::before').animationName),
    )
    .toBe('none');
  await expect(row.locator('.conversation-status')).toHaveAttribute('data-indicator', 'approval');
  await expect(row.locator('.thread-link')).toHaveAccessibleDescription(/Needs approval.*Updated:/);
  await expect(row.locator('time')).toHaveAttribute('datetime', /T/);
  await page.getByLabel('Message Codex').fill('Waiting sidebar follow-up');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  await page.evaluate(async () => {
    const id = localStorage.getItem('codes.thread');
    const response = await fetch('/api/threads/' + id + '/queue/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: true }),
    });
    if (!response.ok) throw new Error('Queue pause failed');
  });
  await expect(row.locator('.conversation-queue')).toHaveText('1 in queue · Paused');
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(row.locator('.conversation-status')).toHaveText('Needs approval');
  await row.getByRole('button', { name: title, exact: true }).click();
  await page.reload();
  await expect(row.locator('.conversation-status')).toHaveText('Needs approval');
  await expect(row.locator('.conversation-queue')).toHaveText('1 in queue · Paused');
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await page.keyboard.press('Escape');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      // Wait for the media-query state before acting: after growing to desktop,
      // a previous phone's Open button can disappear on the next resize event.
      if (width <= 1099) {
        const open = page.getByRole('button', { name: 'Open navigation', exact: true });
        await expect(open).toBeVisible();
        await open.click();
      } else {
        await expect(
          page.getByRole('complementary', { name: 'Workspace navigation' }),
        ).toBeVisible();
      }
      await expect(row.locator('.conversation-status')).toBeVisible();
      await expect
        .poll(async () => {
          const bounds = await row.boundingBox();
          return !!bounds && bounds.x >= 0 && bounds.x + bounds.width <= width;
        })
        .toBe(true);
      expect(await row.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/sidebar-${theme}-${width}.png` });
      const close = page.getByRole('button', { name: 'Close navigation', exact: true });
      if (width <= 1099 && (await close.isVisible())) await close.click();
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(row.locator('.conversation-status')).toHaveText('Stopped');
  await expect(row.locator('.conversation-queue')).toHaveText('1 in queue · Paused');
  const queue = page.getByRole('region', { name: 'Queued messages', exact: true });
  await queue.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(row.locator('.conversation-queue')).toHaveCount(0);
});

test('the running dot pulses only while live updates and motion are enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await login(page);
  const title = '[hold] Sidebar running indicator ' + Date.now();
  await page.getByLabel('Message Codex').fill(title);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const status = page
    .locator('.conversation-row')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) })
    .locator('.conversation-status');
  const animation = () =>
    status.evaluate((element) => getComputedStyle(element, '::before').animationName);
  await expect(status).toHaveText('Running');
  await expect.poll(animation).toBe('sidebar-activity-pulse');
  await expect(status).toHaveCSS('color', 'rgb(85, 204, 255)');
  await expect
    .poll(() => status.evaluate((el) => getComputedStyle(el, '::before').width))
    .toBe('8px');
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await expect(status).toHaveCSS('color', 'rgb(0, 93, 156)');

  let resume!: () => void;
  const reconnect = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await page.route(
    '**/api/threads/*/snapshot',
    async (route) => {
      await reconnect;
      await route.continue();
    },
    { times: 1 },
  );
  try {
    await reconnectUpdates(page);
    await expect(status).toHaveText('Running');
    await expect.poll(animation).toBe('none');
  } finally {
    resume();
  }
  await expect.poll(animation).toBe('sidebar-activity-pulse');

  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(status).toBeVisible();
  await expect.poll(animation).toBe('sidebar-activity-pulse');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(animation).toBe('none');
  await expect(status).toHaveText('Running');

  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(status).toHaveText('Stopped');
  await expect.poll(animation).toBe('none');
});

test('sidebar preserves search and statuses while disconnected and reconciles its page on reconnect', async ({
  page,
}) => {
  await login(page);
  const title = 'Sidebar reconnect ' + Date.now();
  await create(page, title);
  await page.getByLabel('Search projects and chats', { exact: true }).fill(title);
  await expect(page.locator('.thread-link')).toHaveCount(1);
  const row = page
    .locator('.conversation-row')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
  await expect(row.locator('.conversation-status')).toBeVisible();
  await expect(row.locator('.conversation-status')).toHaveText('Completed');
  // Simulate a resumed browser connection and hold the new snapshot.
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route(
    '**/api/threads/*/snapshot',
    async (route) => {
      const response = await route.fetch();
      captured();
      await held;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await reconnectUpdates(page);
  await ready;
  await expect(page.locator('.connection')).toHaveText('Connecting');
  await expect(page.getByRole('button', { name: 'Reconnect updates', exact: true })).toHaveCount(0);
  await expect(row.locator('.conversation-status')).toHaveText('Completed');
  const list = page.waitForResponse(
    (response) => response.url().includes('/conversations?') && response.status() === 200,
  );
  release();
  await list;
  await expect(page.locator('.connection')).toHaveText('Connected');
  await expect(page.getByRole('button', { name: 'Reconnect updates', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Search projects and chats', { exact: true })).toHaveValue(title);
  await expect(row.locator('.conversation-status')).toHaveText('Completed');
  expect(
    await page.evaluate(
      () =>
        performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/events?'))
          .length,
    ),
  ).toBeLessThanOrEqual(3);
});
