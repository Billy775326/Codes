import { openContextTab } from './sidebar-helpers';
import { test, expect, type Page } from '@playwright/test';
import type { Snapshot } from '../../src/shared/types';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Codex permissions', exact: true })).toBeEnabled();
}
async function send(page: Page, text: string) {
  await page.getByLabel('Message Codex').fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}
for (const width of [320, 1440]) {
  test(`context is a read-only indicator and usage fits settings at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.addInitScript(
      (theme) => localStorage.setItem('codes.preferences', JSON.stringify({ theme })),
      width === 320 ? 'light' : 'dark',
    );
    let usageReads = 0;
    await page.route('**/api/connection/codex/usage*', (route) => {
      usageReads++;
      return route.fulfill({
        json: {
          limits: {
            status: 'reported',
            value: {
              plan: 'plus',
              availableResets: 2,
              resetCredits: [
                {
                  status: 'available',
                  title: 'Codex reset',
                  grantedAt: 1_799_000_000,
                  expiresAt: 1_801_000_000,
                },
              ],
              windows: [
                {
                  id: 'codex',
                  primary: { usedPercent: 25, durationMins: 300, resetsAt: 1_800_000_000 },
                  secondary: { usedPercent: 50, durationMins: 10080, resetsAt: 1_800_000_000 },
                },
              ],
            },
          },
          activity: { status: 'reported', value: { days: [{ date: '2026-11-27', tokens: 3456 }] } },
        },
      });
    });
    await login(page);
    await send(page, 'Usage indicator fixture');
    await expect(
      page.locator('.turn-status').getByText('Completed', { exact: true }),
    ).toBeVisible();
    const context = page.getByRole('img', { name: 'Context window · 1% used', exact: true });
    await expect(context).toBeInViewport();
    await context.hover();
    const hint = page.locator('.control-tooltip');
    await expect(hint).toContainText('1,200 / 128,000 tokens');
    expect(usageReads).toBe(0);
    await page.mouse.move(2, 2);
    await page.keyboard.press('Escape');
    await expect(hint).toBeHidden();
    await context.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(context).toBeFocused();
    await expect(hint).toContainText('1,200 / 128,000 tokens');
    await context.press('Enter');
    await context.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(usageReads).toBe(0);
    const status = page.getByRole('button', { name: 'Session status', exact: true });
    await status.click();
    await page.getByRole('button', { name: 'Usage and billing', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(dialog.getByRole('group', { name: 'Usage & runtime', exact: true })).toBeVisible();
    const primary = dialog.getByRole('meter', { name: '5-hour limit' });
    const secondary = dialog.getByRole('meter', { name: 'Weekly limit' });
    await expect(primary).toHaveAttribute('aria-valuetext', '75% remaining');
    await expect(secondary).toHaveAttribute('aria-valuetext', '50% remaining');
    await expect(dialog.getByText(/^Resets /)).toHaveCount(2);
    const resets = dialog.getByRole('region', { name: 'Usage limit resets' });
    await expect(resets).toContainText('Available resets');
    await expect(resets.getByText('2', { exact: true })).toBeVisible();
    await expect(resets).toContainText('Codex reset');
    await expect(resets.getByText(/^Expires /)).toBeVisible();
    const activity = dialog.getByRole('region', { name: 'Recent token activity' });
    await expect(activity).toContainText('3,456 tokens');
    const planGrid = (await primary.boundingBox())!;
    const weeklyGrid = (await secondary.boundingBox())!;
    const resetGrid = (await resets.boundingBox())!;
    const activityGrid = (await activity.boundingBox())!;
    if (width === 320) {
      expect(weeklyGrid.y).toBeGreaterThan(planGrid.y);
      expect(activityGrid.y).toBeGreaterThan(resetGrid.y);
    } else {
      expect(weeklyGrid.x).toBeGreaterThan(planGrid.x);
      expect(activityGrid.x).toBeGreaterThan(resetGrid.x);
    }
    const dashboard = dialog.getByRole('link', { name: 'Codex dashboard' });
    await expect(dashboard).toHaveAttribute('target', '_blank');
    await expect(dashboard).toHaveCSS(
      'color',
      width === 320 ? 'rgb(36, 84, 129)' : 'rgb(168, 200, 235)',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const refresh = page.waitForRequest((request) => request.url().endsWith('/usage?refresh=1'));
    await dialog.getByRole('button', { name: 'Refresh usage' }).click();
    await refresh;
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(
      page.getByRole('button', { name: 'Usage and billing', exact: true }),
    ).toBeVisible();
  });
}
test('a confirmed reset uses one available credit and an uncertain response reuses the request', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const key = 'bceda480-e8c9-4eef-8964-29566fd3bb03';
  const requests: unknown[] = [];
  const snapshot = (availableResets: number, usedPercent: number) => ({
    limits: {
      status: 'reported',
      value: {
        availableResets,
        windows: [{ id: 'codex', primary: { usedPercent, durationMins: 300 } }],
      },
    },
    activity: { status: 'unavailable' },
  });
  await page.route('**/api/connection/codex/usage', (route) =>
    route.fulfill({ json: { ...snapshot(1, 90), reset: { key, retry: false } } }),
  );
  await page.route('**/api/connection/codex/usage/reset', (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1)
      return route.fulfill({
        status: 502,
        json: { error: { code: 'RESET_UNCERTAIN', uncertain: true } },
      });
    return route.fulfill({ json: { outcome: 'alreadyRedeemed', usage: snapshot(0, 0) } });
  });
  await login(page);
  await page.getByRole('button', { name: 'Session status', exact: true }).click();
  await page.getByRole('button', { name: 'Usage and billing', exact: true }).click();
  const resets = page.getByRole('region', { name: 'Usage limit resets' });
  const useReset = resets.getByRole('button', { name: 'Use one reset' });
  await useReset.click();
  await expect(resets.getByText(/Use one available reset/)).toBeVisible();
  await resets.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(useReset).toBeFocused();
  expect(requests).toEqual([]);
  await useReset.click();
  await resets.getByRole('button', { name: 'Confirm reset', exact: true }).click();
  await expect(resets.getByRole('status')).toContainText('Retrying uses the same request');
  await resets.getByRole('button', { name: 'Retry same reset' }).click();
  await resets.getByRole('button', { name: 'Confirm reset', exact: true }).click();
  await expect(resets.getByRole('status')).toHaveText('Usage limits reset.');
  await expect(resets.getByText('0', { exact: true })).toBeVisible();
  await expect(page.getByRole('meter', { name: '5-hour limit' })).toHaveAttribute(
    'aria-valuetext',
    '100% remaining',
  );
  await expect(useReset).toHaveCount(0);
  expect(requests).toEqual([{ key }, { key }]);
});
test('Code questions suggest without sending, support radio keys and keep the next draft', async ({
  page,
}) => {
  await login(page);
  const answers: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/actions/') && request.method() === 'POST')
      answers.push(request.postDataJSON());
  });
  await send(page, '[question] Keyboard clarification ' + Date.now());
  const card = page.getByRole('region', { name: 'Your input is needed', exact: true });
  await expect(card).toContainText('OPTIONAL INPUT');
  const sidebarStatus = page.locator('.conversation-row.selected .conversation-status');
  await expect(sidebarStatus).toHaveText('Optional question');
  await expect(sidebarStatus).toBeVisible();
  await expect(card.getByRole('radio', { name: /^Continue/ })).toBeChecked();
  await expect(card.getByRole('button', { name: 'Submit answer', exact: true })).toBeEnabled();
  expect(answers).toEqual([]);
  await page.getByRole('button', { name: 'Answer questions', exact: true }).click();
  await expect(card.getByRole('radio', { name: /^Continue/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(card.getByRole('radio', { name: /^Explain first/ })).toBeChecked();
  await page.getByLabel('Message Codex').fill('Keep my next draft');
  await card.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await expect(sidebarStatus).toHaveText('Completed');
  expect(answers).toEqual([expect.objectContaining({ answers: { direction: 'Explain first' } })]);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep my next draft');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
});
test('Plan questions remain required, and custom text equal to an option stays visible', async ({
  page,
}) => {
  await login(page);
  await page.getByLabel('Message Codex').fill('/plan');
  await page.getByLabel('Message Codex').press('Enter');
  await send(page, '[question] Required clarification ' + Date.now());
  const card = page.getByRole('region', { name: 'Your input is needed', exact: true });
  await expect(card).toContainText('ANSWER REQUIRED');
  const sidebarStatus = page.locator('.conversation-row.selected .conversation-status');
  await expect(sidebarStatus).toHaveText('Needs answer');
  await expect(sidebarStatus).toBeVisible();
  await expect(card.getByRole('button', { name: 'Skip question' })).toHaveCount(0);
  await card.getByLabel('What should happen next?', { exact: true }).fill('Continue');
  await expect(card.getByLabel('What should happen next?', { exact: true })).toHaveValue(
    'Continue',
  );
  await expect(card.getByRole('radio', { name: /^Continue/ })).not.toBeChecked();
  await card.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await expect(sidebarStatus).toHaveText('Completed');
});
test('a phone can explicitly skip an optional question without sending another turn', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await send(page, '[question] Optional phone clarification ' + Date.now());
  const card = page.getByRole('region', { name: 'Your input is needed', exact: true });
  await expect(card).toContainText('OPTIONAL INPUT');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/ide-details-phone-question.png', fullPage: true });
  await card.getByRole('button', { name: 'Skip question', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Answer questions' })).toHaveCount(0);
});
test('file previews show per-file counts, line numbers, layouts and safe literal patch text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await login(page);
  await send(page, '[changes] Detailed patch fixture ' + Date.now());
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await openContextTab(page, 'Changes');
  const panel = page.locator('.context-panel');
  await expect(panel.locator('.diff-overview')).toContainText('2 files');
  const first = panel.getByRole('region', { name: 'Changes in example.ts', exact: true });
  await expect(first.locator('.diff-file-heading')).toContainText('+1');
  await expect(first.locator('.diff-file-heading')).toContainText('−1');
  await expect(first.locator('.line-number').filter({ hasText: /^2$/ })).toHaveCount(2);
  const viewed = first.getByRole('button', { name: 'Mark example.ts as viewed' });
  await viewed.click();
  await expect(viewed).toHaveAttribute('aria-pressed', 'true');
  const split = panel.getByRole('button', { name: 'Side by side', exact: true });
  await expect(split).toHaveCount(0);
  await expect(first.locator('.diff-table-scroll')).toHaveClass(/unified/);
  await page.getByRole('separator', { name: 'Resize project panel' }).press('End');
  await expect(split).toHaveText('');
  await split.hover();
  await expect(page.locator('.control-tooltip')).toHaveText('Side by side');
  await split.click();
  await expect(split).toHaveAttribute('aria-pressed', 'true');
  await expect(first.locator('.diff-table-scroll')).toHaveClass(/split/);
  await expect(first.locator('.diff-code.deletion')).toContainText('Hello');
  await expect(first.locator('.diff-code.addition')).toContainText('Welcome');
  const added = panel.getByRole('region', { name: 'Changes in new-file.txt', exact: true });
  await added.locator('.diff-file-toggle').click();
  await expect(added.locator('.diff-code.addition')).toContainText('<img src=x onerror=alert(1)>');
  await expect(panel.locator('img')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/ide-details-desktop-diff.png', fullPage: true });
  await first.getByRole('button', { name: 'Open file', exact: true }).click();
  await expect(panel.locator('.file-title')).toContainText('example.ts');
  await expect(panel.locator('.file-preview')).toContainText('READ ONLY');
  await panel.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(split).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await openContextTab(page, 'Changes');
  await expect(split).toHaveAttribute('aria-pressed', 'true');
});
test('earlier turn changes remain inspectable after a later turn and reload', async ({ page }) => {
  await login(page);
  await send(page, '[changes] [repeated-edits] Earlier patch fixture ' + Date.now());
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await send(page, 'A later turn without file edits');
  await expect(page.getByTestId('message-assistant')).toHaveCount(2);
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await page.reload();
  await openContextTab(page, 'Changes');
  const panel = page.locator('.context-panel');
  const scope = panel.getByLabel('Change scope');
  const edits = panel.getByRole('region', { name: 'Changes in example.ts', exact: true });
  await expect(edits).toHaveCount(2);
  await expect(panel).toContainText('Native edit sequence');
  await scope.selectOption({ label: 'Last turn' });
  await expect(panel).toContainText('No patch recorded for this turn');
  await expect(panel).toContainText('File edits made by commands or scripts may not have a patch.');
  await scope.selectOption({ index: 1 });
  await edits.last().locator('.diff-file-toggle').click();
  await expect(edits.last()).toContainText('Greetings');
});
test('long patch text wraps in both layouts, with unified changes on phones', async ({ page }) => {
  const removed = `    const previous = "${'previous'.repeat(48)}";`;
  const added = `    const current = "${'current'.repeat(48)}";`;
  const hunk = `@@ -123456 +654321 @@ ${'Long hunk description '.repeat(15)}`;
  await login(page);
  await send(page, 'Synthetic long diff fixture');
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await page.route('**/api/threads/*/snapshot', async (route) => {
    const response = await route.fetch();
    const base: Snapshot = await response.json();
    base.thread.diff = [
      'diff --git a/example.ts b/example.ts',
      '--- a/example.ts',
      '+++ b/example.ts',
      hunk,
      `-${removed}`,
      `+${added}`,
    ].join('\n');
    await route.fulfill({ json: base });
  });
  await page.reload();
  await openContextTab(page, 'Changes');
  const panel = page.locator('.context-panel');
  const file = panel.getByRole('region', { name: 'Changes in example.ts', exact: true });
  const patch = file.getByLabel('Patch for example.ts', { exact: true });
  await expect(patch).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 800 });
  await page.getByRole('separator', { name: 'Resize project panel' }).press('End');
  for (const layout of ['Unified', 'Side by side', 'Phone']) {
    if (layout === 'Phone') {
      await page.setViewportSize({ width: 320, height: 800 });
      await expect(panel.getByRole('button', { name: 'Side by side', exact: true })).toHaveCount(0);
      await expect(file.locator('.diff-table-scroll')).toHaveClass(/unified/);
    } else {
      await panel.getByRole('button', { name: layout, exact: true }).click();
    }
    const shape = await patch.evaluate((element) => {
      const wrappedRows = Array.from(element.querySelectorAll('code'), (code) => {
        const range = document.createRange();
        range.selectNodeContents(code.lastChild!);
        return new Set(Array.from(range.getClientRects(), (rect) => rect.top)).size;
      });
      return { overflow: element.scrollWidth - element.clientWidth, wrappedRows };
    });
    expect(shape.overflow).toBe(0);
    expect(shape.wrappedRows.every((rows) => rows > 1)).toBe(true);
    await expect(patch.locator('.line-number').filter({ hasText: /^123456$/ })).toBeVisible();
    await expect(patch.locator('.line-number').filter({ hasText: /^654321$/ })).toBeVisible();
    await expect(patch.locator('code').filter({ hasText: /const previous/ })).toContainText(
      removed.trim(),
    );
    await expect(patch.locator('code').filter({ hasText: /const current/ })).toContainText(
      added.trim(),
    );
  }
  await page.setViewportSize({ width: 1600, height: 800 });
  await expect(panel.getByRole('button', { name: 'Side by side', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
test('long patches use bounded line windows and fit phone screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await send(page, '[changes] [large-patch] Window fixture ' + Date.now());
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await openContextTab(page, 'Changes');
  const panel = page.locator('.context-panel');
  const added = panel.getByRole('region', { name: 'Changes in new-file.txt', exact: true });
  await added.locator('.diff-file-toggle').click();
  await expect(added.locator('tbody tr')).toHaveCount(200);
  await expect(added.locator('.diff-table')).toContainText('Fixture line 0');
  await added.getByRole('button', { name: 'Next patch lines', exact: true }).click();
  await expect(added.locator('.diff-table')).not.toContainText('Fixture line 0');
  await expect(added.locator('tbody tr')).toHaveCount(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/ide-details-phone-diff.png', fullPage: true });
});
test('oversized patches disclose truncation and proposed file patches can be declined', async ({
  page,
}) => {
  await login(page);
  await send(page, '[changes] [truncated-patch] Truncated fixture ' + Date.now());
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await openContextTab(page, 'Changes');
  await expect(page.locator('.context-panel')).toContainText('This change preview is incomplete');
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await send(page, '[file-approve] Proposed patch ' + Date.now());
  const approval = page.getByRole('region', { name: 'File change approval', exact: true });
  await expect(
    approval.getByRole('region', { name: 'Proposed file changes', exact: true }),
  ).toBeVisible();
  await expect(approval).toContainText('example.ts');
  await approval.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
});
