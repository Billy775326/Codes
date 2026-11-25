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
  test(`sidebar sections and themed wordmark fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await login(page);
    if (width < 700)
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' });
    const navigation =
      width < 700
        ? page.getByRole('dialog', { name: 'Workspace navigation', exact: true })
        : sidebar;
    await expect(navigation.locator('.project-card-name[aria-current="true"]')).toBeVisible();
    const card = navigation.locator('.project-card').filter({
      has: page.locator('.project-card-name[aria-current="true"]'),
    });
    const disclosure = card.locator('.project-card-disclosure');
    const disclosureBox = (await disclosure.boundingBox())!;
    expect(disclosureBox.x).toBeLessThan(
      (await card.locator('.project-card-name').boundingBox())!.x,
    );
    expect(disclosureBox.width).toBeGreaterThanOrEqual(width < 700 ? 40 : 36);
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect((await disclosure.boundingBox())!.x).toBe(disclosureBox.x);
    await disclosure.press('Enter');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.getByRole('button', { name: 'Interaction settings', exact: true }),
    ).toHaveCount(1);
    const view = navigation.getByRole('button', {
      name: 'Archived projects and chats',
      exact: true,
    });
    await expect(view).toHaveAttribute('aria-pressed', 'false');
    await expect(view).toHaveText('');
    const chatsWidth = (await view.boundingBox())!.width;
    await view.click();
    await expect(view).toHaveAttribute('aria-pressed', 'true');
    await expect(view).toHaveText('Archived');
    const archiveWidth = (await view.boundingBox())!.width;
    expect(archiveWidth).toBeGreaterThan(chatsWidth);
    expect(archiveWidth).toBeLessThan(125);
    if (width === 1440) {
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(view).toBeFocused();
      await expect(page.locator('.control-tooltip')).toHaveText('Back to chats');
      await page.keyboard.press('Enter');
    } else await view.click();
    await expect(view).toHaveAttribute('aria-pressed', 'false');
    await expect(
      navigation
        .locator('.conversation-controls')
        .getByRole('button', { name: 'Add project', exact: true }),
    ).toBeVisible();
    const signOut = navigation.getByRole('button', { name: 'Sign out', exact: true });
    await expect(signOut).toBeInViewport({ ratio: 1 });
    await expect(signOut).toHaveText('');
    await expect(
      navigation.getByRole('button', { name: 'Workspace actions', exact: true }),
    ).toHaveCount(0);
    for (const theme of ['light', 'dark']) {
      await navigation.getByRole('button', { name: 'Interaction settings', exact: true }).click();
      await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
      await page.keyboard.press('Escape');
      const brand = navigation.getByRole('img', { name: 'Codes', exact: true });
      const visible = brand.locator('img');
      await expect(visible).toBeVisible();
      expect(
        await visible.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
      ).toBe(true);
      await expect(brand.locator('.brand-wordmark')).toHaveCSS(
        'background-color',
        await brand.evaluate((element) => getComputedStyle(element).color),
      );
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/sidebar-logo-${width}.png`, fullPage: true });
  });
}

test('Codes wordmark remains legible when browser colors differ from the selected theme', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('codes.preferences', '{"theme":"light"}'));
  await page.route('**/assets/*.css', async (route) => {
    const response = await route.fetch();
    const colors = `:root[data-theme='light'] {
      --editor: #1b1b1a;
      --fg: #e8e6e3;
      --field: #222120;
      --muted: #b1aba0;
    }`;
    await route.fulfill({ response, body: (await response.text()) + colors });
  });
  await login(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const navigation = page.getByRole('complementary', { name: 'Workspace navigation' });
  const brand = navigation.getByRole('img', { name: 'Codes', exact: true });
  await brand.locator('img:visible').evaluate((image: HTMLImageElement) => image.decode());
  const png = await brand.screenshot();
  const foregroundPixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + base64;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const start = Math.floor(canvas.width * 0.38);
    const { data } = context.getImageData(start, 0, canvas.width - start, canvas.height);
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] === 232 && data[index + 1] === 230 && data[index + 2] === 227) count++;
    }
    return count;
  }, png.toString('base64'));
  expect(foregroundPixels).toBeGreaterThan(40);
  const placeholder = await navigation
    .getByRole('textbox', { name: 'Search projects and chats' })
    .evaluate((element) => getComputedStyle(element, '::placeholder').color);
  expect(placeholder).toBe('rgb(177, 171, 160)');
});
