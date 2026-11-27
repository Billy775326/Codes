import { chooseSettingsSection } from './settings-helpers';
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
    await expect(page.getByRole('heading', { name: 'Codes', exact: true })).toBeVisible();
    await expect(page.getByText('Service address', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change access token' })).toHaveCount(0);
    const panel = await page.locator('.login-panel').boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width);
    expect(Math.abs(panel!.x + panel!.width / 2 - viewport.width / 2)).toBeLessThan(2);
    await expect(page.getByText('In clear focus.', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Where do I find my token?', { exact: true })).toHaveCount(0);
    expect(await page.locator('body').textContent()).not.toContain('.local/access-token');
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

test('sign-in reloads a stale web page and restores the draft', async ({ page }) => {
  let probes = 0;
  let submissions = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/login') submissions++;
  });
  await page.route('**/api/web-build', (route) =>
    ++probes === 1
      ? route.fulfill({ json: { signature: '/assets/fresh-build-fixture.js' } })
      : route.continue(),
  );
  await page.goto('/?view=workspace');
  await page.evaluate(() => localStorage.setItem('codes.draft.new', 'Draft in the older tab'));
  const navigation = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
  await page.getByLabel('Workspace access token').fill(token);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await navigation;
  await expect(page).toHaveURL(/\/?\?view=workspace$/);
  await expect(page.getByLabel('Message Codex')).toHaveValue('Draft in the older tab');
  await expect(page.getByLabel('Workspace access token')).toHaveCount(0);
  expect(submissions).toBe(1);
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

test('changes a file-backed access token and keeps the draft through sign-in', async ({
  page,
  browser,
  baseURL,
}) => {
  const replacement = 'replacement-access-token-test-fixture';
  const headers = { origin: baseURL! };
  const observer = await browser.newContext({ baseURL });
  try {
    const observerLogin = await observer.request.post('/api/login', { headers, data: { token } });
    expect(observerLogin.ok()).toBe(true);
    await page.setViewportSize({ width: 320, height: 680 });
    await page.goto('/');
    const tokenInput = page.getByLabel('Workspace access token', { exact: true });
    await tokenInput.fill(token);
    await tokenInput.press('Enter');
    await page.getByLabel('Message Codex').fill('Keep this draft after changing the token.');
    await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await chooseSettingsSection(dialog, 'Network & access');
    await dialog.getByRole('button', { name: 'Change access token', exact: true }).click();
    await dialog.getByLabel('Current token', { exact: true }).fill(token);
    await dialog.getByLabel('New token', { exact: true }).fill(replacement);
    const confirmation = dialog.getByLabel('Confirm new token', { exact: true });
    await confirmation.fill('mismatched-test-token');
    await expect(dialog.getByRole('button', { name: 'Save new token' })).toBeDisabled();
    await confirmation.fill(replacement);
    await dialog.getByRole('button', { name: 'Save new token' }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Access token changed. Sign in with your new token.' }),
    ).toBeVisible();
    expect((await observer.request.get('/api/system')).status()).toBe(401);
    await expect(tokenInput).toHaveValue('');
    await tokenInput.fill(replacement);
    await tokenInput.press('Enter');
    await expect(page.getByLabel('Message Codex')).toHaveValue(
      'Keep this draft after changing the token.',
    );
    await expect(dialog).toHaveCount(0);
  } finally {
    const login = await observer.request.post('/api/login', {
      headers,
      data: { token: replacement },
    });
    if (login.ok()) {
      const restored = await observer.request.put('/api/settings/access-token', {
        headers,
        data: { current: replacement, replacement: token },
      });
      expect(restored.ok()).toBe(true);
    }
    await observer.close();
  }
});

test('the installed language applies before sign-in and yields to a saved browser language', async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      await route.fulfill({
        response,
        body: source.replace('<html lang="en">', '<html lang="zh-CN">'),
      });
    },
  );
  await page.goto('/');
  await expect(page.getByLabel('工作区访问令牌')).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.evaluate(() => {
    localStorage.setItem('codes.preferences', JSON.stringify({ language: 'en' }));
  });
  await page.reload();
  await expect(page.getByLabel('Workspace access token')).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
