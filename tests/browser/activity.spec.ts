import { test, expect, type Page } from '@playwright/test';
import type { Snapshot, Message } from '../../src/shared/types';
async function fixture(page: Page, count: number) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByLabel('Message Codex').fill('Synthetic command grouping fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
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
  const activity = await page.locator('.tool').first().boundingBox();
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
  await page.locator('.connection').click();
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
  await page.locator('.connection').click();
  await expect(
    group.getByRole('button', { name: /Worked for|Working|Work history/ }),
  ).toContainText('3 activities');
  await expect(
    group.getByRole('button', { name: /Worked for|Working|Work history/ }),
  ).toContainText('Worked for 2m 5s');
  await expect(page.locator('.tool')).toHaveCount(0);
  await group.getByRole('button', { name: /Worked for|Working|Work history/ }).click();
  await expect(page.locator('.tool')).toHaveCount(3);
  base.thread.messages.splice(5, 0, { ...added, id: 'fixture-last', status: 'failed' });
  await page.locator('.connection').click();
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
  await page.locator('.connection').click();
  const toggle = page.locator('.work-history-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Inspecting the workspace.', { exact: true })).toBeVisible();
  await expect(page.getByText('Used GitHub: search', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Reply actions', exact: true })).toHaveCount(0);
  base.thread.state = 'completed';
  base.thread.turns = [{ id: base.thread.turnId!, status: 'completed', durationMs: 8000 }];
  base.thread.messages.push(final);
  await page.locator('.connection').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('Worked for 8s');
  await expect(page.getByText('Final response stays visible.', { exact: true })).toBeVisible();
  await toggle.click();
  await page.locator('.connection').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // A deliberate close is also respected while the task is active.
  await toggle.click();
  base.thread.state = 'running';
  await page.locator('.connection').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('legacy history uses a neutral label and the last unknown-phase reply without inventing elapsed time', async ({
  page,
}) => {
  const { base } = await fixture(page, 2);
  delete base.thread.turns;
  for (const message of base.thread.messages) delete message.phase;
  await page.locator('.connection').click();
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
    expect(initial).toBe(15);
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
      await page.getByLabel('Workspace theme').selectOption(theme);
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
    await page.locator('.conversation-menu-trigger').first().click();
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    const confirmation = page.getByRole('dialog', {
      name: 'Archive this conversation?',
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    expect(await confirmation.evaluate((element) => Boolean(element.closest('.app')))).toBe(true);
    await page.keyboard.press('Escape');
  });

test.describe('native message timestamps', () => {
  test.use({ timezoneId: 'Asia/Shanghai', locale: 'en-US' });
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
    await page.locator('.connection').click();
    const userTime = page.getByTestId('message-user').locator('time');
    const final = page
      .getByTestId('message-assistant')
      .filter({ hasText: 'Final response stays visible.' });
    const finalTime = final.locator('.message-footer time');
    await expect(userTime).toHaveAttribute('datetime', '2026-11-18T03:12:00.000Z');
    await expect(userTime).toContainText('11:12');
    await expect(userTime).toHaveAttribute('title', /Turn started:.*2026.*GMT\+8/);
    await expect(finalTime).toHaveAttribute('datetime', '2026-11-18T03:14:05.000Z');
    await expect(finalTime).toContainText('11:14');
    await expect(finalTime).toHaveAttribute('title', /Turn finished:.*11:14:05.*GMT\+8/);
    const actions = await final.locator('.message-actions').boundingBox();
    const timestamp = await finalTime.boundingBox();
    expect(Math.abs(actions!.y - timestamp!.y)).toBeLessThan(8);
    await page.locator('.work-history-toggle').click();
    await expect(page.locator('.work-history time')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/native-message-times.png', fullPage: true });
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
    await page.locator('.connection').click();
    await expect(page.getByTestId('message-user').first().locator('time')).toHaveCount(1);
    await expect(page.getByTestId('message-user').last().locator('time')).toHaveCount(0);
    await expect(page.getByTestId('message-assistant').locator('time')).toHaveCount(0);
    delete base.thread.turns;
    await page.locator('.connection').click();
    await expect(page.locator('.turn time')).toHaveCount(0);
    await expect(page.getByText('Final response stays visible.', { exact: true })).toBeVisible();
  });
});
