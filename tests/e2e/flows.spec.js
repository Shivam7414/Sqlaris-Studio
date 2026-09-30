// The flows a person cannot do without: sign in, open a table, change a value,
// delete a row. Changes are checked after a reload, so what the page shows
// came back from the database and not from the page's own memory.
const { test, expect } = require('@playwright/test');

const DB = 'e2e/sqlaris_e2e';

// Any error in the browser console fails the test that caused it.
let errors = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
});

test.afterEach(async () => {
  expect(errors, 'errors in the browser console').toEqual([]);
});

async function signIn(page, password = 'e2e-password') {
  await page.goto('/');
  await page.locator('input[name="username"]').fill('tester');
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function openPeople(page) {
  await page.goto(`/#db=${encodeURIComponent(DB)}`);
  await page.locator('a.table-item', { hasText: 'people' }).click();
  await expect(page.locator('table.grid tbody tr')).not.toHaveCount(0);
}

const cell = (page, text) => page.locator('table.grid tbody td', { hasText: new RegExp(`^${text}$`) });

test('a wrong password does not sign in, and the right one does', async ({ page }) => {
  await signIn(page, 'wrong');
  await expect(page.getByText('do not match')).toBeVisible();

  await signIn(page);
  await expect(page.locator('input[name="password"]')).toHaveCount(0);
});

test('opening a table shows its rows', async ({ page }) => {
  await signIn(page);

  await openPeople(page);

  await expect(cell(page, 'Ada Lovelace')).toBeVisible();
  await expect(cell(page, 'Alan Turing')).toBeVisible();
});

test('a value changed in the grid is still there after a reload', async ({ page }) => {
  await signIn(page);
  await openPeople(page);

  await cell(page, 'Ada Lovelace').dblclick();
  const editor = page.locator('.cell-editor input');
  await editor.fill('Ada King');
  await editor.press('Enter');
  await expect(cell(page, 'Ada King')).toBeVisible();

  await page.reload();
  await expect(cell(page, 'Ada King')).toBeVisible();
  await expect(cell(page, 'Ada Lovelace')).toHaveCount(0);
});

test('a deleted row is gone after a reload, and the others stay', async ({ page }) => {
  await signIn(page);
  await openPeople(page);

  await page.locator('table.grid tbody tr', { hasText: 'Grace Hopper' }).locator('td.pick input').check();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete row' }).click();
  await expect(cell(page, 'Grace Hopper')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('table.grid tbody tr')).not.toHaveCount(0);
  await expect(cell(page, 'Grace Hopper')).toHaveCount(0);
  await expect(cell(page, 'Alan Turing')).toBeVisible();
});
