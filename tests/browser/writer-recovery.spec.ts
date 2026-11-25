import { test, expect, type Page } from '@playwright/test';
async function imported(page: Page, writer: 'busy' | 'once') {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toBeVisible();
  const projects = await (await page.request.get('/api/projects')).json();
  const project = projects.find((entry: { name: string }) => entry.name === 'sample-project');
  const response = await page.request.post(
    '/api/projects/' + project.id + '/seed?writer=' + writer,
    { data: {}, headers: { Origin: 'http://127.0.0.1:19140' } },
  );
  expect(response.ok()).toBe(true);
  const rows = await response.json();
  const thread = rows.find((entry: { title: string }) => entry.title === 'Rendering reference');
  await page.evaluate(
    ({ project, id }) => {
      localStorage.setItem('codes.project', project);
      localStorage.setItem('codes.thread', id);
    },
    { project: project.id, id: thread.id },
  );
  await page.reload();
  await expect(page.locator('.connection')).toHaveText('Connected');
  await expect(page.getByLabel('Message Codex')).toBeEnabled();
  return thread.id as string;
}
for (const width of [1440, 390])
  test(`an imported writer conflict has safe recovery and retains drafts at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const source = await imported(page, 'busy');
    await expect(page.getByTestId('message-question').last()).toContainText(
      'Answer: Imported conversations only',
    );
    await expect(page.getByTestId('message-question').last()).not.toContainText(
      'send_user_message_question_reply',
    );
    await expect(page.getByRole('button', { name: 'Submit answer', exact: true })).toHaveCount(0);
    await page.getByLabel('Message Codex').fill('Keep this unsent recovery draft');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Conversation ownership' })).toBeVisible();
    await expect(page.getByLabel('Message Codex')).toHaveValue('Keep this unsent recovery draft');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    const failed = await page.request.get('/api/threads/' + source + '/snapshot');
    const snapshot = (await failed.json()).thread;
    expect(snapshot.state).toBe('completed');
    expect(snapshot.pending).toBeFalsy();
    await page.getByRole('button', { name: 'Check availability', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Conversation ownership' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue in branch', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Branch from this turn?', exact: true });
    await expect(dialog).toContainText('Copy the draft and attachments without sending.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Create branch', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Message Codex')).toHaveValue('Keep this unsent recovery draft');
    await expect(page.getByRole('region', { name: 'Conversation ownership' })).toHaveCount(0);
    const branch = await page.evaluate(() => localStorage.getItem('codes.thread'));
    expect(branch).not.toBe(source);
    const child = (await (await page.request.get('/api/threads/' + branch + '/snapshot')).json())
      .thread;
    expect(child.forkedFromId).toBe(source);
    expect(child.settings.permission).toBeUndefined();
    expect(
      child.messages.filter((entry: { text: string }) =>
        entry.text.includes('Keep this unsent recovery draft'),
      ),
    ).toHaveLength(0);
  });
test('checking availability after a writer is released does not replay the task', async ({
  page,
}) => {
  const id = await imported(page, 'once');
  let sends = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/send')) sends++;
  });
  await page.getByLabel('Message Codex').fill('Continue only on my next explicit send');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check availability', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check availability', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Conversation ownership' })).toHaveCount(0);
  await expect(page.getByLabel('Message Codex')).toHaveValue(
    'Continue only on my next explicit send',
  );
  expect(sends).toBe(1);
  const snapshot = (await (await page.request.get('/api/threads/' + id + '/snapshot')).json())
    .thread;
  expect(snapshot.pending).toBeFalsy();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(
    page.locator('.turn-status').getByText('Completed', { exact: true }).last(),
  ).toBeVisible();
  expect(sends).toBe(2);
});
