import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 320, height: 640 },
  { width: 390, height: 480 },
])
  test(`native settings and explicit Plan fit ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/projects/*/codex-configuration', (route) =>
      route.fulfill({
        json: {
          model: 'configured-model',
          effort: 'high',
          planEffort: 'medium',
          fast: true,
          sandbox: 'read-only',
        },
      }),
    );
    await page.goto('/');
    await page
      .getByLabel('Workspace access token')
      .fill('test-only-browser-token-not-a-real-secret');
    await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    const model = page.getByRole('button', { name: 'Model and reasoning', exact: true });
    await expect(model).toContainText('configured-model');
    await expect(model).toContainText('high');
    const draft = 'Keep this unsent model settings draft';
    await page.getByLabel('Message Codex').fill(draft);
    await model.click();
    const popup = page.getByRole('dialog', { name: 'Model and reasoning', exact: true });
    await expect(popup).toContainText('Fast');
    const mode = popup.getByLabel('Task mode', { exact: true });
    await mode.selectOption('plan');
    await page.keyboard.press('Escape');
    await expect(model).toContainText('medium');
    await expect(page.getByRole('button', { name: 'Exit Plan mode' })).toBeVisible();
    await expect(page.getByLabel('Message Codex')).toHaveValue(draft);
    const request = page.waitForRequest((r) => r.url().endsWith('/send') && r.method() === 'POST');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    expect((await request).postDataJSON().settings).toEqual({ mode: 'plan' });
    await expect(
      page.locator('.turn-status').getByText('Completed', { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
