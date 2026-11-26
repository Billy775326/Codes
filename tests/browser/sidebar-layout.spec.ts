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
    const filter = navigation.getByRole('group', { name: 'Archive filter' });
    await expect(navigation.getByRole('group', { name: 'Directory filter' })).toHaveCount(0);
    await expect(filter.getByRole('button')).toHaveCount(2);
    await expect(filter.getByRole('button', { name: 'Active', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const archived = filter.getByRole('button', { name: 'Archived', exact: true });
    await archived.click();
    await expect(archived).toHaveAttribute('aria-pressed', 'true');
    await expect(navigation.getByRole('textbox', { name: 'Search conversations' })).toBeVisible();
    await filter.getByRole('button', { name: 'Active', exact: true }).click();
    await expect(archived).toHaveAttribute('aria-pressed', 'false');
    const newConversation = navigation.getByRole('button', {
      name: 'New conversation',
      exact: true,
    });
    await expect(newConversation).toBeVisible();
    await expect(newConversation).toHaveText(width < 700 ? 'New' : 'New conversation');
    const brand = navigation.getByRole('img', { name: 'Codes', exact: true });
    const close = navigation.getByRole('button', { name: 'Close navigation' });
    const newBounds = (await newConversation.boundingBox())!;
    const closeBounds = (await close.boundingBox())!;
    const brandBounds = (await brand.boundingBox())!;
    if (width < 700) {
      expect(newBounds.x).toBeGreaterThanOrEqual(brandBounds.x + brandBounds.width);
      expect(newBounds.x + newBounds.width).toBeLessThanOrEqual(closeBounds.x);
      expect(newBounds.height).toBeGreaterThanOrEqual(44);
    } else {
      expect(newBounds.y).toBeGreaterThanOrEqual(brandBounds.y + brandBounds.height);
    }
    await expect(navigation.getByRole('button', { name: 'Refresh conversations' })).toHaveCount(0);
    const sort = navigation.getByRole('button', { name: 'Sort conversations', exact: true });
    await expect(sort).toHaveText('Last updated');
    await expect(sort).toBeInViewport({ ratio: 1 });
    await sort.press('ArrowDown');
    const sortMenu = navigation.getByRole('dialog', { name: 'Sort conversations' });
    const lastUpdated = sortMenu.getByRole('button', { name: 'Last updated' });
    const dateCreated = sortMenu.getByRole('button', { name: 'Date created' });
    await expect(sortMenu).toBeInViewport({ ratio: 1 });
    await expect(lastUpdated).toBeFocused();
    await expect(lastUpdated).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(dateCreated).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sort).toHaveText('Date created');
    await expect(sort).toBeFocused();
    await sort.click();
    await expect(dateCreated).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(sortMenu).toHaveCount(0);
    await expect(sort).toBeFocused();
    await sort.click();
    await navigation.getByRole('textbox', { name: 'Search conversations' }).click();
    await expect(sortMenu).toHaveCount(0);
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
    .getByRole('textbox', { name: 'Search conversations' })
    .evaluate((element) => getComputedStyle(element, '::placeholder').color);
  expect(placeholder).toBe('rgb(177, 171, 160)');
});
