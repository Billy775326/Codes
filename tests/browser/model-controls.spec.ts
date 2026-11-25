import { expect, test } from '@playwright/test';

test('the composer shows inherited Codex effort and restores speed after an explicit override', async ({
  page,
}) => {
  await page.route('**/api/projects/*/codex-defaults', (route) =>
    route.fulfill({
      json: { model: 'simulated-model', effort: 'high', fast: true, fastAvailable: true },
    }),
  );
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  const picker = page.getByRole('button', { name: 'Model and reasoning', exact: true });
  await expect(picker).toHaveAccessibleDescription(/Demo model.*High.*Codex default.*Fast/);
  await picker.click();
  const speed = page.getByRole('switch', { name: 'Fast mode', exact: true });
  const track = page.locator('.model-menu .fast-switch-track');
  const effort = page.getByLabel('Reasoning effort', { exact: true });
  await expect(effort.locator('option:checked')).toHaveText(/Codex default.*high/);
  await expect(speed).toBeChecked();
  await expect(speed).toHaveAccessibleDescription('Codex default');
  await expect(track).toHaveCSS('background-color', 'rgb(168, 200, 235)');
  await speed.press('Space');
  await expect(speed).not.toBeChecked();
  await expect(track).toHaveCSS('background-color', 'rgb(42, 46, 52)');
  await expect(track).toHaveCSS('border-top-color', 'rgb(173, 179, 189)');
  await expect(track).toHaveCSS('outline-width', '2px');
  await page.getByRole('button', { name: 'Use Codex default speed', exact: true }).click();
  await expect(speed).toBeChecked();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await picker.click();
  await expect(speed).toBeChecked();
  await expect(track).toHaveCSS('background-color', 'rgb(36, 92, 145)');
});

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
    const popup = page.getByRole('dialog', { name: 'Model and reasoning', exact: true });
    const model = popup.getByLabel('Model', { exact: true });
    const effort = popup.getByLabel('Reasoning effort', { exact: true });
    const mode = page.getByLabel('Task mode', { exact: true });
    const modelBounds = (await model.boundingBox())!;
    for (const field of [effort, mode]) {
      const bounds = (await field.boundingBox())!;
      expect(bounds.x).toBeCloseTo(modelBounds.x, 0);
      expect(bounds.width).toBeCloseTo(modelBounds.width, 0);
    }
    await effort.selectOption('high');
    await mode.selectOption('plan');
    expect((await mode.boundingBox())!.width).toBeCloseTo(modelBounds.width, 0);
    await page.getByRole('switch', { name: 'Fast mode', exact: true }).check();
    const reset = popup.getByRole('button', { name: 'Use Codex default speed', exact: true });
    await reset.scrollIntoViewIfNeeded();
    const resetBounds = (await reset.boundingBox())!;
    const modeBounds = (await mode.boundingBox())!;
    expect(resetBounds.x).toBeGreaterThan((await popup.boundingBox())!.x + 12);
    expect(resetBounds.x + resetBounds.width).toBeCloseTo(modeBounds.x + modeBounds.width, 0);
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
  const speed = page.getByRole('switch', { name: 'Fast mode', exact: true });
  await expect(speed).toBeDisabled();
  await expect(speed).toHaveAccessibleDescription('Fast unavailable');
  await expect(page.locator('.model-menu .fast-switch-track')).toHaveCSS(
    'border-top-style',
    'dashed',
  );
  await page.getByLabel('Reasoning effort', { exact: true }).selectOption('high');
  await expect(speed).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Model and reasoning', exact: true }),
  ).toContainText('High');
});
