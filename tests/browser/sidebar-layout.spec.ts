import { expect, test, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'Codes', exact: true })).toBeVisible();
  const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(favicon).toBe('/brand/codes-icon.svg');
  const icon = await page.request.get(favicon!);
  expect(icon.headers()['content-type']).toContain('image/svg+xml');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toBeVisible();
}
for (const width of [1440, 390, 320]) {
  test(`sidebar sections and original theme logos fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await login(page);
    if (width < 700)
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' });
    const navigation =
      width < 700
        ? page.getByRole('dialog', { name: 'Workspace navigation', exact: true })
        : sidebar;
    await expect(navigation.getByRole('region', { name: 'Project context' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Interaction settings', exact: true }),
    ).toHaveCount(1);
    await expect(navigation.getByLabel('Conversation view', { exact: true })).toHaveValue('chats');
    await navigation.getByLabel('Conversation view', { exact: true }).selectOption('archived');
    await expect(navigation.getByLabel('Conversation view', { exact: true })).toHaveValue(
      'archived',
    );
    await navigation.getByLabel('Conversation view', { exact: true }).selectOption('chats');
    await navigation.getByRole('button', { name: 'Workspace actions', exact: true }).click();
    const menu = navigation.getByRole('dialog', { name: 'Workspace actions', exact: true });
    for (const name of ['Add project', 'Reconnect updates', 'Sign out'])
      await expect(menu.getByRole('button', { name, exact: true })).toBeVisible();
    const box = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(
      navigation.getByRole('button', { name: 'Workspace actions', exact: true }),
    ).toBeFocused();
    for (const theme of ['light', 'dark']) {
      await navigation.getByRole('button', { name: 'Interaction settings', exact: true }).click();
      await page.getByLabel('Workspace theme').selectOption(theme);
      await page.keyboard.press('Escape');
      const visible = navigation.locator('.brand img:visible');
      await expect(visible).toHaveCount(1);
      await expect(visible).toHaveAttribute('src', `/brand/codes-lockup-${theme}.svg`);
      expect(
        await visible.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
      ).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/sidebar-logo-${width}.png`, fullPage: true });
  });
}
