import { expect, test } from '@playwright/test';
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 320, height: 640 },
  { width: 390, height: 480 },
])
  test(`model/effort summary, native mode and Fast remain usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page
      .getByLabel('Workspace access token')
      .fill('test-only-browser-token-not-a-real-secret');
    await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    const picker = page.getByRole('button', { name: 'Model and reasoning', exact: true });
    await expect(picker).toContainText('Demo model');
    await expect(picker).toContainText('Medium');
    await expect(picker).toHaveAccessibleDescription(
      /Demo model.*Medium.*model default.*Execution/,
    );
    const draft = 'Keep this unsent model settings draft';
    await page.getByLabel('Message Codex').fill(draft);
    let requests = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        /\/(send|queue|review|steer)$/.test(new URL(request.url()).pathname)
      )
        requests++;
    });
    await picker.click();
    const mode = page.getByLabel('Task mode', { exact: true });
    const executionWidth = (await mode.boundingBox())!.width;
    await page.getByLabel('Reasoning effort', { exact: true }).selectOption('high');
    await mode.selectOption('plan');
    expect((await mode.boundingBox())!.width).toBeLessThan(executionWidth);
    await page.getByRole('switch', { name: 'Fast mode', exact: true }).check();
    await expect(page.getByLabel('Reasoning effort', { exact: true })).toHaveValue('high');
    for (const locator of [
      page.getByLabel('Model', { exact: true }),
      page.getByLabel('Reasoning effort', { exact: true }),
      page.getByLabel('Task mode', { exact: true }),
      page.getByRole('switch', { name: 'Fast mode', exact: true }),
    ]) {
      await locator.scrollIntoViewIfNeeded();
      expect(
        await locator.evaluate((element) => {
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
    await expect(picker).toContainText('High');
    await expect(picker).toHaveAccessibleDescription(/High.*Fast.*Plan/);
    await expect(page.getByLabel('Message Codex')).toHaveValue(draft);
    await expect(page.getByRole('button', { name: 'Exit Plan mode', exact: true })).toBeVisible();
    expect(requests).toBe(0);
    const request = page.waitForRequest((r) => r.url().endsWith('/send') && r.method() === 'POST');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    expect((await request).postDataJSON().settings).toMatchObject({
      effort: 'high',
      mode: 'plan',
      fast: true,
    });
    await expect(
      page.locator('.turn-status').getByText('Completed', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(picker).toContainText('High');
    await picker.click();
    await expect(page.getByRole('switch', { name: 'Fast mode', exact: true })).toBeChecked();
    await expect(page.getByLabel('Task mode', { exact: true })).toHaveValue('plan');
    await page.getByRole('switch', { name: 'Fast mode', exact: true }).uncheck();
    await page.getByLabel('Task mode', { exact: true }).selectOption('default');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Exit Plan mode', exact: true })).toHaveCount(0);
    await expect(picker).toHaveAccessibleDescription(/High.*Execution/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const effortBounds = await picker.locator('.model-selection-effort').boundingBox();
    const pickerBounds = await picker.boundingBox();
    expect(effortBounds!.x).toBeGreaterThanOrEqual(pickerBounds!.x);
    expect(effortBounds!.x + effortBounds!.width).toBeLessThanOrEqual(
      pickerBounds!.x + pickerBounds!.width,
    );
    await page.screenshot({
      path: `test-results/model-controls-${viewport.width}-${viewport.height}.png`,
    });
  });

test('unavailable Fast is disabled without changing model effort or dispatching', async ({
  page,
}) => {
  await page.route('**/api/models', async (route) => {
    const response = await route.fetch();
    const models = await response.json();
    await route.fulfill({
      json: models.map((model: object) => ({ ...model, supportsFast: false })),
    });
  });
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Model and reasoning', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Fast mode', exact: true })).toBeDisabled();
  await page.getByLabel('Reasoning effort', { exact: true }).selectOption('high');
  await expect(page.getByRole('switch', { name: 'Fast mode', exact: true })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Model and reasoning', exact: true }),
  ).toContainText('High');
});
