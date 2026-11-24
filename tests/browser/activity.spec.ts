import { reconnectUpdates } from './sidebar-helpers';
import { test, expect, type Page } from '@playwright/test';
import type { Snapshot, Message } from '../../src/shared/types';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { imagePng } from '../fixtures/image';
async function fixture(page: Page, count: number) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByLabel('Message Codex').fill('Synthetic command grouping fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  const base: Snapshot = await page.evaluate(async () => {
    const id = localStorage.getItem('codes.thread');
    return (await fetch('/api/threads/' + id + '/snapshot')).json();
  });
  const turn = base.thread.turnId!;
  const commands: Message[] = Array.from({ length: count }, (_, index) => ({
    id: 'fixture-command-' + index,
    turnId: turn,
    kind: 'command',
    status: index === 7 ? 'failed' : 'completed',
    text: `printf command-${index}\n\nSynthetic command output ${index}`,
  }));
  base.thread.turns = [{ id: turn, status: 'completed', durationMs: 125000 }];
  base.thread.messages = [
    base.thread.messages.find((message) => message.kind === 'user')!,
    {
      id: 'fixture-progress',
      turnId: turn,
      kind: 'assistant',
      phase: 'commentary',
      text: 'Inspecting the workspace.',
    },
    ...commands,
    {
      id: 'fixture-change',
      turnId: turn,
      kind: 'change',
      status: 'completed',
      text: 'example.ts',
      files: [{ path: 'example.ts', kind: 'update', diff: '@@ -1 +1 @@\n-old\n+new' }],
    },
    {
      id: 'fixture-final',
      turnId: turn,
      kind: 'assistant',
      phase: 'final_answer',
      text: 'Final response stays visible.',
    },
  ];
  await page.route('**/api/threads/*/snapshot', (route) => route.fulfill({ json: base }));
  await page.reload();
  await expect(page.getByText('Final response stays visible.', { exact: true })).toBeVisible();
  return { base, commands };
}
test('a streaming Codex reply renders Markdown before the task finishes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByLabel('Message Codex').fill('[hold] Stream Markdown fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const reply = page.getByTestId('message-assistant');
  await expect(reply.getByRole('heading', { name: 'A clear path forward' })).toBeVisible();
  await expect(reply.locator('strong')).toHaveText('simulated response');
  await expect(reply.getByRole('listitem')).toHaveCount(3);
  const activity = page.getByRole('status', { name: 'Running', exact: true });
  const dots = activity.locator('i');
  await expect(activity).toBeVisible();
  await expect(dots).toHaveCount(3);
  await expect(dots.first()).toHaveCSS('background-color', 'rgb(85, 204, 255)');
  await expect(dots.first()).toHaveCSS('animation-name', 'task-dot');
  await expect(dots.nth(1)).toHaveCSS('animation-delay', '0.2s');
  await expect(dots.nth(2)).toHaveCSS('animation-delay', '0.4s');
  await expect(page.locator('.caret, .thinking')).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await expect(dots.first()).toHaveCSS('background-color', 'rgb(0, 93, 156)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(dots.first()).toHaveCSS('animation-name', 'none');
  const stop = page.getByRole('button', { name: 'Stop task', exact: true });
  await expect(stop).toBeEnabled();
  await stop.click();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
  await expect(activity).toHaveCount(0);
  await expect(reply.getByRole('heading', { name: 'A clear path forward' })).toBeVisible();
});

test('three-dot indicator distinguishes a pending answer from approval without animating', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  const input = page.getByLabel('Message Codex');
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  const activity = page.locator('.task-activity');
  await input.fill('[question] Waiting dot fixture');
  await send.click();
  await expect(activity).toHaveAccessibleName('Needs answer');
  const dot = activity.locator('i').first();
  await expect(dot).toHaveCSS('background-color', 'rgb(193, 175, 246)');
  await expect(dot).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: 'Skip question', exact: true }).click();
  await expect(activity).toHaveCount(0);
  await input.fill('[approve] Approval dot fixture');
  await send.click();
  await expect(activity).toHaveAccessibleName('Needs approval');
  await expect(dot).toHaveCSS('background-color', 'rgb(223, 187, 128)');
  await expect(dot).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
});

