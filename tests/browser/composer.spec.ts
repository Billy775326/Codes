import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('.connection')).toHaveText('Connected');
}
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
            '.composer-attachment-controls > .icon-button',
            '.composer-toolbar > select',
            '.model-menu > summary',
            '.send-button',
          ]
        : ['.composer-attachment-controls > .icon-button', '.composer-toolbar > select'];
    const centers: number[] = [];
    for (const selector of selectors)
      for (const control of await page.locator(selector).all()) {
        const box = await control.boundingBox();
        centers.push(box!.y + box!.height / 2);
      }
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
    await expect(
      page
        .getByLabel('Project', { exact: true })
        .or(page.getByLabel('Current project', { exact: true })),
    ).toHaveCount(1);
    await expect(page.locator('#message-delivery-help')).toBeHidden();
    await expect(input).toHaveAccessibleDescription(/Send starts a new turn/);
    await input.fill(Array.from({ length: 24 }, (_, i) => 'Synthetic draft line ' + i).join('\n'));
    expect((await input.boundingBox())!.height).toBeLessThanOrEqual(180);
    expect(await input.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await input.fill('A short draft');
    expect((await input.boundingBox())!.height).toBeLessThanOrEqual(80);
    await expect(page.locator('#message-delivery-help')).toContainText(
      'sent history stays unchanged',
    );
    for (const theme of ['dark', 'light']) {
      await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
      await page.getByLabel('Workspace theme').selectOption(theme);
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
  await page.getByLabel('Enter behavior').selectOption('cmdIfMultiline');
  await page.keyboard.press('Escape');
  const input = page.getByLabel('Message Codex');
  await input.fill('One line');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toHaveAttribute(
    'title',
    /Enter to send/,
  );
  await input.fill('First line\nSecond line');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toHaveAttribute(
    'title',
    /Ctrl\/Cmd\+Enter to send/,
  );
  await input.fill('[approve] Composer queue fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  await input.fill('Waiting follow-up');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Queue message', exact: true })).toHaveAttribute(
    'title',
    /Enter to queue/,
  );
  await expect(page.locator('#message-delivery-help')).toContainText('Waiting text stays editable');
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
      expect(
        await option.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return element === hit || element.contains(hit);
        }),
      ).toBe(true);
      await option.click();
      await expect(picker).toHaveText(label);
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
