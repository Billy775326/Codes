import { expect, test, type Page } from '@playwright/test';

async function openFiles(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Browse files', exact: true }).click();
}

for (const width of [1440, 320]) {
  test(`Files gives the list and preview usable space at ${width}px`, async ({ page }) => {
    const narrow = width === 320;
    await page.setViewportSize({ width, height: narrow ? 570 : 850 });
    await page.emulateMedia({ colorScheme: narrow ? 'light' : 'dark' });
    const extraFiles = Array.from({ length: 40 }, (_, index) => {
      const name = `fixture-${index}.txt`;
      return { name, path: name, directory: false };
    });
    await page.route('**/api/projects/*/files?*', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ json: [...(await response.json()), ...extraFiles] });
    });
    await openFiles(page);
    const panel = page.locator('.context-panel');
    const list = panel.locator('.file-list');
    const entry = list.getByRole('button', { name: 'example.ts', exact: true });
    await expect(entry).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Show hidden files' })).toBeInViewport();
    expect((await list.boundingBox())!.height).toBeGreaterThan(300);
    await entry.click();
    const preview = panel.getByRole('region', { name: 'File preview' });
    await expect(preview).toContainText('export function hello');
    const attach = preview.getByRole('button', { name: 'Attach lines' });
    await expect(attach).toBeInViewport();
    const close = preview.getByRole('button', {
      name: narrow ? 'Back to files' : 'Close file preview',
    });
    if (narrow) {
      await expect(list).toBeHidden();
      await expect(close).toBeFocused();
    } else {
      expect((await list.boundingBox())!.height).toBeLessThan(
        (await preview.boundingBox())!.height,
      );
      await expect(entry).toHaveAttribute('aria-current', 'true');
    }
    await close.click();
    await expect(preview).toHaveCount(0);
    await expect(entry).toBeFocused();
    expect((await list.boundingBox())!.height).toBeGreaterThan(300);
  });
}

test('Files opts into hidden entries and preserves an explicitly attached file when hiding them again', async ({
  page,
}) => {
  await openFiles(page);
  const files = page.getByRole('region', { name: 'Project files', exact: true });
  const toggle = files.getByRole('button', { name: 'Show hidden files', exact: true });
  await expect(files.getByRole('button', { name: 'example.ts', exact: true })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(files.getByRole('button', { name: '.gitignore', exact: true })).toHaveCount(0);
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(files.getByRole('button', { name: '.gitignore', exact: true })).toBeVisible();

  await files.getByRole('button', { name: 'conversation-fixtures', exact: true }).click();
  await files.getByRole('button', { name: '.settings', exact: true }).click();
  await files.getByRole('button', { name: '.options', exact: true }).click();
  const preview = page.getByRole('region', { name: 'File preview', exact: true });
  await expect(preview).toContainText('Fixture option');
  await preview.getByRole('button', { name: 'Attach file', exact: true }).click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(files.getByRole('navigation').locator('[aria-current]')).toHaveText(
    'conversation-fixtures',
  );
  await expect(files.getByRole('button', { name: '.settings', exact: true })).toHaveCount(0);
  await expect(preview).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: 'Remove conversation-fixtures/.settings/.options',
      exact: true,
    }),
  ).toBeVisible();

  await page.getByLabel('Message Codex').fill('Inspect the selected fixture');
  const sent = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/send'),
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  expect((await sent).postDataJSON().attachments).toEqual([
    expect.objectContaining({ path: 'conversation-fixtures/.settings/.options', showHidden: true }),
  ]);
  await expect(page.locator('.turn-status')).toContainText('Completed');
});

