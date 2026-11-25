import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('.connection')).toHaveText('Connected');
}
test('send arrow remains visible on hover and with an empty composer in both themes', async ({
  page,
}) => {
  await login(page);
  const input = page.getByLabel('Message Codex');
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  const contrast = () =>
    send.locator('svg').evaluate((icon) => {
      const luminance = (color: string) => {
        const rgb = color.match(/\d+(?:\.\d+)?/g)!.map((component) => {
          const value = Number(component) / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
      };
      const stroke = luminance(getComputedStyle(icon).stroke);
      const background = luminance(getComputedStyle(icon.parentElement!).backgroundColor);
      return (Math.max(stroke, background) + 0.05) / (Math.min(stroke, background) + 0.05);
    });
  for (const theme of ['dark', 'light']) {
    await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    await input.fill('A short draft');
    await expect(send).toBeEnabled();
    expect(await contrast()).toBeGreaterThanOrEqual(3);
    await send.hover();
    expect(await contrast()).toBeGreaterThanOrEqual(3);

    await input.clear();
    await expect(send).toBeDisabled();
    await send.hover({ force: true });
    await expect(send).toHaveCSS('opacity', '1');
    expect(await contrast()).toBeGreaterThanOrEqual(3);
  }
});
for (const width of [1440, 320]) {
  test(`composer has one focus border, bounded input and aligned controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 720 : 1000 });
    await login(page);
    const input = page.getByLabel('Message Codex');
    await input.fill('A short draft');
    await expect(input).toBeFocused();
    expect(await input.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('none');
    expect(await input.evaluate((e) => getComputedStyle(e).fontSize)).toBe(
      width > 700 ? '15px' : '16px',
    );
    expect(await input.evaluate((e) => getComputedStyle(e).fontFamily)).toBe(
      await page.locator('.app').evaluate((e) => getComputedStyle(e).fontFamily),
    );
    const selectors =
      width > 460
        ? [
            '.composer-attachment-menu > summary',
            '.permission-menu > summary',
            '.model-menu > summary',
            '.send-button',
          ]
        : ['.composer-attachment-menu > summary', '.permission-menu > summary'];
    const centers: number[] = [];
    for (const selector of selectors)
      for (const control of await page.locator(selector).all()) {
        const box = await control.boundingBox();
        centers.push(box!.y + box!.height / 2);
      }
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
    await expect(page.locator('.project-card-name[aria-current="true"]')).toHaveCount(1);
    await expect(page.locator('#message-delivery-help')).toBeHidden();
    await expect(input).toHaveAccessibleDescription(/Starts a new turn/);
    await input.fill(Array.from({ length: 24 }, (_, i) => 'Synthetic draft line ' + i).join('\n'));
    expect((await input.boundingBox())!.height).toBeLessThanOrEqual(180);
    expect(await input.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await input.fill('A short draft');
    expect((await input.boundingBox())!.height).toBeLessThanOrEqual(80);
    await expect(page.locator('#message-delivery-help')).toContainText('Starts a new turn.');
    for (const theme of ['dark', 'light']) {
      await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
      await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
      await page.keyboard.press('Escape');
      await input.focus();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `test-results/composer-${width}-${theme}.png`,
        fullPage: true,
      });
    }
  });
}
test('composer shortcut hints follow multiline preferences and a waiting queue', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Send shortcut', exact: true })
    .selectOption('cmdIfMultiline');
  await page
    .getByRole('combobox', { name: 'Follow-up delivery', exact: true })
    .selectOption('steer');
  await page.keyboard.press('Escape');
  const input = page.getByLabel('Message Codex');
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  const tooltip = page.locator('.control-tooltip');
  await input.fill('One line');
  await send.hover();
  await expect(tooltip).toHaveText('Send message · Enter');
  await expect(tooltip).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await send.hover();
  await expect(tooltip).toHaveText('Send message · Ctrl/Cmd+Enter');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await input.hover();
  await expect(tooltip).toBeHidden();
  await input.fill('First line\nSecond line');
  await send.hover();
  await expect(tooltip).toHaveText('Send message · Ctrl/Cmd+Enter');
  await expect(tooltip).toBeVisible();
  await input.fill('[approve] Composer queue fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  await input.fill('Waiting follow-up');
  const queue = page.getByRole('button', { name: 'Queue message', exact: true });
  await expect(queue).toHaveClass(/\bdelivery-primary\b/);
  const addNow = page.getByRole('button', { name: 'Add to current task', exact: true });
  await expect(addNow).toBeDisabled();
  await addNow.hover();
  await expect(tooltip).toHaveText('Add to current task · Respond to the approval first.');
  await addNow.press('Enter');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await queue.hover();
  await expect(tooltip).toHaveText('Queue for next turn · Enter');
  await expect(tooltip).toBeVisible();
  const stop = page.getByRole('button', { name: 'Stop task', exact: true });
  await stop.hover();
  await expect(tooltip).toHaveText('Stop task');
  await expect(tooltip).toBeVisible();
  await queue.click();
  await stop.hover();
  await expect(tooltip).toHaveText('Stop task · Pause queue');
  await expect(input).toHaveValue('');
  await queue.hover();
  await expect(tooltip).toHaveText('Queue message · Write a message first.');
  await expect(tooltip).toBeVisible();
  for (let index = 1; index < 10; index++) {
    await input.fill('More queued work ' + index);
    await queue.click();
  }
  await input.fill('Keep this unsent draft');
  await expect(queue).toBeDisabled();
  await input.hover();
  await queue.hover();
  await expect(tooltip).toHaveText('Queue message · Queue full. Remove a queued message.');
  await expect(queue).not.toHaveAttribute('aria-keyshortcuts');
  await page.getByRole('button', { name: 'Remove queued message', exact: true }).last().click();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('Keep this unsent draft');
  await expect(page.locator('#message-delivery-help')).toContainText(
    'Resume the queue to send waiting messages.',
  );
});

test('the model picker remains usable above a tall draft in a short phone viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await login(page);
  await page
    .getByLabel('Message Codex')
    .fill(Array.from({ length: 20 }, () => 'Long draft line').join('\n'));
  await page.getByRole('button', { name: 'Model and reasoning', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Model and reasoning', exact: true });
  const box = await popup.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(480);
  for (const label of ['Model', 'Reasoning effort']) {
    const field = page.getByLabel(label, { exact: true });
    await field.scrollIntoViewIfNeeded();
    expect(
      await field.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        );
        return hit === element || element.contains(hit);
      }),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Message Codex')).toHaveValue(/Long draft line/);
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 320, height: 640 },
  { width: 390, height: 480 },
]) {
  test(`Codex permissions replace Code and reach task dispatch at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page
      .getByLabel('Workspace access token')
      .fill('test-only-browser-token-not-a-real-secret');
    await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    const picker = page.getByRole('button', { name: 'Codex permissions', exact: true });
    await expect(picker).toBeEnabled();
    await expect(page.getByLabel('Mode', { exact: true })).toHaveCount(0);
    for (const [label, value] of [
      ['Full access', 'danger-full-access'],
      ['Ask for approval', 'workspace-write'],
      ['Read only', 'read-only'],
    ] as const) {
      await picker.click();
      const option = page.getByRole('button', { name: new RegExp('^' + label) });
      await option.scrollIntoViewIfNeeded();
      expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        await option.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return element === hit || element.contains(hit);
        }),
      ).toBe(true);
      await option.click();
      await expect(picker).toHaveText(label);
      expect(
        await picker
          .locator('.permission-selection')
          .evaluate((text) => text.scrollWidth <= text.clientWidth),
      ).toBe(true);
      const request = page.waitForRequest(
        (request) => request.url().endsWith('/send') && request.method() === 'POST',
      );
      await page.getByLabel('Message Codex').fill('[slow] Permissions ' + label + Date.now());
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      expect((await request).postDataJSON().settings.permission).toBe(value);
      await expect(picker).toBeEnabled();
      await picker.click();
      await expect(
        page.getByRole('dialog', { name: 'Codex permissions', exact: true }),
      ).toBeVisible();
      await expect(page.getByText('Conversation permissions', { exact: true })).toBeVisible();
      await expect(
        page
          .getByRole('group', { name: 'Permission presets' })
          .getByRole('button', { pressed: true }),
      ).toHaveAccessibleName(label);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Stop task', exact: true }).click();
      await expect(picker).toBeEnabled();
    }
    await page.reload();
    await expect(picker).toHaveText('Read only');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('Up and Down recall conversation messages without replacing the stored draft', async ({
  page,
}) => {
  await login(page);
  const draft = page.getByLabel('Message Codex');
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  const older = 'Recall the selected function';
  const newer = 'A follow-up\nwith a second line';
  await page.getByRole('button', { name: 'Browse files', exact: true }).click();
  await page.getByRole('button', { name: 'example.ts', exact: true }).click();
  await page
    .getByRole('group', { name: 'File lines', exact: true })
    .getByRole('button')
    .first()
    .click();
  await page.getByRole('button', { name: /^Attach lines/ }).click();
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await draft.fill(older);
  await send.click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await expect(page.getByTestId('message-user')).toContainText('File context');
  await draft.fill(newer);
  await send.click();
  await expect(page.getByTestId('message-user')).toHaveCount(2);
  await expect(send).toBeVisible();

  const scratch = 'Keep this unsent draft';
  await draft.fill(scratch);
  await draft.press('ArrowUp');
  await expect(draft).toHaveValue(newer);
  await draft.press('ArrowUp');
  await expect(draft).toHaveValue(older);
  await draft.press('ArrowUp');
  await expect(draft).toHaveValue(older);
  await draft.press('ArrowDown');
  await expect(draft).toHaveValue(newer);
  await draft.press('ArrowDown');
  await expect(draft).toHaveValue(scratch);
  await expect(page.getByTestId('message-user')).toHaveCount(2);

  for (const text of ['First line\nSecond line', 'A soft wrapped draft '.repeat(80)]) {
    await draft.fill(text);
    await draft.press('ArrowUp');
    await expect(draft).toHaveValue(text);
    expect(
      await draft.evaluate((element: HTMLTextAreaElement) => element.selectionStart),
    ).toBeLessThan(text.length);
  }
  await draft.fill(scratch);
  await draft.dispatchEvent('keydown', { key: 'ArrowUp', isComposing: true, bubbles: true });
  await expect(draft).toHaveValue(scratch);
  await draft.press('Shift+ArrowUp');
  await expect(draft).toHaveValue(scratch);
  await draft.press('End');
  await draft.press('ArrowUp');
  await expect(draft).toHaveValue(newer);
  await page.reload();
  await expect(draft).toHaveValue(scratch);

  await draft.press('Control+n');
  await expect(draft).toHaveValue('');
  await draft.press('ArrowUp');
  await expect(draft).toHaveValue('');
});
