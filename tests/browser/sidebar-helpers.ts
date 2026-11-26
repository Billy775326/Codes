import { expect, type Page } from '@playwright/test';

export async function reconnectUpdates(page: Page) {
  // Refresh the fixture snapshot through the browser's normal online event.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
  });
}

export function conversationList(page: Page) {
  return page.getByRole('navigation', { name: 'Conversations', exact: true });
}

export async function chooseWorkingDirectory(page: Page, path: string) {
  const trigger = page.getByRole('button', { name: 'Change working directory', exact: true });
  const empty = page.getByRole('button', { name: 'Choose a working directory', exact: true });
  await trigger.or(empty).click();
  const picker = page.getByRole('dialog', { name: 'Choose a working directory' });
  await picker.getByLabel('Working directory', { exact: true }).fill(path);
  await picker.getByRole('button', { name: 'Use directory', exact: true }).click();
  await expect(picker).toHaveCount(0);
}

export function contextTrigger(page: Page) {
  return page.getByRole('button', { name: 'Files and changes', exact: true });
}

export async function openContextTab(page: Page, tab: 'Files' | 'Changes') {
  const panel = page.locator('#sidebar-context');
  if (!(await panel.isVisible())) await contextTrigger(page).click();
  const button = panel.getByRole('button', { name: tab, exact: true });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  return panel;
}
