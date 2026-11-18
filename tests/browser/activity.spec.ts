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
  base.thread.messages = [
    base.thread.messages.find((message) => message.kind === 'user')!,
    { id: 'fixture-progress', turnId: turn, kind: 'assistant', text: 'Inspecting the workspace.' },
    ...commands,
    {
      id: 'fixture-change',
      turnId: turn,
      kind: 'change',
      status: 'completed',
      text: 'example.ts',
      files: [{ path: 'example.ts', kind: 'update', diff: '@@ -1 +1 @@\n-old\n+new' }],
    },
    { id: 'fixture-final', turnId: turn, kind: 'assistant', text: 'Final response stays visible.' },
  ];
  await page.route('**/api/threads/*/snapshot', (route) => route.fulfill({ json: base }));
  await page.reload();
  await expect(page.getByText('Final response stays visible.', { exact: true })).toBeVisible();
  return { base, commands };
}
test('command runs default to one compact disclosure with visible failure counts and lazy output', async ({
  page,
}) => {
  await fixture(page, 31);
  const group = page.locator('.command-group');
  await expect(group).toHaveCount(1);
  await expect(group).not.toHaveAttribute('open', '');
  await expect(group.locator('summary').first()).toContainText('31 commands');
  await expect(group.locator('summary').first()).toContainText('1 failed');
  await expect(page.locator('.tool')).toHaveCount(0);
  await expect(page.getByText('Inspecting the workspace.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Edited files', exact: true })).toBeVisible();
  await page.getByLabel('Message Codex').fill('Keep the next draft');
  await group.locator('summary').first().focus();
  await page.keyboard.press('Enter');
  await expect(group).toHaveAttribute('open', '');
  await expect(page.locator('.tool')).toHaveCount(31);
  await expect(page.locator('.tool pre')).toHaveCount(0);
  await page.locator('.tool > summary').first().click();
  await expect(page.locator('.tool pre')).toHaveText(
    'printf command-0\n\nSynthetic command output 0',
  );
  await group.locator('summary').first().click();
  await expect(page.locator('.tool')).toHaveCount(0);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep the next draft');
  await page.screenshot({ path: 'test-results/activity-collapsed-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.command-group')).not.toHaveAttribute('open', '');
});
test('command status and appended entries update without opening a collapsed run or resetting an open run', async ({
  page,
}) => {
  const { base, commands } = await fixture(page, 2);
  commands[1]!.status = 'inProgress';
  await page.locator('.connection').click();
  const group = page.locator('.command-group');
  await expect(group.locator('summary').first()).toContainText('1 running');
  await expect(group).not.toHaveAttribute('open', '');
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
  await expect(group.locator('summary').first()).toContainText('3 commands');
  await expect(group.locator('summary').first()).toContainText('Completed');
  await expect(page.locator('.tool')).toHaveCount(0);
  await group.locator('summary').first().click();
  await expect(page.locator('.tool')).toHaveCount(3);
  base.thread.messages.splice(5, 0, { ...added, id: 'fixture-last', status: 'failed' });
  await page.locator('.connection').click();
  await expect(group.locator('summary').first()).toContainText('4 commands');
  await expect(group).toHaveAttribute('open', '');
  await expect(page.locator('.tool')).toHaveCount(4);
  await expect(group.locator('summary').first()).toContainText('1 failed');
});
for (const width of [1440, 320])
  test(`large display size persists and collapsed activity fits ${width}px in both themes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
    await fixture(page, 31);
    const initial = await page
      .getByTestId('message-assistant')
      .last()
      .locator('.prose')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(initial).toBeGreaterThanOrEqual(16);
    await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
    await page.getByLabel('Display size').selectOption('large');
    await page.keyboard.press('Escape');
    await expect(page.locator('.app')).toHaveAttribute('data-display-size', 'large');
    const larger = await page
      .getByTestId('message-assistant')
      .last()
      .locator('.prose')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(larger).toBeGreaterThan(initial);
    await page.reload();
    await expect(page.locator('.app')).toHaveAttribute('data-display-size', 'large');
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
        return ['.prose', '.command-group-status'].map((selector) => {
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
