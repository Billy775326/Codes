import { execFileSync } from 'node:child_process';
import { chooseWorkingDirectory, conversationList } from './sidebar-helpers';
import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const origin = 'http://127.0.0.1:19140';
const threads: string[] = [];
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('.connection')).toHaveText('Connected');
}
async function navigation(page: Page) {
  const open = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await open.isVisible()) await open.click();
}
function row(page: Page, id: string) {
  return conversationList(page).locator('[data-conversation-id="' + id + '"]');
}
async function fixture(page: Page) {
  const projects = await (await page.request.get('/api/projects')).json();
  const a = projects.find((project: { name: string }) => project.name === 'sample-project');
  const path = join(a.path, 'conversation-fixtures', 'context-' + randomUUID());
  await mkdir(path);
  await writeFile(join(path, 'example.ts'), 'export const project = "BETA_SOURCE";\n');
  const response = await page.request.post('/api/projects', {
    data: { path, name: 'zz Context ' + randomUUID() },
    headers: { Origin: origin },
  });
  expect(response.ok()).toBe(true);
  const b = await response.json();
  async function conversation(project: { id: string }, title: string) {
    const created = await (
      await page.request.post('/api/projects/' + project.id + '/threads', {
        data: {},
        headers: { Origin: origin },
      })
    ).json();
    threads.push(created.id);
    const sent = await page.request.post('/api/threads/' + created.id + '/send', {
      data: {
        operationId: randomUUID(),
        text: title,
        settings: { permission: 'read-only' },
        attachments: [],
      },
      headers: { Origin: origin },
    });
    expect(sent.ok()).toBe(true);
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/threads/' + created.id + '/snapshot')).json()).thread
            .state,
      )
      .toBe('completed');
    return { ...created, title };
  }
  const first = await conversation(a, 'Alpha context ' + randomUUID());
  const second = await conversation(b, 'Beta context ' + randomUUID());
  return { a, b, first, second, path, conversation };
}
test.afterEach(async ({ page }) => {
  for (const id of threads.splice(0))
    await page.request.post('/api/threads/' + id + '/interrupt', {
      data: {},
      headers: { Origin: origin },
    });
});
test('native archive changes appear in another browser and restoration keeps the working directory', async ({
  page,
  browser,
}) => {
  await login(page);
  const { second, path } = await fixture(page);
  await page.reload();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(row(page, second.id)).toContainText(path);
  const observerContext = await browser.newContext();
  try {
    const observer = await observerContext.newPage();
    await login(observer);
    await observer.getByRole('button', { name: 'All', exact: true }).click();
    await expect(row(observer, second.id)).toBeVisible();
    await row(page, second.id)
      .getByRole('button', { name: 'Archive ' + second.title, exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Archive conversation', exact: true })
      .click();
    await expect(row(page, second.id)).toHaveCount(0);
    await expect(row(observer, second.id)).toHaveCount(0);
    await observer.getByRole('button', { name: 'Archived', exact: true }).click();
    await expect(row(observer, second.id)).toContainText(path);
    await row(observer, second.id)
      .getByRole('button', { name: 'Restore and resume ' + second.title, exact: true })
      .click();
    await expect(observer.getByRole('button', { name: 'Active', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(observer.getByRole('heading', { level: 1 })).toHaveText(second.title);
    await expect(observer.locator('.workspace-directory')).toHaveText(path);
  } finally {
    await observerContext.close();
  }
});
for (const width of [1440, 390])
  test(
    'a stale workspace selection follows the native conversation directory at ' + width,
    async ({ page }) => {
      await page.setViewportSize({ width, height: 950 });
      await login(page);
      const { a, second, path } = await fixture(page);
      await page.evaluate(
        ({ a, second }) => {
          localStorage.setItem('codes.project', a.id);
          localStorage.setItem('codes.thread', second.id);
        },
        { a, second },
      );
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.title);
      await navigation(page);
      await expect(
        row(page, second.id).getByRole('button', { name: second.title, exact: true }),
      ).toHaveAttribute('aria-current', 'page');
      await expect(row(page, second.id).locator('.session-cwd')).toHaveCount(0);
      if (width < 1100)
        await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
      await page.getByRole('button', { name: 'Browse files', exact: true }).click();
      await page.getByRole('button', { name: 'example.ts', exact: true }).click();
      await expect(page.locator('.file-preview')).toContainText('BETA_SOURCE');
      await expect(page.locator('.file-preview')).not.toContainText('export function hello');
      await page.screenshot({
        path: 'test-results/project-owner-' + width + '.png',
        fullPage: true,
      });
    },
  );
test('switching native conversations preserves drafts, running work, and the queue', async ({
  page,
}) => {
  await login(page);
  const { first, second, path } = await fixture(page);
  await page.reload();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await row(page, first.id).getByRole('button', { name: first.title, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.title);
  await page.getByLabel('Message Codex').fill('[hold] Native conversation task');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
  const before = await (await page.request.get('/api/threads/' + first.id + '/snapshot')).json();
  await page.getByLabel('Message Codex').fill('Waiting in the first conversation');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  await page.getByLabel('Message Codex').fill('First draft');
  await row(page, second.id).getByRole('button', { name: second.title, exact: true }).click();
  await expect(page.locator('.workspace-directory')).toHaveText(path);
  await expect(row(page, first.id).locator('.conversation-status')).toHaveText('Running');
  await page.getByLabel('Message Codex').fill('Second draft');
  await row(page, first.id).getByRole('button', { name: first.title, exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toHaveValue('First draft');
  const after = await (await page.request.get('/api/threads/' + first.id + '/snapshot')).json();
  expect(after.thread.turnId).toBe(before.thread.turnId);
  expect(after.thread.state).toBe('running');
  expect(after.thread.queue.items).toEqual([
    expect.objectContaining({ text: 'Waiting in the first conversation', state: 'queued' }),
  ]);
  await row(page, second.id).getByRole('button', { name: second.title, exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Second draft');
  await page.reload();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Second draft');
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New conversation');
  await expect(page.getByRole('button', { name: 'Change working directory' })).toHaveText(path);
  const title = 'Draft in current cwd ' + randomUUID();
  await page.getByLabel('Message Codex').fill(title);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  const summary = conversationList(page).getByRole('button', { name: title, exact: true });
  await expect(summary).toBeVisible();
  await expect(page.locator('.workspace-directory')).toHaveText(path);
});
test('missing directories preserve history and block execution until explicit retry after restoration', async ({
  page,
}) => {
  await login(page);
  const { b, second, path } = await fixture(page);
  await page.evaluate(
    ({ b, second }) => {
      localStorage.setItem('codes.project', b.id);
      localStorage.setItem('codes.thread', second.id);
    },
    { b, second },
  );
  await rename(path, path + '-moved');
  try {
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.title);
    await expect(page.locator('.directory-unavailable')).toContainText('directory is unavailable');
    await page.getByLabel('Message Codex').fill('Keep this draft while the folder is missing');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Browse files', exact: true })).toBeDisabled();
    const response = await page.request.post('/api/threads/' + second.id + '/send', {
      data: {
        operationId: randomUUID(),
        text: 'No execution',
        settings: { permission: 'read-only' },
        attachments: [],
      },
      headers: { Origin: origin },
    });
    expect(response.status()).toBe(409);
    expect((await response.json()).error.code).toBe('DIRECTORY_UNAVAILABLE');
  } finally {
    await rename(path + '-moved', path);
  }
  await page.getByRole('button', { name: 'Retry directory', exact: true }).click();
  await expect(page.locator('.directory-unavailable')).toHaveCount(0);
  await expect(page.getByLabel('Message Codex')).toHaveValue(
    'Keep this draft while the folder is missing',
  );
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Browse files', exact: true }).click();
  await page.getByRole('button', { name: 'example.ts', exact: true }).click();
  await expect(page.locator('.file-preview')).toContainText('BETA_SOURCE');
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.getByLabel('Message Codex').fill('[hold] Directory queue recovery');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
  await page.getByLabel('Message Codex').fill('Retain this queued follow-up');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  await rename(path, path + '-moved');
  try {
    await page.reload();
    await expect(page.locator('.directory-unavailable')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add queued message to current task', exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
    const snapshot = await (
      await page.request.get('/api/threads/' + second.id + '/snapshot')
    ).json();
    const queued = snapshot.thread.queue.items.find(
      (entry: { state: string }) => entry.state === 'queued',
    );
    const denied = await page.request.post(
      '/api/threads/' + second.id + '/queue/' + queued.id + '/steer',
      { data: { expectedTurnId: snapshot.thread.turnId }, headers: { Origin: origin } },
    );
    expect(denied.status()).toBe(409);
    expect(
      (await (await page.request.get('/api/threads/' + second.id + '/queue')).json()).items.find(
        (entry: { id: string }) => entry.id === queued.id,
      ).state,
    ).toBe('queued');
  } finally {
    await rename(path + '-moved', path);
  }
});
test('All discovers both directories, Cwd follows the current conversation, and sort/search use native pages', async ({
  page,
}) => {
  await login(page);
  const { a, first, second, path } = await fixture(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Cwd', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(row(page, first.id)).toBeVisible();
  await expect(row(page, first.id).locator('.session-cwd')).toHaveCount(0);
  await expect(row(page, second.id)).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(row(page, first.id)).toContainText(a.path);
  await expect(row(page, second.id)).toContainText(path);
  await row(page, second.id).getByRole('button', { name: second.title, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.title);
  await page.getByRole('button', { name: 'Cwd', exact: true }).click();
  await expect(row(page, first.id)).toHaveCount(0);
  await expect(row(page, second.id)).toBeVisible();
  const directoryPage = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === '/api/conversations' &&
      url.searchParams.get('cwd') === path &&
      url.searchParams.get('sort') === 'created_at'
    );
  });
  await page.getByRole('combobox', { name: 'Sort conversations' }).selectOption('created_at');
  await directoryPage;
  await expect(row(page, second.id).locator('time')).toHaveAttribute('title', /^Created:/);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  const search = page.getByLabel('Search conversations');
  await search.fill(first.title.toUpperCase());
  await expect(row(page, second.id)).toHaveCount(0);
  await expect(row(page, first.id)).toBeVisible();
  await search.fill('no match ' + randomUUID());
  await expect(conversationList(page)).toContainText('No conversations');
  await page.goto('/?conversation=' + second.id);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.title);
  await expect(page.locator('.workspace-directory')).toHaveText(path);
});

test('working-directory choice validates the path and reuses a canonical directory', async ({
  page,
}) => {
  await login(page);
  const registered = () => page.request.get('/api/projects').then((response) => response.json());
  const original = (await registered()).find(
    (item: { name: string }) => item.name === 'sample-project',
  );
  const path = join(original.path, 'conversation-fixtures', 'draft-' + randomUUID());
  const alias = path + '-alias';
  await mkdir(path);
  await symlink(path, alias);
  const trigger = page.getByRole('button', { name: 'Change working directory', exact: true });
  const picker = page.getByRole('dialog', { name: 'Choose a working directory', exact: true });
  await trigger.click();
  const input = picker.getByLabel('Working directory', { exact: true });
  const useDirectory = picker.getByRole('button', { name: 'Use directory', exact: true });
  await expect(input).toBeFocused();
  await input.fill('.');
  await expect(useDirectory).toBeDisabled();
  await input.fill(path + '-missing');
  await useDirectory.click();
  await expect(picker.getByRole('alert')).toContainText('Choose an existing');
  await input.fill(path);
  await useDirectory.click();
  await expect(picker).toHaveCount(0);
  await expect(trigger).toHaveText(path);
  const draft = page.getByLabel('Message Codex');
  await draft.fill('Keep the current draft');
  await chooseWorkingDirectory(page, alias);
  await expect(trigger).toHaveText(path);
  await expect(draft).toHaveValue('Keep the current draft');
  expect((await registered()).filter((item: { path: string }) => item.path === path)).toHaveLength(
    1,
  );
});

test('an installation without a selected directory can browse and choose one for its first draft', async ({
  page,
}) => {
  await login(page);
  const dirs = await (await page.request.get('/api/projects')).json();
  const initial = dirs.find((item: { name: string }) => item.name === 'sample-project');
  await page.route('**/api/projects', (route) => route.fulfill({ json: [] }));
  await page.evaluate(() => {
    localStorage.removeItem('codes.project');
    localStorage.removeItem('codes.thread');
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Cwd', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a working directory' });
  await expect(picker).toBeVisible();
  await picker.getByLabel('Working directory', { exact: true }).fill(initial.path);
  await picker.getByRole('button', { name: 'Browse directories', exact: true }).click();
  await picker.getByRole('button', { name: 'conversation-fixtures', exact: true }).click();
  await picker.getByRole('button', { name: 'Use directory', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Change working directory' })).toHaveText(
    join(initial.path, 'conversation-fixtures'),
  );
});

test('Repo includes linked worktrees and shows only the other worktree path', async ({ page }) => {
  await login(page);
  const { b, second, path, conversation } = await fixture(page);
  const linked = path + '-linked';
  const git = (...args: string[]) => execFileSync('git', args, { cwd: path, stdio: 'ignore' });
  git('init', '-q');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'Fixture',
  );
  git('worktree', 'add', '-qb', 'fixture-linked', linked);
  const workspace = await (
    await page.request.post('/api/conversations/directory', {
      data: { path: linked },
      headers: { Origin: origin },
    })
  ).json();
  const linkedThread = await conversation(workspace, 'Linked conversation ' + randomUUID());
  await page.goto('/?conversation=' + second.id);
  await expect(page.locator('.workspace-directory')).toHaveText(path);
  await expect(row(page, linkedThread.id)).toHaveCount(0);
  await page.getByRole('button', { name: 'Repo', exact: true }).click();
  await expect(row(page, second.id).locator('.session-cwd')).toHaveCount(0);
  await expect(row(page, linkedThread.id).locator('.session-cwd')).toHaveText(linked);
  const active = await page.request.get('/api/conversations?cwd=' + encodeURIComponent(path));
  expect((await active.json()).data).toEqual([
    expect.objectContaining({ id: second.id, projectId: b.id }),
  ]);
});
