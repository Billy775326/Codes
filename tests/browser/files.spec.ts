import { openContextTab } from './sidebar-helpers';
import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { sampleDocx, samplePdf } from '../fixtures/document';

async function openFiles(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await openContextTab(page, 'Files');
}

test('reopening a small preview shows cached text while fresh file access is checked', async ({
  page,
}) => {
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/projects/*/file?path=example.ts', async (route) => {
    const read = ++reads;
    if (read > 1) await gate;
    await route.fulfill({
      json: {
        path: 'example.ts',
        text: read === 1 ? 'Cached preview version' : 'Fresh preview version',
        sha: String(read),
        lines: 1,
      },
    });
  });
  await openFiles(page);
  const entry = page.locator('.file-list').getByRole('button', { name: 'example.ts', exact: true });
  const preview = page.getByRole('region', { name: 'File preview' });
  try {
    await entry.click();
    await expect(preview).toContainText('Cached preview version');
    await preview.getByRole('button', { name: 'Close file preview' }).click();
    await entry.click();
    await expect.poll(() => reads).toBe(2);
    await expect(preview).toContainText('Cached preview version');
    await expect(preview.getByRole('button', { name: 'Attach file', exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(preview).toContainText('Fresh preview version');
  await expect(preview.getByRole('button', { name: 'Attach file', exact: true })).toBeEnabled();
});

for (const { width, narrow, resize } of [
  { width: 1440, narrow: false, resize: false },
  { width: 1440, narrow: true, resize: true },
  { width: 320, narrow: true, resize: false },
]) {
  test(`Files gives the list and preview usable space at ${width}px${resize ? ' with a narrow panel' : ''}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: narrow ? 570 : 850 });
    await page.emulateMedia({ colorScheme: narrow ? 'light' : 'dark' });
    const extraFiles = Array.from({ length: 40 }, (_, index) => {
      const name = `fixture-${index}.txt`;
      return { name, path: name, directory: false };
    });
    await page.route('**/api/projects/*/file-management?*', async (route) => {
      const response = await route.fetch();
      const directory = await response.json();
      await route.fulfill({
        json: { ...directory, entries: [...directory.entries, ...extraFiles] },
      });
    });
    await openFiles(page);
    if (resize) await page.getByRole('separator', { name: 'Resize project panel' }).press('Home');
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
      await expect(close).toHaveText('Back to files');
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
  await page.route('**/api/projects/*/file-management?*', async (route) => {
    const path = new URL(route.request().url()).searchParams.get('path');
    if (path !== folder) return route.continue();
    if (++directoryReads === 1) {
      await directoryGate;
      return route.fulfill({
        status: 404,
        json: { error: { code: 'FILE_NOT_FOUND', message: 'The directory could not be read.' } },
      });
    }
    return route.fulfill({
      json: { entries: [{ directory: true, name: 'nested', path: `${folder}/nested` }] },
    });
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
  await page.route('**/api/projects/*/file-management?path=*nested', (route) =>
    route.fulfill({ json: { entries: [] } }),
  );
  await files.getByRole('button', { name: 'nested', exact: true }).click();
  await expect(files.getByText('No visible files.', { exact: true })).toBeVisible();
  const breadcrumbs = files.getByRole('navigation', { name: 'File location' });
  await expect(breadcrumbs.locator('[aria-current]')).toHaveText('nested');
  await breadcrumbs.getByRole('button', { name: folder, exact: true }).click();
  await expect(breadcrumbs.locator('[aria-current]')).toHaveText(folder);
  await expect(files.getByRole('button', { name: 'nested', exact: true })).toBeVisible();
  await expect(page.getByText('Late file', { exact: true })).toHaveCount(0);
});

test('manages a project folder and references a file larger than the preview limit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFiles(page);
  const panel = page.locator('.context-panel');
  const add = panel.getByRole('button', { name: 'Upload or create' });
  await add.click();
  await panel.getByRole('button', { name: 'New folder', exact: true }).click();
  await panel.getByLabel('Folder name').fill('reports');
  await panel.getByRole('button', { name: 'Create folder', exact: true }).click();
  await panel.getByRole('button', { name: 'reports', exact: true }).click();
  const content = Buffer.alloc(280 * 1024, 'a');
  const pick = async () => {
    await add.click();
    const chooser = page.waitForEvent('filechooser');
    const upload = panel.getByRole('button', { name: 'Upload to this folder', exact: true });
    await expect(upload).toHaveText('Upload to this folder');
    await upload.click();
    await (
      await chooser
    ).setFiles({ name: 'summary.log', mimeType: 'text/plain', buffer: content });
    await panel.getByRole('button', { name: 'Start upload', exact: true }).click();
  };
  await pick();
  await expect(panel.getByRole('button', { name: 'summary.log', exact: true })).toBeVisible();
  await pick();
  await expect(panel.getByRole('alert')).toContainText('That name is already in use.');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await panel.getByRole('button', { name: 'Actions for summary.log', exact: true }).click();
  const download = page.waitForEvent('download');
  await panel.getByRole('link', { name: 'Download', exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('summary.log');
  expect(await readFile((await saved.path())!)).toEqual(content);
  await panel.getByRole('button', { name: 'Reference in conversation', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove reports/summary.log', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('previews Word text and PDF pages from the Files sidebar', async ({ page }) => {
  await openFiles(page);
  const response = await page.request.get('/api/projects');
  const projects = (await response.json()) as { path: string }[];
  const project = projects.find(({ path }) => path.endsWith('/sample-project'));
  expect(project).toBeDefined();
  const docx = join(project!.path, 'layout-preview.docx');
  const pdf = join(project!.path, 'layout-preview.pdf');
  try {
    await writeFile(docx, sampleDocx);
    await writeFile(pdf, samplePdf());
    await page.getByRole('button', { name: 'Refresh file list' }).click();
    await page.getByRole('button', { name: 'layout-preview.docx', exact: true }).click();
    const preview = page.getByRole('region', { name: 'File preview', exact: true });
    await expect(preview.getByRole('article', { name: 'Word document preview' })).toContainText(
      'Quarterly plan preview',
    );
    await expect(preview.getByRole('button', { name: 'Attach file', exact: true })).toHaveCount(0);
    const loaded = page.waitForResponse((result) => {
      const url = new URL(result.url());
      return url.pathname === '/api/file-browser' && url.searchParams.get('kind') === 'pdf';
    });
    await page.getByRole('button', { name: 'layout-preview.pdf', exact: true }).click();
    expect((await loaded).headers()['content-type']).toBe('application/pdf');
    await expect(preview.locator('iframe[title="PDF preview"]')).toBeVisible();
    await expect(preview.getByRole('link', { name: 'Open PDF' })).toHaveAttribute(
      'target',
      '_blank',
    );
  } finally {
    await rm(docx, { force: true });
    await rm(pdf, { force: true });
  }
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
  await expect(page.getByRole('button', { name: 'Attach lines 2–2', exact: true })).toBeEnabled();
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
  await expect(
    preview.getByRole('button', { name: 'Attach lines 199–202', exact: true }),
  ).toBeVisible();
  await preview.getByRole('button', { name: 'Next lines' }).click();
  await expect(code.getByRole('button')).toHaveCount(11);
  await expect(preview.getByRole('button', { name: 'Next lines' })).toBeDisabled();
  await preview.getByRole('button', { name: 'Attach lines 199–202', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove example.ts', exact: true })).toBeVisible();
});

test.describe('touch range selection', () => {
  test.use({ viewport: { width: 320, height: 690 }, hasTouch: true, isMobile: true });
  test('nothing is selected before the user chooses a file range', async ({ page }) => {
    await openFiles(page);
    await page.getByRole('button', { name: 'example.ts', exact: true }).tap();
    const preview = page.getByRole('region', { name: 'File preview', exact: true });
    const attach = preview.getByRole('button', { name: /^Attach lines/ });
    await expect(attach).toBeDisabled();
    await expect(preview.locator('.file-lines [aria-pressed="true"]')).toHaveCount(0);
    await preview.getByRole('button', { name: 'Select range' }).tap();
    await preview.getByLabel('Start line').fill('2');
    await preview.getByLabel('End line').fill('1');
    await expect(attach).toBeDisabled();
    await preview.getByLabel('End line').fill('3');
    await expect(attach).toHaveText('Attach lines 2–3');
    await attach.tap();
    await expect(
      page.getByRole('button', { name: 'Remove example.ts', exact: true }),
    ).toBeVisible();
  });
});

test('opens a server path with a scope toast and keeps the file read-only', async ({ page }) => {
  await openFiles(page);
  const projects = await (await page.request.get('/api/projects')).json();
  const project = projects.find((entry: { name: string }) => entry.name === 'sample-project');
  const path = join(project.path, '..', 'codex-home', 'scope-preview.txt');
  await writeFile(path, 'External file fixture');
  try {
    await page.getByRole('button', { name: 'Open server path', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Server file or directory path', exact: true });
    await input.fill(path);
    await input.press('Enter');
    const toast = page
      .getByRole('status')
      .filter({ hasText: 'Viewing a path outside the usual file scope.' });
    await expect(toast).toHaveCount(1);
    const preview = page.getByRole('region', { name: 'File preview', exact: true });
    await expect(preview).toContainText('External file fixture');
    await expect(preview.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    await expect(preview.getByRole('button', { name: 'Attach file', exact: true })).toHaveCount(0);
    await expect(toast).toHaveCount(0, { timeout: 6500 });
  } finally {
    await rm(path);
  }
});
