import { test, expect, type Page } from '@playwright/test';
import { imagePng } from '../fixtures/image';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('.connection')).toHaveText('Connected');
}
async function choose(page: Page, name = 'synthetic.png') {
  await page.getByLabel('Choose local files', { exact: true }).setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: imagePng,
  });
}
async function loadedImages(page: Page, selector: string, count: number) {
  await expect(page.locator(selector)).toHaveCount(count);
  await expect
    .poll(() =>
      page
        .locator(selector)
        .evaluateAll((nodes) =>
          nodes.every(
            (node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
}

test('the plus menu attaches text, local documents, and a file from the project', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const trigger = page.getByRole('button', { name: 'Attach files', exact: true });
  await expect(page.getByRole('button', { name: 'Attach image', exact: true })).toHaveCount(0);
  await trigger.click();
  const upload = page.getByRole('button', { name: 'Upload from device', exact: true });
  const browse = page.getByRole('button', { name: 'Browse project files', exact: true });
  await expect(upload).toHaveText('Upload from device');
  const chooser = page.waitForEvent('filechooser');
  await upload.click();
  await (
    await chooser
  ).setFiles({
    name: 'device-notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('Local attachment test content'),
  });
  await expect(
    page.getByRole('button', { name: 'Remove device-notes.md', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Choose local files', { exact: true }).setInputFiles([
    {
      name: 'report.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nDocument bytes stay on disk'),
    },
    {
      name: 'notes.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    },
    {
      name: 'unknown.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([0xff, 0x00]),
    },
  ]);
  const removeUnknown = page.getByRole('button', {
    name: 'Remove codes-attachments/unknown.bin',
    exact: true,
  });
  await expect(removeUnknown).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Remove codes-attachments/report.pdf' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove codes-attachments/notes.docx' }),
  ).toBeVisible();
  await removeUnknown.click();
  await trigger.click();
  await browse.click();
  await page.getByRole('button', { name: 'example.ts', exact: true }).click();
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove example.ts', exact: true })).toBeVisible();
  const sending = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/send'),
  );
  await page.getByLabel('Message Codex').fill('Read these attachments');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const body = (await sending).postDataJSON();
  expect(body.attachments).toEqual([
    {
      kind: 'uploaded-file',
      id: expect.stringMatching(/^[a-f0-9]{64}$/),
      name: 'device-notes.md',
    },
    {
      kind: 'file-reference',
      path: 'codes-attachments/report.pdf',
      version: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
    {
      kind: 'file-reference',
      path: 'codes-attachments/notes.docx',
      version: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
    { path: 'example.ts', fromLine: 1, toLine: expect.any(Number), sha: expect.any(String) },
  ]);
  expect(JSON.stringify(body)).not.toContain('Local attachment test content');
  await expect(page.getByTestId('message-user')).toContainText('Local attachment test content');
  await expect(page.getByTestId('message-user')).toContainText('export function hello');
  await expect(page.getByTestId('message-user')).toContainText('codes-attachments/report.pdf');
  await expect(page.getByTestId('message-user')).not.toContainText('Document bytes stay on disk');
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
});

test('real clipboard image paste and ordinary text paste preserve the draft without sending', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  let sends = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/(send|queue|steer)$/.test(new URL(request.url()).pathname)
    )
      sends++;
  });
  const input = page.getByLabel('Message Codex');
  await input.fill('Describe this screenshot');
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    canvas.getContext('2d')!.fillRect(0, 0, 4, 3);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), 'image/png'),
    );
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await input.focus();
  await page.keyboard.press('Control+V');
  await loadedImages(page, '.attachments img', 1);
  await expect(input).toHaveValue('Describe this screenshot');
  await page.evaluate(() => navigator.clipboard.writeText(' + normal paste'));
  await input.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+V');
  await expect(input).toHaveValue('Describe this screenshot + normal paste');
  await page.getByRole('button', { name: /^Remove image:/ }).click();
  await expect(page.locator('.attachments img')).toHaveCount(0);
  expect(sends).toBe(0);
});

test('image-only sends use small references and retain authenticated previews after reload', async ({
  page,
}) => {
  await login(page);
  await choose(page);
  await loadedImages(page, '.attachments img', 1);
  const sending = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/send'),
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const body = (await sending).postDataJSON();
  expect(body.text).toBe('');
  expect(body.attachments).toEqual([
    { kind: 'image', id: expect.stringMatching(/^[a-f0-9]{64}\.png$/), name: 'synthetic.png' },
  ]);
  expect(JSON.stringify(body).length).toBeLessThan(1000);
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  await loadedImages(page, '[data-testid="message-user"] img', 1);
  await expect(page.locator('.attachments img')).toHaveCount(0);
  await page.reload();
  await loadedImages(page, '[data-testid="message-user"] img', 1);
});

