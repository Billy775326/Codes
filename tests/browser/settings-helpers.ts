import type { Locator, Page } from '@playwright/test';

export async function chooseSettingsSection(scope: Locator | Page, name: string) {
  const categories = scope.getByRole('button', { name: 'Settings categories', exact: true });
  if (
    (await categories.isVisible()) &&
    (await categories.getAttribute('aria-expanded')) === 'false'
  )
    await categories.click();
  await scope.getByRole('button', { name, exact: true }).click();
}
