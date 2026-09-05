import { test, expect } from '@playwright/test';

test('controls wait for bootstrap and authenticated connection', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let allowBootstrap;
  const gate = new Promise(resolve => { allowBootstrap = resolve; });
  await page.route('**/api/bootstrap', async route => { await gate; await route.continue(); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Turn on Interlude', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Try a demo', exact: true })).toBeDisabled();
  allowBootstrap();
  await expect(page.locator('#connection-dot')).toHaveClass('online');
  await expect(page.getByRole('button', { name: 'Try a demo', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('both modes, attention events, answer reveal, and diagnostics work in the rendered dashboard', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#connection-dot')).toHaveClass('online');
  await expect(page.getByRole('heading', { name: 'Make room for the wait.' })).toBeVisible();
  await page.getByRole('button', { name: 'Try a demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'This moment is yours.' })).toBeVisible();
  await page.getByRole('button', { name: 'Needs permission', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A decision is waiting.' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue working', exact: true }).click();
  await page.getByRole('button', { name: 'Asks a question', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Codex has a question.' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue working', exact: true }).click();
  await page.getByRole('button', { name: 'Locked-in mode', exact: true }).click();
  await page.getByRole('button', { name: 'Reveal answer', exact: true }).click();
  await expect(page.locator('#lesson-answer')).toBeVisible();
  await page.getByRole('button', { name: 'Finishes responding', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your response is ready.' })).toBeVisible();
  await page.getByRole('button', { name: 'Exit demo', exact: true }).click();
  await page.getByRole('button', { name: 'Fun mode', exact: true }).click();
  await page.getByText('Connection details', { exact: true }).click();
  await page.getByRole('button', { name: 'Check setup', exact: true }).click();
  await expect(page.locator('#diagnostic-status')).toContainText('Desktop helper fixture is ready.');
  expect(errors).toEqual([]);
});

test('setup remains usable on a narrow screen and pairing confirmation is inside the dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#connection-dot')).toHaveClass('online');
  await expect(page.getByRole('heading', { name: 'Make room for the wait.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: /Connect browser|Browser setup/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Copy connection code', exact: true }).click();
  await expect(page.locator('#copy-status')).toBeVisible();
  await expect(page.locator('#copy-status')).toHaveText(/Copied\.|Clipboard access was denied/);
  await page.getByRole('button', { name: 'Close setup', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