test('uploads block dispatch and switching conversations discards late upload results', async ({
  page,
}) => {
  await login(page);
  await page.getByLabel('Message Codex').fill('Image upload scope fixture ' + Date.now());
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Completed', { exact: true })).toBeVisible();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/api/projects/*/images',
    async (route) => {
      await hold;
      await route.continue().catch(() => undefined); // The client deliberately aborts on a scope change.
    },
    { times: 1 },
  );
  await page.getByLabel('Message Codex').fill('Keep this draft local');
  await choose(page, 'late.png');
  await expect(page.getByRole('status').filter({ hasText: 'Uploading' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  release();
  await expect(page.getByRole('status').filter({ hasText: 'Uploading' })).toHaveCount(0);
  await expect(page.locator('.attachments img')).toHaveCount(0);
  await page.getByLabel('Message Codex').fill('Unrelated new draft');
  await expect(page.getByLabel('Message Codex')).toHaveValue('Unrelated new draft');
});

test('queued images keep their preview and can be steered without placeholder text', async ({
  page,
}) => {
  await login(page);
  await page.getByLabel('Message Codex').fill('[hold] Image queue fixture ' + Date.now());
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop task', exact: true })).toBeEnabled();
  await choose(page);
  await loadedImages(page, '.attachments img', 1);
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Queued messages' });
  await loadedImages(page, '.queued-images img', 1);
  await queue.getByRole('button', { name: 'Pause queue', exact: true }).click();
  await queue.getByRole('button', { name: 'Edit message', exact: true }).click();
  await expect(queue.getByLabel('Edit queued message')).toHaveValue('');
  await queue.getByLabel('Edit queued message').fill('Temporary caption');
  await queue.getByLabel('Edit queued message').fill('');
  await queue.getByRole('button', { name: 'Save queued message', exact: true }).click();
  await expect(queue.getByLabel('Edit queued message')).toHaveCount(0);
  await loadedImages(page, '.queued-images img', 1);
  await choose(page, 'steer.png');
  await loadedImages(page, '.attachments img', 1);
  await page.getByRole('button', { name: 'Add to current task', exact: true }).click();
  await loadedImages(page, '[data-testid="message-user"] img', 1);
  await expect(page.locator('.attachments img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
  await expect(page.locator('.turn-status').getByText('Stopped', { exact: true })).toBeVisible();
  await queue.getByRole('button', { name: 'Remove queued message', exact: true }).click();
});

test('image validation and the four-attachment limit leave the existing draft usable', async ({
  page,
}) => {
  await login(page);
  await page.getByLabel('Message Codex').fill('Retain this text');
  await page.getByLabel('Choose local files', { exact: true }).setInputFiles({
    name: 'invalid.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(
    page.getByText('Choose a valid PNG, JPEG, or WebP image.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.attachments img')).toHaveCount(0);
  await page.getByLabel('Choose local files', { exact: true }).setInputFiles(
    Array.from({ length: 4 }, (_, index) => ({
      name: `synthetic-${index}.png`,
      mimeType: 'image/png',
      buffer: Buffer.concat([imagePng, Buffer.from([index])]),
    })),
  );
  await loadedImages(page, '.attachments img', 4);
  await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove image: synthetic-0.png', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Retain this text');
});

for (const width of [1440, 320, 390])
  test(`image attachments and composer controls fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 480 : 800 });
    await login(page);
    await choose(page);
    await loadedImages(page, '.attachments img', 1);
    for (const theme of ['dark', 'light']) {
      await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
      await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
      await page.keyboard.press('Escape');
      await page
        .getByLabel('Message Codex')
        .fill(Array.from({ length: 24 }, () => 'Synthetic image context').join('\n'));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const name of ['Attach files', 'Send message', 'Model and reasoning']) {
        const button = page.getByRole('button', { name, exact: true });
        await button.scrollIntoViewIfNeeded();
        const bounds = await button.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(
          await button.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return hit === element || element.contains(hit);
          }),
        ).toBe(true);
      }
      await page.screenshot({ path: `test-results/images-${width}-${theme}.png`, fullPage: true });
    }
  });

test('a rejected send retains image context and text for correction', async ({ page }) => {
  await login(page);
  await choose(page);
  await loadedImages(page, '.attachments img', 1);
  await page.getByLabel('Message Codex').fill('Keep this image context');
  await page.route(
    '**/api/threads/*/send',
    (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'IMAGES_UNAVAILABLE', message: 'This model does not support images.' },
        }),
      }),
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(
    page.getByText('This model does not support images.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Message Codex')).toHaveValue('Keep this image context');
  await loadedImages(page, '.attachments img', 1);
  const dismiss = page.getByRole('button', { name: 'Dismiss error', exact: true });
  await dismiss.hover();
  await expect(page.locator('.control-tooltip')).toHaveText('Dismiss error');
  await dismiss.click();
  await expect(dismiss).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
});
