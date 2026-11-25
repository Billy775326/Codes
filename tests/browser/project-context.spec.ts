import { openProject, projectCard } from './sidebar-helpers';
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
  if (!(await page.locator('.project-card-name[aria-current="true"]').isVisible()))
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
}
async function searchForUnmatchedProject(page: Page, projectId: string, term: string) {
  const search = page.getByLabel('Search projects and chats', { exact: true });
  const unmatchedProject = projectCard(page, projectId);
  const unmatchedRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === `/api/projects/${projectId}/conversations` &&
      url.searchParams.get('search') === term
    );
  });
  await search.fill(term);
  // An immediate sidebar refresh can cancel the browser fetch after headers arrive.
  const response = await page.request.get((await unmatchedRequest).url());
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.data).toHaveLength(0);
  await expect(unmatchedProject).toHaveAttribute('aria-busy', 'false');
  await expect(unmatchedProject.locator('.thread-link')).toHaveCount(0);
  const nextPage = unmatchedProject.getByRole('button', {
    name: 'Next conversation page',
    exact: true,
  });
  if (result.nextCursor) {
    await expect(
      unmatchedProject.getByText('No matches on this page', { exact: true }),
    ).toBeVisible();
    await expect(nextPage).toBeEnabled();
  } else await expect(unmatchedProject).toBeHidden();
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
test('project archive survives reload, preserves native chat states, and syncs restoration', async ({
  page,
  browser,
}) => {
  await login(page);
  const { b, second } = await fixture(page);
  const archivedChat = await page.request.post('/api/threads/' + second.id + '/archive', {
    data: { operationId: randomUUID(), archived: true },
    headers: { Origin: origin },
  });
  expect(archivedChat.ok()).toBe(true);
  await page.reload();
  await expect(page.locator('.connection')).toHaveText('Connected');
  const card = projectCard(page, b.id);
  const archive = page.getByRole('button', { name: 'Archived projects and chats', exact: true });
  const menu = card.getByRole('button', { name: 'Project actions for ' + b.name, exact: true });
  const observerContext = await browser.newContext();
  try {
    const observer = await observerContext.newPage();
    await login(observer);
    const mirror = projectCard(observer, b.id);
    await expect(mirror).toBeVisible();
    await page.bringToFront();
    await menu.click();
    await card.getByRole('button', { name: 'Archive project', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Archive this project?', exact: true });
    await expect(confirmation).toContainText(b.name);
    await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirmation.getByRole('button', { name: 'Archive project', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(archive).toBeFocused();
    await expect(mirror).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.connection')).toHaveText('Connected');
    await expect(card).toHaveCount(0);
    await archive.click();
    await expect(
      card.getByRole('button', { name: b.name, exact: true }),
    ).toHaveAccessibleDescription('Archived project');
    const filters = card.getByRole('group', { name: 'Chats in ' + b.name });
    const archived = filters.getByRole('button', { name: 'Archived chats', exact: true });
    const active = filters.getByRole('button', { name: 'Active chats', exact: true });
    const restore = card.getByRole('button', { name: 'Restore project', exact: true });
    const disclosure = card.locator('.project-card-disclosure');
    const savedChat = card.getByRole('button', { name: second.title, exact: true });
    await expect(savedChat).toBeVisible();
    await expect(archived).toHaveAttribute('aria-pressed', 'true');
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(savedChat).toBeHidden();
    await expect(restore).toBeVisible();
    await disclosure.press('Enter');
    await expect(savedChat).toBeVisible();
    await active.click();
    await expect(active).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByText('No active chats', { exact: true })).toBeVisible();
    await archived.click();
    await savedChat.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.title);
    await expect(page.getByLabel('Message Codex')).toHaveAttribute('readonly', '');
    await restore.click();
    await expect(mirror).toBeVisible();
    await expect(filters).toHaveCount(0);
    await expect(savedChat).toBeVisible();
    await card.getByRole('button', { name: 'Restore ' + second.title, exact: true }).click();
    await expect(card).toBeHidden();
    await expect(archive).toBeFocused();
    await archive.click();
    await expect(card).toBeVisible();
    await expect(savedChat).toBeVisible();
  } finally {
    await observerContext.close();
  }
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
  await page.getByRole('button', { name: 'Ask for approval', exact: true }).click();
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
  await searchForUnmatchedProject(page, a.id, second.title);
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
  await expect(
    page.locator('.sidebar').getByRole('button', { name: 'Add project', exact: true }),
  ).toBeVisible();
  empty = true;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add project', exact: true })).toHaveCount(1);
});

test('adding a project validates the path and reuses a registered directory', async ({ page }) => {
  await login(page);
  const registered = () => page.request.get('/api/projects').then((response) => response.json());
  const original = (await registered()).find(
    (project: { name: string }) => project.name === 'sample-project',
  );
  const suffix = randomUUID();
  const path = join(original.path, 'conversation-fixtures', 'added-' + suffix);
  const alias = path + '-alias';
  await mkdir(path);
  await symlink(path, alias);
  const add = page.locator('.sidebar').getByRole('button', { name: 'Add project', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Add a project', exact: true });
  const directory = dialog.getByLabel('Project directory on server', { exact: true });
  const projectName = dialog.getByLabel('Project name (optional)', { exact: true });
  const submit = dialog.getByRole('button', { name: 'Add project', exact: true });
  const name = 'zz Added project ' + suffix;
  await add.click();
  await expect(directory).toHaveValue(original.path);
  await expect(directory).toBeFocused();
  expect(
    await directory.evaluate((input: HTMLInputElement) => [
      input.selectionStart,
      input.selectionEnd,
    ]),
  ).toEqual([0, original.path.length]);
  await submit.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.project-card-name[aria-current="true"]')).toHaveText(
    'sample-project',
  );
  await add.click();
  await projectName.fill(name);
  await directory.fill('.');
  await submit.click();
  await expect(dialog.getByRole('alert')).toHaveText('Enter an absolute path on the server.');
  await directory.fill(path + '-missing');
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('Choose an existing');
  await expect(projectName).toHaveValue(name);
  await directory.fill(path);
  await submit.click();
  await expect(dialog).toHaveCount(0);
  const selected = page.locator('.project-card-name[aria-current="true"]');
  await expect(selected).toHaveText(name);
  const draft = page.getByLabel('Message Codex');
  await draft.fill('Preserve this project draft');
  await add.click();
  await directory.fill(alias);
  await projectName.fill('Duplicate label');
  await submit.click();
  await expect(dialog).toHaveCount(0);
  await expect(selected).toHaveText(name);
  await expect(draft).toHaveValue('Preserve this project draft');
  expect(
    (await registered()).filter((project: { path: string }) => project.path === path),
  ).toHaveLength(1);
});

test('project management and conversation links survive reload and keep the verified owner', async ({
  page,
}) => {
  await login(page);
  const { a, b, first, second, path } = await fixture(page);
  await page.reload();
  const card = projectCard(page, b.id);
  await expect(card.getByRole('button', { name: second.title, exact: true })).toBeVisible();

  const actions = (name: string) =>
    card.getByRole('button', { name: 'Project actions for ' + name, exact: true });
  const projectMenu = (name: string) =>
    card.getByRole('group', { name: 'Project actions: ' + name, exact: true });
  const closedHeight = (await card.boundingBox())!.height;
  await actions(b.name).press('Space');
  await expect(actions(b.name)).toHaveAttribute('aria-expanded', 'true');
  const rename = projectMenu(b.name).getByRole('button', { name: 'Rename', exact: true });
  const pin = projectMenu(b.name).getByRole('button', { name: 'Pin', exact: true });
  await expect(rename).toBeVisible();
  await expect(rename.getByText('Rename', { exact: true })).toBeHidden();
  expect((await card.boundingBox())!.height).toBeGreaterThan(closedHeight);
  await actions(b.name).press('Tab');
  await expect(rename).toBeFocused();
  await rename.press('Tab');
  await expect(pin).toBeFocused();
  await pin.press('Tab');
  await expect(projectMenu(b.name).getByRole('button', { name: 'Archive project' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(actions(b.name)).toBeFocused();
  await expect(projectMenu(b.name)).toHaveCount(0);
  expect((await card.boundingBox())!.height).toBe(closedHeight);
  await actions(b.name).click();
  await rename.click();
  const renamed = 'zz Sidebar ' + randomUUID();
  await card.getByLabel('Project name', { exact: true }).fill('  ' + renamed + '  ');
  await card.getByRole('button', { name: 'Save project name', exact: true }).click();
  await expect(actions(renamed)).toBeVisible();
  const conflict = await page.request.put('/api/projects/' + b.id, {
    data: { name: 'Stale name', expectedName: b.name },
    headers: { Origin: origin },
  });
  expect(conflict.status()).toBe(409);
  const owned = await (await page.request.get('/api/threads/' + second.id + '/snapshot')).json();
  expect(owned.context.project).toMatchObject({ id: b.id, path, name: renamed });
  expect(owned.thread.projectId).toBe(b.id);

  await actions(renamed).click();
  await projectMenu(renamed).getByRole('button', { name: 'Pin', exact: true }).click();
  const firstCard = page
    .getByRole('navigation', { name: 'Conversations' })
    .locator('.project-card')
    .first();
  await expect(firstCard).toHaveAttribute('data-project-id', b.id);
  await card.getByRole('button', { name: 'Collapse ' + renamed, exact: true }).click();

  const listPath = '/api/projects/' + b.id + '/conversations';
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.reload();
  const projectName = card.getByRole('button', { name: renamed, exact: true });
  await expect(projectName).toHaveAttribute('aria-expanded', 'false');
  await expect(firstCard).toHaveAttribute('data-project-id', b.id);
  await expect(page.locator('.connection')).toHaveText('Connected');
  await expect(
    projectCard(page, a.id).getByRole('button', { name: first.title, exact: true }),
  ).toBeVisible();
  expect(requests).not.toContain(listPath);

  const search = page.getByLabel('Search projects and chats');
  await searchForUnmatchedProject(page, a.id, renamed.toUpperCase());
  await expect(card.getByRole('button', { name: second.title, exact: true })).toBeVisible();
  await search.fill('no match ' + randomUUID());
  await expect(card).toBeHidden();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(projectName).toHaveAttribute('aria-expanded', 'false');

  await projectName.click();
  const link = new URL('/?conversation=' + encodeURIComponent(second.id), origin);
  await projectCard(page, a.id).getByRole('button', { name: first.title, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.title);
  await page.goto(link.href);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.title);
  await expect(projectName).toHaveAttribute('aria-current', 'true');
  await actions(renamed).click();
  await projectMenu(renamed).getByRole('button', { name: 'Unpin', exact: true }).click();
  await expect(projectName).not.toHaveAttribute('aria-description', 'Pinned project');
});
