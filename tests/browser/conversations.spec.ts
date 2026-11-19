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
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
}
async function rename(page: Page, old: string, title: string) {
  await page.getByRole('button', { name: 'Actions for ' + old, exact: true }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Conversation title', { exact: true }).fill(title);
  await page.getByLabel('Conversation title', { exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
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
  await page.getByLabel('Search conversations', { exact: true }).fill(renamed.toUpperCase());
  await expect(page.locator('.thread-link')).toHaveCount(1);
  await expect(page.getByRole('button', { name: renamed, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Actions for ' + renamed, exact: true }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Archive conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: renamed, exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Message Codex')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(renamed);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep this unsent draft');
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(page.getByRole('button', { name: renamed, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore conversation', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).not.toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Active', exact: true }).click();
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
  await page.getByLabel('Project', { exact: true }).selectOption(fixture.id);
  await expect(page.locator('.thread-link')).toHaveCount(30);
  await expect(
    page.getByRole('button', { name: 'Fixture conversation 249', exact: true }),
  ).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.getByRole('button', { name: 'Next conversation page' }).click();
    await expect(page.locator('.conversation-pagination')).toContainText('Page ' + (i + 2));
    await expect(page.getByRole('navigation', { name: 'Conversations' })).toHaveAttribute(
      'aria-busy',
      'false',
    );
  }
  await expect(page.locator('.thread-link')).toHaveCount(10);
  await expect(
    page.getByRole('button', { name: 'Fixture conversation 0', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Previous conversation page' }).click();
  await expect(page.locator('.conversation-pagination')).toContainText('Page 8');
  await page.getByLabel('Search conversations', { exact: true }).fill('FIXTURE CONVERSATION 0');
  // Searches scan at most four native pages per request. Continue through sparse results.
  await expect(page.getByRole('navigation', { name: 'Conversations' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect(page.locator('.conversation-pagination')).toContainText('Page 1');
  for (
    let i = 0;
    i < 2 &&
    !(await page.getByRole('button', { name: 'Fixture conversation 0', exact: true }).count());
    i++
  ) {
    await page.getByRole('button', { name: 'Next conversation page' }).click();
    await expect(page.getByRole('navigation', { name: 'Conversations' })).toHaveAttribute(
      'aria-busy',
      'false',
    );
  }
  await expect(
    page.getByRole('button', { name: 'Fixture conversation 0', exact: true }),
  ).toBeVisible();
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
    await owner.locator('.connection').click();
    await expect(owner.locator('.connection')).toHaveText('Connected');
    await observer.getByRole('button', { name: title, exact: true }).click();
    const newTitle = 'Active renamed ' + Date.now();
    const id = await owner.evaluate(() => localStorage.getItem('codes.thread'));
    await rename(owner, title, newTitle);
    await expect(observer.getByRole('heading', { level: 1 })).toHaveText(newTitle);
    expect(
      await owner.evaluate((id) => localStorage.getItem('codes.operation.' + id), id),
    ).toBeTruthy();
    await owner.getByRole('button', { name: 'Actions for ' + newTitle, exact: true }).click();
    await expect(owner.getByRole('button', { name: 'Archive', exact: true })).toBeDisabled();
    await observer.getByRole('button', { name: 'Decline', exact: true }).click();
    await expect(owner.getByText('Stopped', { exact: true })).toBeVisible();
    await owner.getByRole('button', { name: 'Archive', exact: true }).click();
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
test('mobile row actions and archive confirmation fit narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await create(page, 'Mobile managed ' + Date.now());
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const row = page.locator('.conversation-row.selected');
  await row.getByRole('button', { name: 'Actions for', exact: false }).click();
  await row.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Archive this conversation?', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await page
    .getByRole('dialog', { name: 'Archive this conversation?', exact: true })
    .boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(320);
  await page.screenshot({
    path: 'test-results/conversation-management-mobile.png',
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Archive this conversation?', exact: true }),
  ).toHaveCount(0);
});

test('a delayed list response cannot undo a title already received through live events', async ({
  page,
}) => {
  await login(page);
  const title = 'List race fixture ' + Date.now();
  await create(page, title);
  await expect(page.getByRole('navigation', { name: 'Conversations' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  let captured!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/api/projects/*/conversations?**',
    async (route) => {
      const response = await route.fetch();
      captured();
      await paused;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Refresh conversations' }).click();
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
  await expect(page.getByRole('navigation', { name: 'Conversations' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect(page.getByRole('button', { name: renamed, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0);
});