test('folder navigation clears stale rows and previews, and failed directory reads can be retried', async ({
  page,
}) => {
  const folder = 'conversation-fixtures';
  let releaseFile!: () => void;
  let releaseDirectory!: () => void;
  const fileGate = new Promise<void>((resolve) => {
    releaseFile = resolve;
  });
  const directoryGate = new Promise<void>((resolve) => {
    releaseDirectory = resolve;
  });
  let directoryReads = 0;
  await page.route('**/api/projects/*/file?path=example.ts', async (route) => {
    await fileGate;
    await route.fulfill({ json: { path: 'example.ts', text: 'Late file', sha: 'old', lines: 1 } });
  });
  await page.route('**/api/projects/*/files?*', async (route) => {
    const path = new URL(route.request().url()).searchParams.get('path');
    if (path !== folder) return route.continue();
    if (++directoryReads === 1) {
      await directoryGate;
      return route.fulfill({
        status: 404,
        json: { error: { code: 'FILE_NOT_FOUND', message: 'The directory could not be read.' } },
      });
    }
    return route.fulfill({ json: [{ directory: true, name: 'nested', path: `${folder}/nested` }] });
  });
  await openFiles(page);
  const files = page.getByRole('region', { name: 'Project files', exact: true });
  const original = files.getByRole('button', { name: 'example.ts', exact: true });
  const started = page.waitForRequest('**/api/projects/*/file?path=example.ts');
  await original.click();
  await started;
  try {
    await files.getByRole('button', { name: folder, exact: true }).click();
    await expect(files.getByText('Loading files…', { exact: true })).toBeVisible();
    await expect(original).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'File preview' })).toHaveCount(0);
  } finally {
    releaseFile();
    releaseDirectory();
  }
  const error = files.getByRole('alert');
  await expect(error).toContainText('The directory could not be read.');
  await error.getByRole('button', { name: 'Retry' }).click();
  await page.route('**/api/projects/*/files?path=*nested', (route) => route.fulfill({ json: [] }));
  await files.getByRole('button', { name: 'nested', exact: true }).click();
  await expect(files.getByText('No visible files.', { exact: true })).toBeVisible();
  const breadcrumbs = files.getByRole('navigation', { name: 'File location' });
  await expect(breadcrumbs.locator('[aria-current]')).toHaveText('nested');
  await breadcrumbs.getByRole('button', { name: folder, exact: true }).click();
  await expect(breadcrumbs.locator('[aria-current]')).toHaveText(folder);
  await expect(files.getByRole('button', { name: 'nested', exact: true })).toBeVisible();
  await expect(page.getByText('Late file', { exact: true })).toHaveCount(0);
});

test('long source lines wrap inside Files at desktop and phone widths', async ({ page }) => {
  const attribute = `    <meta name="viewport" content="width=device-width, initial-scale=1" data-fixture="${'token_'.repeat(85)}" />`;
  await page.route('**/api/projects/*/file?path=example.ts', (route) =>
    route.fulfill({
      json: { path: 'example.ts', text: `first\n${attribute}\nlast`, sha: 'fixture', lines: 3 },
    }),
  );
  await openFiles(page);
  await page.getByRole('button', { name: 'example.ts', exact: true }).click();
  const lines = page.getByRole('group', { name: 'File lines' });
  const wrappedLine = lines.getByRole('button').nth(1);
  await expect(wrappedLine).toBeVisible();
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const shape = await wrappedLine.locator('code').evaluate((element) => {
      const scroller = element.closest('.file-preview-scroll')!;
      const range = document.createRange();
      range.selectNodeContents(element);
      const boxes = [...range.getClientRects()];
      return {
        wrappedRows: new Set(boxes.map((box) => box.top)).size,
        overflow: scroller.scrollWidth - scroller.clientWidth,
        text: element.textContent,
      };
    });
    expect(shape.wrappedRows).toBeGreaterThan(1);
    expect(shape.overflow).toBe(0);
    expect(shape.text).toBe(attribute);
    await expect(lines.getByRole('button')).toHaveCount(3);
  }
  await wrappedLine.click();
  await expect(page.getByText('Lines 2–2', { exact: true })).toBeVisible();
});

test('long source files render one page of selectable lines at a time', async ({ page }) => {
  const lines = Array.from({ length: 411 }, (_, index) => `Example line ${index + 1}`);
  let first = true;
  await page.route('**/api/projects/*/file?path=example.ts', (route) => {
    if (first) {
      first = false;
      return route.fulfill({
        status: 404,
        json: { error: { code: 'FILE_NOT_FOUND', message: 'The file could not be read.' } },
      });
    }
    return route.fulfill({
      json: { path: 'example.ts', text: lines.join('\n'), sha: 'fixture', lines: lines.length },
    });
  });
  await openFiles(page);
  await page.getByRole('button', { name: 'example.ts', exact: true }).click();
  const preview = page.getByRole('region', { name: 'File preview' });
  const error = preview.getByRole('alert');
  await expect(error).toContainText('The file could not be read.');
  await error.getByRole('button', { name: 'Retry' }).click();
  const code = preview.getByRole('group', { name: 'File lines' });
  await expect(code.getByRole('button')).toHaveCount(200);
  await code.getByRole('button', { name: '199 Example line 199', exact: true }).click();
  await preview.getByRole('button', { name: 'Next lines' }).click();
  await expect(preview.getByRole('status')).toHaveText('201–400 of 411');
  await expect(code.getByRole('button')).toHaveCount(200);
  await code
    .getByRole('button', { name: '202 Example line 202', exact: true })
    .click({ modifiers: ['Shift'] });
  await expect(preview.getByText('Lines 199–202', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Next lines' }).click();
  await expect(code.getByRole('button')).toHaveCount(11);
  await expect(preview.getByRole('button', { name: 'Next lines' })).toBeDisabled();
  await preview.getByRole('button', { name: 'Attach lines' }).click();
  await expect(page.getByRole('button', { name: 'Remove example.ts', exact: true })).toBeVisible();
});
