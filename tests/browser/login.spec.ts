import { test, expect } from '@playwright/test';

const token = 'test-only-browser-token-not-a-real-secret';
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 820, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`sign-in remains readable and usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const input = page.getByLabel('Workspace access token');
    await expect(input).toBeEnabled();
    await expect(input).toHaveAttribute('type', 'password');
    await expect(page.getByRole('button', { name: 'Open workspace', exact: true })).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Open workspace', exact: true })).toBeVisible();
    const panel = await page.locator('.login-panel').boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width);
    expect(Math.abs(panel!.x + panel!.width / 2 - viewport.width / 2)).toBeLessThan(2);
    await expect(page.getByText('In clear focus.', { exact: false })).toHaveCount(0);
    await page.getByText('Where do I find my token?', { exact: true }).click();
    await expect(page.locator('.login-help code')).toHaveText('.local/access-token');
    await expect(page.locator('.login-help code')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/login-${viewport.width}.png`, fullPage: true });
  });
}

test('sign-in keeps token visibility, pending controls, errors, and keyboard submission usable', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByLabel('Workspace access token');
  await expect(input).toBeEnabled();
  await input.fill('incorrect-test-token-for-signin');
  const visibility = page.getByRole('button', { name: 'Show access token', exact: true });
  await visibility.hover();
  const tooltip = page.locator('.control-tooltip');
  await expect(tooltip).toHaveText('Show access token');
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
  await visibility.click();
  await expect(input).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide access token', exact: true }).click();
  await expect(input).toHaveAttribute('type', 'password');
  let release!: () => void;
  const pending = new Promise<void>((yes) => {
    release = yes;
  });
  await page.route('**/api/login', async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    await expect(input).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Signing in…', exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByRole('alert')).toContainText('incorrect');
  await expect(input).toHaveValue('incorrect-test-token-for-signin');
  await expect(input).toBeEnabled();
  await input.fill(token);
  await input.press('Enter');
  await expect(page.getByLabel('Message Codex')).toBeVisible();
  expect(
    await page.evaluate(
      (value) => Object.values(localStorage).some((entry) => entry.includes(value)),
      token,
    ),
  ).toBe(false);
});

test('a failed session check can reconnect without reloading the page', async ({ page }) => {
  let unavailable = true;
  await page.route(/\/api\/(system|projects)$/, async (route) => {
    if (unavailable) await route.abort('failed');
    else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('could not reach this service address');
  await expect(page.getByLabel('Workspace access token')).toBeDisabled();
  unavailable = false;
  await page.getByRole('button', { name: 'Retry connection', exact: false }).click();
  await expect(page.getByLabel('Workspace access token')).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
