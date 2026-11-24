import { expect, type Page } from '@playwright/test';

export async function reconnectUpdates(page: Page) {
  // Refresh the fixture snapshot through the browser's normal online event.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
  });
}

export function projectCard(page: Page, id: string) {
  return page.locator('[data-project-id="' + id + '"]');
}

export function activeProjectCard(page: Page) {
  return page.locator('.project-card').filter({
    has: page.locator('.project-card-name[aria-current="true"]'),
  });
}

export async function openProject(page: Page, id: string) {
  const name = projectCard(page, id).locator('.project-card-name');
  if ((await name.getAttribute('aria-expanded')) === 'false') {
    await name.click();
    await expect(name).not.toHaveAttribute('aria-expanded', 'false');
  }
  await name.click();
  await expect(name).toHaveAttribute('aria-current', 'true');
}
