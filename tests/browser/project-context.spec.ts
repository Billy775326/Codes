import { openProject, projectCard } from './sidebar-helpers';
import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile, rename } from 'node:fs/promises';
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
  if (!(await page.locator('.project-card-name[aria-current="true"]').isVisible()))
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
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
  return { a, b, first, second, path };
}
test.afterEach(async ({ page }) => {
  for (const id of threads.splice(0))
    await page.request.post('/api/threads/' + id + '/interrupt', {
      data: {},
      headers: { Origin: origin },
    });
});
for (const width of [1440, 390])
  test(
    'a stale project selection follows the verified conversation owner at ' + width,
    async ({ page }) => {
      await page.setViewportSize({ width, height: 950 });
      await login(page);
      const { a, b, second } = await fixture(page);
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
      await expect(projectCard(page, b.id).locator('.project-card-name')).toHaveAttribute(
        'aria-current',
        'true',
      );
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
test('projects restore their last conversation and draft without cancelling running tasks or queued work', async ({
  page,
}) => {
  await login(page);
  const { a, b, first, second } = await fixture(page);
  await page.evaluate(
    ({ a, first }) => {
      localStorage.setItem('codes.project', a.id);
      localStorage.setItem('codes.thread', first.id);
    },
    { a, first },
  );
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.title);
  const cardA = projectCard(page, a.id);
  const cardB = projectCard(page, b.id);
  await expect(cardA.getByRole('button', { name: first.title, exact: true })).toBeVisible();
  await expect(cardB.getByRole('button', { name: second.title, exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Codex permissions', exact: true }).click();
  await page.getByRole('button', { name: /^Ask for approval Edit/ }).click();
  await page.getByLabel('Message Codex').fill('[hold] Project task');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
  const before = await (await page.request.get('/api/threads/' + first.id + '/snapshot')).json();
  await page.getByLabel('Message Codex').fill('Waiting in project A');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  await page.getByLabel('Message Codex').fill('Draft A stays here');
  await cardB.getByRole('button', { name: second.title, exact: true }).click();
  await expect(cardB.locator('.project-card-name')).toHaveAttribute('aria-current', 'true');
  await expect(
    cardA.locator('[data-conversation-id="' + first.id + '"] .conversation-status'),
  ).toHaveText('Running');
  await page.getByLabel('Message Codex').fill('Draft B stays here');
  await openProject(page, a.id);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Draft A stays here');
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toContainText(
    'Ask for approval',
  );
  const after = await (await page.request.get('/api/threads/' + first.id + '/snapshot')).json();
  expect(after.thread.turnId).toBe(before.thread.turnId);
  expect(after.thread.state).toBe('running');
  expect(
    after.thread.queue.items.some((entry: { state: string }) => entry.state === 'queued'),
  ).toBe(true);
  await openProject(page, b.id);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.title);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Draft B stays here');
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toContainText(
    'Read only',
  );
  await page.reload();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Draft B stays here');
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.getByLabel('Message Codex').fill('New draft B');
  await openProject(page, a.id);
  await openProject(page, b.id);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New conversation');
  await expect(page.getByLabel('Message Codex')).toHaveValue('New draft B');
  await openProject(page, a.id);
  await cardB.getByRole('button', { name: 'New conversation in ' + b.name, exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toHaveValue('New draft B');
  const additional = 'Additional conversation in project B';
  await page.getByLabel('Message Codex').fill(additional);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(additional);
  await expect(cardB.getByRole('button', { name: additional, exact: true })).toBeVisible();
  await expect(cardB.getByRole('button', { name: second.title, exact: true })).toBeVisible();
  await expect(cardA.getByRole('button', { name: additional, exact: true })).toHaveCount(0);
  const stopped = await page.request.post('/api/threads/' + first.id + '/interrupt', {
    data: {},
    headers: { Origin: origin },
  });
  expect(stopped.ok()).toBe(true);
  await expect(
    cardA.locator('[data-conversation-id="' + first.id + '"] .conversation-status'),
  ).toHaveText('Stopped');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(additional);
});
test('a stale remembered conversation cannot silently switch away from an explicitly chosen project', async ({
  page,
}) => {
  await login(page);
  const { a, b, second } = await fixture(page);
  await page.evaluate(
    ({ a, b, second }) => {
      localStorage.setItem('codes.project', b.id);
      localStorage.setItem('codes.thread', second.id);
      localStorage.setItem('codes.project-views', JSON.stringify({ [a.id]: second.id }));
    },
    { a, b, second },
  );
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.title);
  await openProject(page, a.id);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New conversation');
  await expect(projectCard(page, a.id).locator('.project-card-name')).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(
    page.getByText('The saved conversation belongs to another project. Choose a conversation.', {
      exact: true,
    }),
  ).toBeVisible();
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
test('project cards follow conversation recency across live updates and search', async ({
  page,
}) => {
  await login(page);
  const { a, b, first, second } = await fixture(page);
  const path = join(a.path, 'conversation-fixtures', 'empty-' + randomUUID());
  await mkdir(path);
  const added = await page.request.post('/api/projects', {
    data: { path, name: 'zz 0 Empty project' },
    headers: { Origin: origin },
  });
  expect(added.ok()).toBe(true);
  const empty = await added.json();
  await page.reload();
  await projectCard(page, b.id).getByRole('button', { name: second.title, exact: true }).click();
  const cards = page
    .getByRole('navigation', { name: 'Conversations', exact: true })
    .locator('.project-card');
  const ids = [a.id, b.id, empty.id];
  const order = () =>
    cards.evaluateAll(
      (elements, ids) =>
        elements
          .map((element) => element.getAttribute('data-project-id'))
          .filter((id) => ids.includes(id)),
      ids,
    );
  await expect.poll(order).toEqual([b.id, a.id, empty.id]);
  const search = page.getByLabel('Search conversations', { exact: true });
  await search.fill(second.title);
  await expect(projectCard(page, a.id)).toContainText('No matches');
  await expect.poll(order).toEqual([b.id, a.id, empty.id]);
  const sent = await page.request.post('/api/threads/' + first.id + '/send', {
    data: {
      operationId: randomUUID(),
      text: 'Follow-up in another project',
      settings: { permission: 'read-only' },
      attachments: [],
    },
    headers: { Origin: origin },
  });
  expect(sent.ok()).toBe(true);
  await expect.poll(order).toEqual([a.id, b.id, empty.id]);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.title);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) =>
      url.pathname === '/api/threads/' + second.id + '/snapshot' ||
      /^\/api\/projects\/[^/]+\/conversations$/.test(url.pathname),
    async (route) => {
      await hold;
      await route.continue();
    },
  );
  try {
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Conversation');
    await expect(page.getByRole('status', { name: 'Conversation loading' })).toBeVisible();
    await expect.poll(order).toEqual([a.id, b.id, empty.id]);
    await expect(projectCard(page, empty.id).locator('.project-card-name')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(cards.getByText('Loading…', { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.title);
});
test('one project uses a project card and an empty installation has one add-project entry', async ({
  page,
}) => {
  let empty = false;
  await page.route('**/api/projects', async (route) => {
    const response = await route.fetch();
    const list = await response.json();
    if (!Array.isArray(list)) return route.fulfill({ response });
    await route.fulfill({
      json: empty
        ? []
        : list.filter((project: { name: string }) => project.name === 'sample-project'),
    });
  });
  await login(page);
  await expect(page.locator('.project-card-name[aria-current="true"]')).toHaveText(
    'sample-project',
  );
  await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Workspace actions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add project', exact: true })).toBeVisible();
  empty = true;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add project', exact: true })).toHaveCount(1);
});
