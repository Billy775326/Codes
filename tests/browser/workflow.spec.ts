import { test, expect, type Page } from '@playwright/test';
const token = 'test-only-browser-token-not-a-real-secret';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill(token);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) > 1099)
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
}
async function send(page: Page, text: string) {
  await page.getByLabel('Message Codex').fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}
test('structured questions preserve native options, free text, secret controls, and cross-client resolution', async ({
  browser,
}) => {
  const desktop = await browser.newContext(),
    phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
  try {
    const originator = await desktop.newPage(),
      observer = await phone.newPage();
    await login(originator);
    const prompt = '[question] [multiple] Workflow ' + Date.now();
    await send(originator, prompt);
    await expect(
      originator.getByRole('button', { name: 'Submit answer', exact: true }),
    ).toBeDisabled();
    await expect(
      originator.getByText('Continue with the proposed direction.', { exact: true }),
    ).toBeVisible();
    await expect(originator.getByLabel('Private fixture answer', { exact: true })).toHaveAttribute(
      'type',
      'password',
    );
    await login(observer);
    await observer.getByRole('button', { name: 'Open navigation' }).click();
    await observer.locator('.thread-link').filter({ hasText: prompt }).click();
    await observer
      .getByLabel('What should happen next?', { exact: true })
      .fill('Use a small verified change');
    await observer
      .getByLabel('Private fixture answer', { exact: true })
      .fill('synthetic-private-answer');
    expect(await observer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const name of ['Queue message', 'Stop task']) {
      const box = await observer.getByRole('button', { name, exact: true }).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
    await observer.screenshot({
      path: 'test-results/workflow-mobile-questions.png',
      fullPage: true,
    });
    await observer.getByRole('button', { name: 'Submit answer', exact: true }).click();
    await expect(originator.getByText('Completed', { exact: true })).toBeVisible();
    await expect(
      originator.getByRole('button', { name: 'Submit answer', exact: true }),
    ).toHaveCount(0);
    await expect(observer.getByTestId('message-user')).toHaveCount(1);
  } finally {
    await desktop.close();
    await phone.close();
  }
});
test('quoted replies remain ordinary editable drafts across conversation switching and reload', async ({
  page,
}) => {
  await login(page);
  const prompt = 'Quoted message fixture ' + Date.now();
  await send(page, prompt);
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await page
    .getByTestId('message-assistant')
    .last()
    .getByRole('button', { name: 'Reply', exact: true })
    .click();
  const quote = await page.getByLabel('Message Codex').inputValue();
  expect(quote).toContain('Regarding this Codex reply:');
  expect(quote).toContain('> ## A clear path forward');
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.locator('.thread-link').filter({ hasText: prompt }).click();
  await expect(page.getByLabel('Message Codex')).toHaveValue(quote);
  await page.reload();
  await expect(page.getByLabel('Message Codex')).toHaveValue(quote);
  await page.getByLabel('Message Codex').fill(quote + 'Explain the second step.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('message-user')).toHaveCount(2);
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await expect(page.getByTestId('message-user').last()).toContainText(
    'Regarding this Codex reply:',
  );
});
test('queue controls retain full long messages, recover lost receipts, and pause after task cancellation', async ({
  page,
}) => {
  await login(page);
  await send(page, '[approve] Queue workflow ' + Date.now());
  await expect(page.getByRole('button', { name: 'Approve once' })).toBeVisible();
  const long = 'Queued long fixture ' + 'x'.repeat(4500);
  await page.route(
    '**/api/threads/*/queue',
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fetch();
      await route.abort();
    },
    { times: 1 },
  );
  await page.getByLabel('Message Codex').fill(long);
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Check queue receipt', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Check queue receipt', exact: true }).click();
  await expect(page.getByLabel('Message Codex')).toHaveValue('');
  const queue = page.getByRole('region', { name: 'Queued messages' });
  await expect(queue.locator('li')).toHaveCount(1);
  await queue.getByRole('button', { name: 'Pause queue', exact: true }).click();
  await queue.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(queue.getByLabel('Edit queued message')).toHaveValue(long);
  await queue.getByLabel('Edit queued message').fill(long + ' edited');
  await queue.getByRole('button', { name: 'Save queued message', exact: true }).click();
  await page.getByLabel('Message Codex').fill('Remove this waiting message');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  await expect(queue.locator('li')).toHaveCount(2);
  await queue.locator('li').last().getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(queue.locator('li')).toHaveCount(1);
  await page.reload();
  await expect(queue.locator('li')).toHaveCount(1);
  await expect(queue.getByRole('button', { name: 'Resume queue', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/workflow-desktop-queue.png', fullPage: true });
  let release!: () => void;
  let delivered!: () => void;
  const pausedResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delivery = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route(
    '**/api/threads/*/queue/control',
    async (route) => {
      const response = await route.fetch();
      await pausedResponse;
      await route.fulfill({ response });
      delivered();
    },
    { times: 1 },
  );
  await queue.getByRole('button', { name: 'Resume queue', exact: true }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await expect(queue).toHaveCount(0);
  await expect(page.getByTestId('message-user')).toHaveCount(2);
  await expect(page.getByTestId('message-user').last()).toContainText(long + ' edited');
  release();
  await delivery;
  await expect(queue).toHaveCount(0);
});
test('branching from a completed turn copies only earlier context and preserves source files and later history', async ({
  page,
}) => {
  await login(page);
  await send(page, 'First fork fixture ' + Date.now());
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await send(page, 'Second fork fixture');
  await expect(page.getByTestId('message-assistant')).toHaveCount(2);
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  const source = await page.evaluate(() => localStorage.getItem('codes.thread'));
  await page
    .getByTestId('message-assistant')
    .first()
    .getByRole('button', { name: 'Branch from here', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('files are not copied or rolled back');
  await page.getByRole('button', { name: 'Create branch', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open source conversation', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.getByLabel('Permissions')).toHaveValue('read-only');
  expect(await page.evaluate(() => localStorage.getItem('codes.thread'))).not.toBe(source);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Open source conversation', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open source conversation', exact: true }).click();
  await expect(page.getByTestId('message-user')).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem('codes.thread'))).toBe(source);
});
