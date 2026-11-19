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