test('a finished reply can copy one fenced code block without copying the message', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { base } = await fixture(page, 0);
  base.thread.messages.find((message) => message.phase === 'final_answer')!.text =
    'Example heading.\n\n```ts\nconst value = 42;\n```';
  await reconnectUpdates(page);
  await page.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('const value = 42;');
  await expect(page.getByText('Code copied', { exact: true })).toBeVisible();
});

test('external chat links open a separate tab and internal links stay in the workspace', async ({
  page,
  context,
}) => {
  const { base } = await fixture(page, 0);
  const origin = new URL(page.url()).origin;
  const external = 'https://outside.example';
  base.thread.messages.find((message) => message.kind === 'user')!.text =
    `[External from user](${external}/user)\n\n[Same origin](${origin}/?view=current)`;
  base.thread.messages.find((message) => message.phase === 'final_answer')!.text =
    `${external}/answer\n\n[Protocol-relative link](//outside.example/reference)\n\n[Jump within the page](#details)`;
  await context.route(external + '/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>External link fixture</title>' }),
  );
  await reconnectUpdates(page);

  const ownPage = page.url();
  const userMessage = page.getByTestId('message-user');
  const assistant = page.getByTestId('message-assistant').filter({ hasText: external + '/answer' });
  for (const [link, pathname] of [
    [userMessage.getByRole('link', { name: 'External from user', exact: true }), '/user'],
    [assistant.getByRole('link', { name: external + '/answer', exact: true }), '/answer'],
  ] as const) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const opened = context.waitForEvent('page');
    await link.click();
    const newTab = await opened;
    await newTab.waitForURL(external + pathname);
    expect(await newTab.evaluate(() => window.opener === null)).toBe(true);
    expect(page.url()).toBe(ownPage);
    await newTab.close();
  }
  await expect(assistant.getByRole('link', { name: 'Protocol-relative link' })).toHaveAttribute(
    'target',
    '_blank',
  );
  await expect(userMessage.getByRole('link', { name: 'Same origin' })).not.toHaveAttribute(
    'target',
  );
  const anchor = assistant.getByRole('link', { name: 'Jump within the page' });
  await expect(anchor).not.toHaveAttribute('target');
  await anchor.click();
  await expect(page).toHaveURL(new URL('#details', ownPage).href);
});

test('HTML anchors and Markdown links open project files without navigating the conversation', async ({
  page,
}) => {
  const { base } = await fixture(page, 0);
  const root = base.context!.project.path;
  const drafts = join(root, '_drafts');
  await mkdir(drafts, { recursive: true });
  await writeFile(join(drafts, 'draft notes.md'), '# Saved draft\nRead through the preview.\n');
  base.thread.messages.find((item) => item.phase === 'final_answer')!.text = [
    `<a href="${root}/_drafts/draft%20notes.md">初稿已完成</a>，可以开始审阅。`,
    `[Open source](${root}/example.ts:2)`,
    `<a href="${root}/example.ts" title="Raw markup">Other raw HTML</a>`,
  ].join('\n\n');
  await reconnectUpdates(page);
  const url = page.url();
  const input = page.getByLabel('Message Codex');
  await input.fill('Keep this unsent message');
  const preview = page.getByRole('region', { name: 'File preview' });
  await page.getByRole('button', { name: '初稿已完成', exact: true }).click();
  await expect(preview).toContainText('draft notes.md');
  await expect(preview).toContainText('Read through the preview.');
  await expect(page).toHaveURL(url);
  await expect(input).toHaveValue('Keep this unsent message');
  await page.getByRole('button', { name: 'Open source', exact: true }).press('Enter');
  await expect(preview).toContainText('export function hello');
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('button', { name: 'Other raw HTML', exact: true })).toHaveCount(0);
});

