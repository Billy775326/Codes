import { expect, type Page } from '@playwright/test';

export async function reconnectUpdates(page: Page) {
  const menu = page.getByRole('button', { name: 'Workspace actions', exact: true });
  const opened = !(await menu.isVisible());
  if (opened) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await menu.click();
  await page.getByRole('button', { name: 'Reconnect updates', exact: true }).click();
  await expect(menu).toBeFocused();
  if (opened) await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
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
  await projectCard(page, id).locator('.project-card-name').click();
}
