import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 320, height: 640 },
  { width: 390, height: 480 },
]) {
  test(`composer edits native configuration with the original controls at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page
      .getByLabel('Workspace access token')
      .fill('test-only-browser-token-not-a-real-secret');
    await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    const input = page.getByLabel('Message Codex');
    await expect(input).toBeVisible();
    await input.fill('Keep my unsent draft');
    const project = await page.evaluate(() => localStorage.getItem('codes.project'));
    const path = '/api/projects/' + project + '/codex-configuration';
    const before = await (await page.request.get(path)).json();
    const dispatches: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/(send|steer|queue|review)$/.test(request.url()))
        dispatches.push(request.url());
    });
    try {
      const toggle = page.getByRole('button', { name: 'Model and reasoning', exact: true });
      await toggle.click();
      const popup = page.getByRole('dialog', { name: 'Model and reasoning', exact: true });
      await expect(popup).toContainText('Codex user configuration');
      const select = popup.getByRole('combobox', { name: 'Model', exact: true });
      await expect(select).toBeEnabled();
      await select.selectOption('simulated-model');
      await expect(select).toBeEnabled();
      await expect(select).toHaveValue('simulated-model');
      await popup
        .getByRole('combobox', { name: 'Reasoning effort', exact: true })
        .selectOption('high');
      await expect(toggle).toContainText('high');
      const speed = popup.getByRole('switch', { name: 'Fast mode', exact: true });
      await expect(speed).toBeEnabled();
      await speed.setChecked(true);
      await expect(speed).toBeChecked();
      await expect(speed).toBeEnabled();
      const after = await (await page.request.get(path)).json();
      expect(after).toMatchObject({ model: 'simulated-model', effort: 'high', fast: true });
      await popup.getByRole('combobox', { name: 'Task mode', exact: true }).selectOption('plan');
      await popup
        .getByRole('combobox', { name: 'Reasoning effort', exact: true })
        .selectOption('low');
      await expect(toggle).toContainText('low');
      expect(await (await page.request.get(path)).json()).toMatchObject({
        effort: 'high',
        planEffort: 'low',
      });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(
          (value) => document.documentElement.setAttribute('data-theme', value),
          theme,
        );
        for (const control of [
          select,
          popup.getByRole('combobox', { name: 'Reasoning effort', exact: true }),
          speed,
        ]) {
          await expect(control).toBeInViewport();
          expect(
            await control.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              const hit = document.elementFromPoint(
                bounds.x + bounds.width / 2,
                bounds.y + bounds.height / 2,
              );
              return hit === element || element.contains(hit);
            }),
          ).toBe(true);
        }
        await page.screenshot({
          path: `test-results/native-controls-${viewport.width}-${theme}.png`,
        });
      }
      await page.keyboard.press('Escape');
      const permissions = page.getByRole('button', { name: 'Codex permissions', exact: true });
      for (const [label, sandbox, reviewer, policy] of [
        ['Read only', 'read-only', 'user', 'on-request'],
        ['Ask for approval', 'workspace-write', 'user', 'on-request'],
        ['Approve for me', 'workspace-write', 'auto_review', 'on-request'],
        ['Full access', 'danger-full-access', 'user', 'never'],
      ] as const) {
        await permissions.click();
        const menu = page.getByRole('dialog', { name: 'Codex permissions', exact: true });
        const choice = menu.getByRole('button', { name: label, exact: true });
        await expect(choice).toBeEnabled();
        await expect(choice).toBeInViewport();
        await choice.click();
        await expect(permissions).toContainText(label);
        expect(await (await page.request.get(path)).json()).toMatchObject({
          sandbox,
          approvalsReviewer: reviewer,
          approvalPolicy: policy,
        });
      }
      await expect(input).toHaveValue('Keep my unsent draft');
      await expect(page.getByTestId('message-user')).toHaveCount(0);
      expect(dispatches).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      const current = await (await page.request.get(path)).json();
      const changes = {
        model: before.model ?? null,
        model_reasoning_effort: before.effort ?? null,
        plan_mode_reasoning_effort: before.planEffort ?? null,
        service_tier: before.serviceTier ?? null,
        default_permissions: before.permissionProfile ?? null,
        sandbox_mode: before.sandbox ?? null,
        approval_policy: before.approvalPolicy ?? null,
        approvals_reviewer: before.approvalsReviewer ?? null,
      };
      expect(
        (
          await page.request.put(path, {
            data: { version: current.userVersion, changes },
            headers: { Origin: 'http://127.0.0.1:19140' },
          })
        ).ok(),
      ).toBe(true);
    }
  });
}

test('composer reports a stale write and keeps project overrides after saving', async ({
  page,
}) => {
  const snapshot = {
    model: 'project-owned-model',
    effort: 'high',
    fast: false,
    fastAvailable: true,
    writable: true,
    userVersion: 'initial-version',
    sources: { model: 'project' },
  };
  let conflict = true;
  const writes: unknown[] = [];
  await page.route('**/api/projects/*/codex-configuration', async (route) => {
    if (route.request().method() === 'PUT') {
      writes.push(route.request().postDataJSON());
      if (conflict)
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'SETTINGS_CONFLICT',
              message: 'Codex configuration changed. Reload before saving.',
              uncertain: false,
            },
          },
        });
      snapshot.userVersion = 'saved-version';
    }
    return route.fulfill({ json: snapshot });
  });
  await page.goto('/');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Model and reasoning', exact: true });
  await expect(trigger).toContainText('project-owned-model');
  await trigger.click();
  const popup = page.getByRole('dialog', { name: 'Model and reasoning', exact: true });
  const model = popup.getByRole('combobox', { name: 'Model', exact: true });
  await expect(model).toBeEnabled();
  await model.selectOption('simulated-model');
  await expect(page.getByRole('alert')).toContainText('Codex configuration changed');
  await expect(model).toHaveValue('project-owned-model');
  await expect(model).toBeEnabled();
  conflict = false;
  await model.selectOption('simulated-model');
  await expect.poll(() => writes.length).toBe(2);
  await expect(model).toBeEnabled();
  await expect(model).toHaveValue('project-owned-model');
  await expect(popup).toContainText('project');
  expect(writes).toEqual([
    { version: 'initial-version', changes: { model: 'simulated-model' } },
    { version: 'initial-version', changes: { model: 'simulated-model' } },
  ]);
  await expect(page.getByTestId('message-user')).toHaveCount(0);
});