test('answers and project files preview raster images and isolated static HTML', async ({
  page,
}) => {
  const { base } = await fixture(page, 0);
  const project = base.context!.project;
  const imageName = 'preview-test.png';
  const screenshotPath = join(dirname(project.path), 'data', 'shared-screenshot.png');
  const htmlName = 'preview-test.html';
  const html = [
    '<meta http-equiv="refresh" content="0; url=/preview-external-test">',
    '<style>@import url("/preview-external-test"); h1 { color: rgb(12, 34, 56) }</style>',
    '<h1 onclick="document.body.textContent=\'unexpected event\'">Preview headline</h1>',
    '<script>document.body.textContent="unexpected script"</script>',
    '<img src="/preview-external-test"><a href="/preview-external-test">An example link</a>',
  ].join('\n');
  await writeFile(join(project.path, imageName), imagePng);
  await writeFile(screenshotPath, imagePng);
  await writeFile(join(project.path, htmlName), html);
  const reply = base.thread.messages.find((message) => message.phase === 'final_answer')!;
  reply.text =
    '| Output | Format |\n| --- | --- |\n| Plot | `png` |\n\n![Generated plot](./' +
    imageName +
    `)\n\n![Shared screenshot](${screenshotPath})\n\n[Preview screenshot](${screenshotPath})\n\n` +
    `<a href="${screenshotPath}">Screenshot from an HTML link</a>\n\n\`\`\`html\n` +
    html +
    '\n```';
  let externalResponses = 0;
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/preview-external-test') externalResponses++;
  });
  await reconnectUpdates(page);
  const preview = page
    .getByTestId('message-assistant')
    .filter({ has: page.getByRole('img', { name: 'Generated plot' }) });
  const expectImage = async (name: string) =>
    expect
      .poll(() =>
        page
          .getByRole('img', { name, exact: true })
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
  await expectImage('Generated plot');
  await expectImage('Shared screenshot');
  const closePreview = async () => {
    const dialog = page.getByRole('dialog', { name: 'Image preview', exact: true });
    await expect(dialog).toBeVisible();
    await expectImage('shared-screenshot.png');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  };
  await preview.getByRole('button', { name: 'Preview screenshot', exact: true }).click();
  await closePreview();
  await preview.getByRole('button', { name: 'Screenshot from an HTML link', exact: true }).click();
  await closePreview();
  await expect(
    preview.getByRole('table').getByRole('columnheader', { name: 'Format' }),
  ).toBeVisible();
  await expect(preview.locator('pre')).toContainText('<script>');
  await preview.getByText('Preview HTML', { exact: true }).click();
  const frame = preview.frameLocator('iframe[title="HTML preview"]');
  const heading = frame.getByRole('heading', { name: 'Preview headline' });
  await expect(heading).toHaveCSS('color', 'rgb(12, 34, 56)');
  await expect(heading).not.toHaveAttribute('onclick');
  await expect(frame.locator('a')).not.toHaveAttribute('href');
  await expect(frame.locator('img')).not.toHaveAttribute('src');
  expect(
    await preview
      .locator('iframe')
      .evaluate((element: HTMLIFrameElement) => element.contentDocument),
  ).toBeNull();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Browse files', exact: true }).click();
  const files = page.locator('.context-panel');
  await files.getByRole('button', { name: imageName, exact: true }).click();
  await expectImage(imageName);
  await files.getByRole('button', { name: 'Back to files', exact: true }).click();
  await files.getByRole('button', { name: htmlName, exact: true }).click();
  await expect(files.locator('.file-lines')).toContainText('<h1');
  await files.getByText('Preview HTML', { exact: true }).click();
  await expect(
    files.frameLocator('iframe').getByRole('heading', { name: 'Preview headline' }),
  ).toHaveCSS('color', 'rgb(12, 34, 56)');
  await expect(page.locator('.html-preview iframe')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(externalResponses).toBe(0);
});
test('HTML preview explains an empty JavaScript app shell and keeps its source visible', async ({
  page,
}) => {
  const { base } = await fixture(page, 0);
  await writeFile(
    join(base.context!.project.path, 'app-entry.html'),
    '<!doctype html><html><head><title>Example app</title></head><body><div id="root"></div>' +
      '<script type="module" src="/src/main.tsx"></script></body></html>',
  );
  await page.getByRole('button', { name: 'Browse files', exact: true }).click();
  await page.getByRole('button', { name: 'app-entry.html', exact: true }).click();
  const preview = page.getByRole('region', { name: 'File preview', exact: true });
  await preview.getByText('Preview HTML', { exact: true }).click();
  await expect(preview.getByRole('status')).toContainText('This page needs JavaScript to render.');
  await expect(preview.locator('iframe')).toHaveCount(0);
  await expect(preview.getByRole('group', { name: 'File lines' })).toContainText('/src/main.tsx');
});
test('work sections around a question expand independently with commands collapsed', async ({
  page,
}) => {
  const { base, commands } = await fixture(page, 2);
  base.thread.messages.splice(base.thread.messages.indexOf(commands[1]!), 0, {
    id: 'archived-question',
    turnId: base.thread.turnId!,
    kind: 'question',
    text: 'One question',
    answeredQuestions: [{ question: 'One question', answer: 'Already answered' }],
  });
  await reconnectUpdates(page);
  const disclosures = page.locator('.work-history-toggle');
  await expect(disclosures).toHaveCount(2);
  await expect(disclosures.first()).toHaveAttribute('aria-expanded', 'false');
  await disclosures.last().click();
  await expect(disclosures.first()).toHaveAttribute('aria-expanded', 'false');
  await expect(disclosures.last()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.activity-group[open]')).toHaveCount(0);
});

test('the whole work history defaults collapsed with final answer, edits and one footer outside', async ({
  page,
}) => {
  await fixture(page, 31);
  const group = page.locator('.work-history');
  await expect(group).toHaveCount(1);
  await expect(group.locator('.work-history-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(
    group.getByRole('button', { name: /Worked for|Working|Work history/ }),
  ).toContainText('31 activities');
  await expect(
    group.getByRole('button', { name: /Worked for|Working|Work history/ }),
  ).toContainText('1 failed');
  await expect(page.locator('.tool')).toHaveCount(0);
  await expect(page.getByText('Inspecting the workspace.', { exact: true })).toHaveCount(0);
  await expect(group.locator('.work-history-toggle')).toContainText('Worked for 2m 5s');
  await expect(page.getByRole('region', { name: 'Edited files', exact: true })).toBeVisible();
  await page.getByLabel('Message Codex').fill('Keep the next draft');
  await group.getByRole('button', { name: /Worked for|Working|Work history/ }).focus();
  await page.keyboard.press('Enter');
  await expect(group.locator('.work-history-toggle')).toHaveAttribute('aria-expanded', 'true');
  const activities = group.locator('.activity-group');
  await expect(activities).not.toHaveAttribute('open', '');
  await expect(activities.locator('summary')).toContainText('31 activities');
  await expect(page.getByText('Inspecting the workspace.', { exact: true })).toBeVisible();
  await expect(page.locator('.tool')).toHaveCount(0);
  await activities.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.tool')).toHaveCount(31);
  await expect(page.locator('.tool pre')).toHaveCount(0);
  await page.locator('.tool > summary').first().click();
  await expect(page.locator('.tool pre')).toHaveText(
    'printf command-0\n\nSynthetic command output 0',
  );
  await group.getByRole('button', { name: /Worked for|Working|Work history/ }).click();
  await expect(page.locator('.tool')).toHaveCount(0);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep the next draft');
  await page.screenshot({ path: 'test-results/activity-collapsed-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.work-history-toggle')).toHaveAttribute('aria-expanded', 'false');
});
test('one action row belongs to the last reply and intermediate prose does not reserve toolbar space', async ({
  page,
}) => {
  await fixture(page, 16);
  const progress = page
    .getByTestId('message-assistant')
    .filter({ hasText: 'Inspecting the workspace.' });
  const final = page
    .getByTestId('message-assistant')
    .filter({ hasText: 'Final response stays visible.' });
  await expect(progress.getByRole('group', { name: 'Reply actions', exact: true })).toHaveCount(0);
  await expect(
    page.getByTestId('message-user').getByRole('button', { name: 'Copy message', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Reply actions', exact: true })).toHaveCount(1);
  await expect(final.getByRole('button', { name: 'Copy message', exact: true })).toBeVisible();
  await expect(final.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
  await page.locator('.work-history-toggle').click();
  await expect(progress).toBeVisible();
  const prose = await progress.locator('.prose').boundingBox();
  const activity = await page.locator('.activity-group').first().boundingBox();
  expect(activity!.y - (prose!.y + prose!.height)).toBeLessThanOrEqual(16);
  await final.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toHaveValue(
    'Regarding this Codex reply:\n> Final response stays visible.\n\n',
  );
  await page.screenshot({ path: 'test-results/activity-compact-replies.png', fullPage: true });
});

test('command status and appended entries update without opening a collapsed run or resetting an open run', async ({
  page,
}) => {
  const { base, commands } = await fixture(page, 2);
  commands[1]!.status = 'inProgress';
  await reconnectUpdates(page);
  const group = page.locator('.work-history');
  await expect(
    group.getByRole('button', { name: /Worked for|Working|Work history/ }),
  ).toContainText('1 running');
  await expect(group.locator('.work-history-toggle')).toHaveAttribute('aria-expanded', 'false');
  commands[1]!.status = 'completed';
  const added: Message = {
    id: 'fixture-appended',
    turnId: base.thread.turnId!,
    kind: 'command',
    status: 'completed',
    text: 'printf appended',
  };
  base.thread.messages.splice(4, 0, added);
  await reconnectUpdates(page);
  await expect(
    group.getByRole('button', { name: /Worked for|Working|Work history/ }),
  ).toContainText('3 activities');
  await expect(
    group.getByRole('button', { name: /Worked for|Working|Work history/ }),
  ).toContainText('Worked for 2m 5s');
  await expect(page.locator('.tool')).toHaveCount(0);
  await group.getByRole('button', { name: /Worked for|Working|Work history/ }).click();
  const activities = group.locator('.activity-group');
  await expect(page.locator('.tool')).toHaveCount(0);
  await activities.locator('summary').click();
  await expect(page.locator('.tool')).toHaveCount(3);
  base.thread.messages.splice(5, 0, { ...added, id: 'fixture-last', status: 'failed' });
  await reconnectUpdates(page);
  await expect(
    group.getByRole('button', { name: /Worked for|Working|Work history/ }),
  ).toContainText('4 activities');
  await expect(group.locator('.work-history-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.tool')).toHaveCount(4);
  await expect(
    group.getByRole('button', { name: /Worked for|Working|Work history/ }),
  ).toContainText('1 failed');
});
test('running work opens, completion collapses untouched history, and manual choices survive updates', async ({
  page,
}) => {
  const { base } = await fixture(page, 2);
  const final = base.thread.messages.pop()!;
  base.thread.state = 'running';
  base.thread.turns = [
    { id: base.thread.turnId!, status: 'inProgress', startedAtMs: Date.now() - 5000 },
  ];
  base.thread.messages.push({
    id: 'fixture-integration',
    turnId: base.thread.turnId!,
    kind: 'tool',
    text: 'Used GitHub: search',
    status: 'completed',
  });
  await reconnectUpdates(page);
  const toggle = page.locator('.work-history-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Inspecting the workspace.', { exact: true })).toBeVisible();
  await expect(page.getByText('Used GitHub: search', { exact: true })).toHaveCount(0);
  await page.locator('.activity-group > summary').click();
  await expect(page.getByText('Used GitHub: search', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Reply actions', exact: true })).toHaveCount(0);
  base.thread.state = 'completed';
  base.thread.turns = [{ id: base.thread.turnId!, status: 'completed', durationMs: 8000 }];
  base.thread.messages.push(final);
  await reconnectUpdates(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('Worked for 8s');
  await expect(page.getByText('Final response stays visible.', { exact: true })).toBeVisible();
  await toggle.click();
  await reconnectUpdates(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // A deliberate close is also respected while the task is active.
  await toggle.click();
  base.thread.state = 'running';
  await reconnectUpdates(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('legacy history uses a neutral label and the last unknown-phase reply without inventing elapsed time', async ({
  page,
}) => {
  const { base } = await fixture(page, 2);
  delete base.thread.turns;
  for (const message of base.thread.messages) delete message.phase;
  await reconnectUpdates(page);
  await expect(page.locator('.work-history-toggle')).toContainText('Work history');
  await expect(page.locator('.work-history-toggle')).not.toContainText('Worked for');
  await expect(page.getByText('Inspecting the workspace.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Final response stays visible.', { exact: true })).toBeVisible();
  const answer = await page
    .getByText('Final response stays visible.', { exact: true })
    .boundingBox();
  const edits = await page.getByRole('region', { name: 'Edited files', exact: true }).boundingBox();
  const actions = await page
    .getByRole('group', { name: 'Reply actions', exact: true })
    .boundingBox();
  expect(edits!.y).toBeGreaterThan(answer!.y);
  expect(actions!.y).toBeGreaterThan(edits!.y + edits!.height);
});

for (const width of [1440, 320])
  test(`smaller default text ignores legacy display size and collapsed activity fits ${width}px in both themes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
    await fixture(page, 31);
    const initial = await page
      .getByTestId('message-assistant')
      .last()
      .locator('.prose')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(initial).toBe(14);
    await page.evaluate(() => {
      const preferences = JSON.parse(localStorage.getItem('codes.preferences') || '{}');
      localStorage.setItem(
        'codes.preferences',
        JSON.stringify({ ...preferences, displaySize: 'large' }),
      );
    });
    await page.reload();
    const restored = await page
      .getByTestId('message-assistant')
      .last()
      .locator('.prose')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(restored).toBe(initial);
    await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
    await expect(page.getByLabel('Display size')).toHaveCount(0);
    await page.keyboard.press('Escape');
    for (const theme of ['dark', 'light']) {
      await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
      await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const send = await page
        .getByRole('button', { name: 'Send message', exact: true })
        .boundingBox();
      expect(send!.x).toBeGreaterThanOrEqual(0);
      expect(send!.x + send!.width).toBeLessThanOrEqual(width);
      const contrast = await page.evaluate(() => {
        const luminance = (color: string) => {
          const rgb = color
            .match(/\d+(?:\.\d+)?/g)!
            .slice(0, 3)
            .map((value) => {
              const channel = Number(value) / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
          return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
        };
        const background = luminance(
          getComputedStyle(document.querySelector('.main')!).backgroundColor,
        );
        return ['.prose', '.work-history-status'].map((selector) => {
          const foreground = luminance(getComputedStyle(document.querySelector(selector)!).color);
          return (
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
          );
        });
      });
      expect(Math.min(...contrast)).toBeGreaterThan(4.5);
      await page.screenshot({
        path: `test-results/activity-${theme}-${width}.png`,
        fullPage: true,
      });
    }
    if (width <= 1099)
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.locator('.conversation-row.selected .conversation-row-action').click();
    const confirmation = page.getByRole('dialog', {
      name: 'Archive this conversation?',
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    expect(await confirmation.evaluate((element) => Boolean(element.closest('.app')))).toBe(true);
    await page.keyboard.press('Escape');
  });

test.describe('native message timestamps', () => {
  test.use({ timezoneId: 'Asia/Shanghai', locale: 'zh-CN' });
  test('shows local native start and finish times with exact instants and no intermediate timestamps', async ({
    page,
  }) => {
    const { base } = await fixture(page, 2);
    base.thread.turns = [
      {
        id: base.thread.turnId!,
        status: 'completed',
        startedAtMs: Date.parse('2026-11-18T03:12:00Z'),
        completedAtMs: Date.parse('2026-11-18T03:14:05Z'),
        durationMs: 125000,
      },
    ];
    await reconnectUpdates(page);
    const userTime = page.getByTestId('message-user').locator('time');
    const final = page
      .getByTestId('message-assistant')
      .filter({ hasText: 'Final response stays visible.' });
    const finalTime = final.locator('.message-footer time');
    await expect(userTime).toHaveAttribute('datetime', '2026-11-18T03:12:00.000Z');
    await expect(userTime).toHaveText('Nov 18, 11:12');
    await expect(userTime).toHaveAttribute('title', /Turn started:.*2026.*GMT\+8/);
    await expect(finalTime).toHaveAttribute('datetime', '2026-11-18T03:14:05.000Z');
    await expect(finalTime).toHaveText('Nov 18, 11:14');
    await expect(finalTime).toHaveAttribute('title', /Turn finished:.*11:14:05.*GMT\+8/);
    const actions = await final.locator('.message-actions').boundingBox();
    const timestamp = await finalTime.boundingBox();
    expect(Math.abs(actions!.y - timestamp!.y)).toBeLessThan(8);
    await page.locator('.work-history-toggle').click();
    await expect(page.locator('.work-history time')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/native-message-times.png', fullPage: true });
  });
  test('keeps the measured completion summary in the original reply as another task starts', async ({
    page,
  }) => {
    const { base } = await fixture(page, 2);
    const id = base.thread.turnId!;
    base.thread.turns = [
      {
        id,
        status: 'completed',
        durationMs: 10000,
        completedAtMs: Date.parse('2026-11-20T02:13:00Z'),
        usage: { totalTokens: 24000000, outputTokens: 357 },
      },
    ];
    await reconnectUpdates(page);
    const footer = page
      .getByTestId('message-assistant')
      .filter({ hasText: 'Final response stays visible.' })
      .locator('.message-footer');
    const summary = footer.locator('.turn-status.completed');
    await expect(footer.getByRole('group', { name: 'Reply actions' })).toBeVisible();
    await expect(summary).toContainText('Completed');
    await expect(summary).toContainText('Avg 35.7 TPS');
    await expect(summary).toContainText('24M tokens');
    await expect(footer.locator('time')).toHaveCount(1);
    await expect(summary.locator('time')).toHaveText('Nov 20, 10:13');
    await expect(page.locator('.turn-status.completed')).toHaveCount(1);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(summary).toBeVisible();
    expect(await footer.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

    const next = 'synthetic-next-turn';
    base.thread.turnId = next;
    base.thread.state = 'running';
    base.thread.turns.push({ id: next, status: 'inProgress' });
    base.thread.messages.push({ id: 'next-prompt', turnId: next, kind: 'user', text: 'Next task' });
    base.thread.usage = {
      turnId: next,
      contextTokens: 1200,
      totalTokens: 48000000,
      turnTotalTokens: 20,
      turnOutputTokens: 2,
    };
    await reconnectUpdates(page);
    const earlier = footer.locator('.reply-completion');
    await expect(earlier).toContainText('24M tokens');
    await expect(earlier.locator('time')).toHaveText('Nov 20, 10:13');
    await expect(footer.locator('time')).toHaveCount(1);
    await expect(page.locator('.turn-status.running')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeVisible();
    await page.reload();
    await expect(earlier).toContainText('24M tokens');
  });
  test('omits unknown legacy times and does not assign the turn start to same-turn follow-ups', async ({
    page,
  }) => {
    const { base } = await fixture(page, 2);
    base.thread.turns = [
      { id: base.thread.turnId!, startedAtMs: Date.parse('2026-11-18T03:12:00Z') },
    ];
    base.thread.messages.splice(1, 0, {
      id: 'fixture-follow-up',
      turnId: base.thread.turnId!,
      kind: 'user',
      text: 'Same-turn follow-up without its own native time',
    });
    await reconnectUpdates(page);
    await expect(page.getByTestId('message-user').first().locator('time')).toHaveCount(1);
    await expect(page.getByTestId('message-user').last().locator('time')).toHaveCount(0);
    await expect(page.getByTestId('message-assistant').locator('time')).toHaveCount(0);
    delete base.thread.turns;
    await reconnectUpdates(page);
    await expect(page.locator('.turn time')).toHaveCount(0);
    await expect(page.getByText('Final response stays visible.', { exact: true })).toBeVisible();
  });
});
