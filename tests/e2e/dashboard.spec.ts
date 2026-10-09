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

test('HTTP origin checks allow each local host and reject mismatched origins', async ({
  request,
  baseURL,
}) => {
  const data = { query: '{ products { sku } }' };
  for (const hostname of ['localhost', '127.0.0.1']) {
    const url = new URL(baseURL!);
    url.hostname = hostname;
    const allowed = await request.post(`${url.origin}/api/graphql`, {
      headers: { origin: url.origin },
      data,
    });
    expect(allowed.status()).toBe(200);
    expect((await allowed.json()).data.products).toHaveLength(5);
  }
  const mismatchedPort = new URL(baseURL!);
  mismatchedPort.port = String(Number(mismatchedPort.port) + 1);
  for (const origin of [
    'https://unrelated.example',
    baseURL!.replace('127.0.0.1', 'localhost'),
    mismatchedPort.origin,
    baseURL!.replace('http:', 'https:'),
    'null',
    '',
  ]) {
    const rejected = await request.post('/api/graphql', {
      headers: { origin, 'x-forwarded-host': origin.replace(/^https?:\/\//, '') },
      data,
    });
    expect(rejected.status(), origin).toBe(403);
    expect(await rejected.json()).toEqual({ error: 'Cross-origin requests are not allowed.' });
    expect(rejected.headers()['set-cookie']).toBeUndefined();
  }
});

test('activity renders numeric event order after more than nine events', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('RNO recommended', { exact: true })).toBeVisible();
  const ids: string[] = [];
  for (let index = 0; index < 12; index++) {
    const response = await page.request.post('/api/graphql', {
      data: {
        query: `mutation { createOrder(input: { customer: "History fixture", destinationId: NYC,
          items: [{ sku: "PH-100", quantity: 1 }] }) { id } }`,
      },
    });
    const result = await response.json();
    expect(result.errors).toBeUndefined();
    ids.push(result.data.createOrder.id);
  }
  await page.getByRole('button', { name: 'Activity log', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  const articles = page.locator('.timeline article');
  await expect(articles).toHaveCount(13);
  await expect(articles.first().getByRole('button')).toHaveText(ids[11]);
  await expect(page.locator('.timeline article button')).toHaveText([...ids].reverse());
  await expect(articles.last()).toContainText('DEMO READY');
});
