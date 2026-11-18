import { test, expect, type Page } from '@playwright/test';
async function fixture(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  const title = await page.evaluate(async () => {
    const projects = await (await fetch('/api/projects')).json();
    const result = await fetch('/api/projects/' + projects[0].id + '/seed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const rows = await result.json();
    const row = rows.find((row: { title: string }) => row.title === 'Rendering reference');
    const title = 'Seamless fixture ' + crypto.randomUUID();
    const renamed = await fetch('/api/threads/' + row.id + '/rename', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: crypto.randomUUID(), name: title }),
    });
    if (!renamed.ok) throw new Error('Fixture rename failed');
    return title;
  });
  await page.reload();
  if ((page.viewportSize()?.width ?? 1440) <= 1099)
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.locator('.thread-link').filter({ hasText: title }).click();
  await expect(page.getByRole('heading', { name: 'Reference 99', exact: true })).toHaveCount(1);
}
async function edge(page: Page, direction: 'older' | 'newer') {
  const response = page.waitForResponse(
    (response) => response.url().includes('/history?cursor=') && response.status() === 200,
  );
  await page
    .getByRole('region', { name: 'Conversation timeline', exact: true })
    .evaluate((element, direction) => {
      element.scrollTop = direction === 'older' ? 0 : element.scrollHeight;
      if (innerWidth <= 390) {
        element.dispatchEvent(
          new TouchEvent('touchstart', {
            touches: [new Touch({ identifier: 1, target: element, clientX: 100, clientY: 100 })],
            bubbles: true,
          }),
        );
        element.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [
              new Touch({
                identifier: 1,
                target: element,
                clientX: 100,
                clientY: direction === 'older' ? 200 : 0,
              }),
            ],
            bubbles: true,
          }),
        );
      } else
        element.dispatchEvent(
          new WheelEvent('wheel', { deltaY: direction === 'older' ? -120 : 120, bubbles: true }),
        );
    }, direction);
  const value = await (await response).json();
  const item = direction === 'older' ? value.messages[0] : value.messages.at(-1);
  if (item) await expect(page.locator('[data-message-id="' + item.id + '"]')).toHaveCount(1);
  return value;
}
for (const width of [1440, 390])
  test(`scrolling alone crosses older and newer native page boundaries at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixture(page);
    await page.getByLabel('Message Codex').fill('Keep this draft during continuous reading');
    for (let i = 0; i < 5; i++) await edge(page, 'older');
    await expect(page.getByRole('heading', { name: 'Reference 99', exact: true })).toHaveCount(0);
    expect(await page.locator('[data-message-id]').count()).toBeLessThanOrEqual(72);
    // Pages evicted from the opposite edge remain reachable by scrolling down.
    for (let i = 0; i < 10; i++) {
      if (await page.getByRole('heading', { name: 'Reference 99', exact: true }).count()) break;
      await edge(page, 'newer');
    }
    await expect(page.getByRole('heading', { name: 'Reference 99', exact: true })).toHaveCount(1);
    await page
      .getByRole('region', { name: 'Conversation timeline', exact: true })
      .evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
      });
    await expect(page.getByRole('heading', { name: 'Reference 99', exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Conversation position' })).toHaveCount(0);
    await expect(page.getByLabel('Message Codex')).toHaveValue(
      'Keep this draft during continuous reading',
    );
    expect(
      await page
        .locator('[data-message-id]')
        .evaluateAll(
          (elements) =>
            new Set(elements.map((element) => element.getAttribute('data-message-id'))).size ===
            elements.length,
        ),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/seamless-history-${width}.png`, fullPage: true });
  });
test('prepending a native page keeps the visible turn anchored and a history failure waits for explicit retry', async ({
  page,
}) => {
  await fixture(page);
  let fail = true;
  let calls = 0;
  await page.route('**/api/threads/*/history?cursor=*', (route) => {
    calls++;
    return fail
      ? route.fulfill({
          status: 503,
          json: {
            error: { code: 'FIXTURE_UNAVAILABLE', message: 'Synthetic history unavailable.' },
          },
        })
      : route.continue();
  });
  const timeline = page.getByRole('region', { name: 'Conversation timeline', exact: true });
  await timeline.evaluate((element) => {
    element.scrollTop = 100;
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
  });
  await expect(
    page.getByRole('button', { name: 'Retry loading earlier messages', exact: true }),
  ).toBeVisible();
  const failedCalls = calls;
  await timeline.evaluate((element) =>
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true })),
  );
  expect(calls).toBe(failedCalls);
  await page
    .getByRole('button', { name: 'Retry loading earlier messages', exact: true })
    .scrollIntoViewIfNeeded();
  const anchor = await timeline.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const turn = [...element.querySelectorAll<HTMLElement>('.turn')].find(
      (turn) => turn.getBoundingClientRect().bottom > top,
    )!;
    return { id: turn.dataset.turnId!, offset: turn.getBoundingClientRect().top - top };
  });
  fail = false;
  await page.getByRole('button', { name: 'Retry loading earlier messages', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reference 87', exact: true })).toHaveCount(1);
  const after = await timeline.evaluate((element, id) => {
    const turn = [...element.querySelectorAll<HTMLElement>('.turn')].find(
      (turn) => turn.dataset.turnId === id,
    )!;
    return turn.getBoundingClientRect().top - element.getBoundingClientRect().top;
  }, anchor.id);
  expect(Math.abs(after - anchor.offset)).toBeLessThan(3);
});
