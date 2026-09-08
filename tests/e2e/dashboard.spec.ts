import { test, expect } from '@playwright/test';

test('route, inspect inventory, override, cancel, create, and reset', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('RNO recommended', { exact: true })).toBeVisible();
  if (info.project.name === 'desktop')
    await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true });
  await page.getByRole('button', { name: 'Route this order', exact: true }).click();
  await expect(page.getByText('RNO allocated', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stock, without the guesswork.' })).toBeVisible();
  await page.getByRole('button', { name: /Order routing/ }).click();
  await page.getByRole('button', { name: 'Manual override', exact: true }).click();
  await page.getByLabel('Warehouse', { exact: true }).selectOption('BUF');
  await page.getByLabel('Reason', { exact: true }).fill('Customer requested east coast shipment.');
  await page.getByRole('button', { name: 'Save override', exact: true }).click();
  await expect(page.getByText('BUF allocated', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await expect(page.getByText('Order cancelled. Reserved stock released.')).toBeVisible();
  await page.getByRole('button', { name: 'New order', exact: true }).click();
  await page.getByLabel('Customer name').fill('Browser test customer');
  await page.getByLabel('Destination', { exact: true }).selectOption('SFO');
  await page.getByLabel('Quantity', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Create order', exact: true }).click();
  await expect(page.getByText('Order created.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.getByRole('button', { name: 'Reset workspace', exact: true }).click();
  await expect(page.getByText('RNO recommended', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspect FR-1042', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('stock shortage, quote failure, audit trail and last-unit race', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('RNO recommended', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect FR-1043', exact: true }).click();
  await expect(page.getByText('BUF recommended', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect FR-1045', exact: true }).click();
  await expect(page.getByText('Manual review required', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Route this order', exact: true }).click();
  await expect(page.getByText('Routing decision saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Demo walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Run concurrency demo', exact: true }).click();
  await expect(
    page.getByText('1 allocated · 1 held for review · stock never below zero.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Activity log', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Decision trail' })).toBeVisible();
});
