import { expect, test } from '@playwright/test';

test.use({ locale: 'zh-CN' });

test('English is the default and Simplified Chinese persists without changing drafts or replies', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Older preferences did not include a language.
    if (!localStorage.getItem('codes.preferences'))
      localStorage.setItem('codes.preferences', '{"theme":"light"}');
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByLabel('Workspace access token').fill('test-only-browser-token-not-a-real-secret');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  const draft = 'Draft in English stays intact';
  await page.getByLabel('Message Codex').fill(draft);
  await page.getByRole('button', { name: 'Interaction settings', exact: true }).click();
  const language = page.getByRole('combobox', { name: 'Language', exact: true });
  await expect(language).toHaveValue('en');
  await expect(language.locator('option')).toHaveText(['English', '简体中文']);
  await language.selectOption('zh-CN');
  const chineseLanguage = page.getByRole('combobox', { name: '语言', exact: true });
  await expect(chineseLanguage).toHaveValue('zh-CN');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('combobox', { name: '主题', exact: true })).toHaveValue('light');
  await page.getByRole('button', { name: '网络与访问', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '监听地址', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '运行环境', exact: true }).click();
  await expect(page.getByLabel('原生请求超时（毫秒）')).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(page.getByLabel('给 Codex 发送消息')).toHaveValue(draft);
  await expect(page.getByLabel('搜索项目和会话')).toBeVisible();
  await page.getByRole('button', { name: '浏览文件', exact: true }).click();
  await page.getByRole('button', { name: 'example.ts', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加选中行', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.getByLabel('给 Codex 发送消息').fill('[question] Original English prompt');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '提交答案', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '跳过问题', exact: true }).click();
  await expect(page.locator('.turn-status')).toContainText('已完成');
  await expect(page.getByTestId('message-user')).toContainText('Original English prompt');

  await page.setViewportSize({ width: 320, height: 745 });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByTestId('message-user')).toContainText('Original English prompt');
  await page.getByRole('button', { name: 'Codex 权限', exact: true }).click();
  const permissions = page.getByRole('dialog', { name: 'Codex 权限', exact: true });
  await expect(permissions.getByRole('button', { pressed: true })).toHaveAccessibleName('只读');
  await expect(permissions.getByText('服务器文件和网络不限，无需审批。')).toBeInViewport();
  await page.keyboard.press('Escape');
  const openNavigation = page.getByRole('button', { name: '打开侧栏', exact: true });
  await openNavigation.click();
  await page.getByRole('button', { name: '关闭侧栏', exact: true }).click();
  await expect(openNavigation).toBeFocused();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await chineseLanguage.selectOption('en');
  await expect(language).toHaveValue('en');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByLabel('Message Codex')).toBeVisible();
});
