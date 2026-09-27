import { allRows, insertDucks } from '../support/database';
import { expect, expectRows, fillDuckForm, holdRequests, MAX_INT, openInventory, recordApiRequests, test } from './fixtures';

const submit = (page: import('@playwright/test').Page) => page.getByRole('dialog').getByRole('button', { name: 'Add Duck' }).click();

test('adds a duck: the dialog closes, a notice appears, the table re-sorts, and focus returns to Add Duck', async ({ page }) => {
    await insertDucks([
        { color: 'Green', size: 'Large', price: '1.00', quantity: 10 },
        { color: 'Green', size: 'Small', price: '1.00', quantity: 1 },
    ]);
    await openInventory(page);
    await page.locator('#add-duck').click();
    const dialog = page.getByRole('dialog', { name: 'Add Duck' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Color')).toBeFocused();
    await expect(dialog.getByLabel('Color')).toHaveValue('Red');
    await expect(dialog.getByLabel('Size')).toHaveValue('Medium');
    await fillDuckForm(page, { color: 'Yellow', size: 'XSmall', price: '12.5', quantity: '5' });
    await submit(page);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Duck added to inventory.' })).toBeVisible();
    await expectRows(page, [
        ['1', 'Green', 'Large', '$1.00', '10'],
        ['3', 'Yellow', 'XSmall', '$12.50', '5'],
        ['2', 'Green', 'Small', '$1.00', '1'],
    ]);
    await expect(page.locator('#add-duck')).toBeFocused();
});

test('adding a matching duck merges it and reports the new quantity', async ({ page }) => {
    await insertDucks([{ color: 'Red', size: 'Medium', price: '10.00', quantity: 5 }]);
    await openInventory(page);
    await page.locator('#add-duck').click();
    await fillDuckForm(page, { price: '10', quantity: '1000' });
    await submit(page);
    await expect(
        page.getByRole('status').filter({ hasText: 'Duck #1 already existed, so its quantity was increased to 1,005.' })
    ).toBeVisible();
    await expectRows(page, [['1', 'Red', 'Medium', '$10.00', '1,005']]);
});

test('re-adding a deleted duck creates a new duck instead of restoring its old stock', async ({ page }) => {
    await insertDucks([{ color: 'Red', size: 'Medium', price: '10.00', quantity: 5000, deleted: true }]);
    await openInventory(page);
    await page.locator('#add-duck').click();
    await fillDuckForm(page, { price: '10.00', quantity: '1' });
    await submit(page);
    await expect(page.getByRole('status').filter({ hasText: 'Duck added to inventory.' })).toBeVisible();
    await expectRows(page, [['2', 'Red', 'Medium', '$10.00', '1']]);
});

test('accepts prices the browser allows, such as .5', async ({ page }) => {
    await openInventory(page);
    await page.locator('#add-duck').click();
    await fillDuckForm(page, { price: '.5', quantity: '1' });
    await submit(page);
    await expectRows(page, [['1', 'Red', 'Medium', '$0.50', '1']]);
});

test('browser validation blocks missing or out-of-range values without sending a request', async ({ page }) => {
    await openInventory(page);
    const requests = recordApiRequests(page);
    await page.locator('#add-duck').click();
    for (const fields of [
        { price: '', quantity: '1' },
        { price: '1', quantity: '' },
        { price: '0', quantity: '1' },
        { price: '1.005', quantity: '1' },
        { price: '100000000', quantity: '1' },
        { price: '1', quantity: '0' },
        { price: '1', quantity: '1.5' },
        { price: '1', quantity: String(MAX_INT + 1) },
    ]) {
        await fillDuckForm(page, fields);
        await submit(page);
        await expect(page.getByRole('dialog')).toBeVisible();
    }
    expect(requests.filter((request) => request.method === 'POST')).toEqual([]);
});

test('server validation errors appear beside the field, keep the input, and clear on a successful retry', async ({ page }) => {
    await openInventory(page);
    await page.locator('#add-duck').click();
    const dialog = page.getByRole('dialog');
    // "1e1" is a valid number to the browser, but the API accepts only plain decimals.
    await fillDuckForm(page, { price: '1e1', quantity: '2' });
    await submit(page);
    await expect(dialog.getByRole('alert')).toContainText('Check the supplied fields.');
    const price = dialog.getByLabel('Price (USD)');
    await expect(price).toHaveAttribute('aria-invalid', 'true');
    await expect(price).toHaveAccessibleDescription('Enter a price with at most two decimal places, up to 99,999,999.99.');
    await expect(price).toHaveValue('1e1');
    await expect(dialog.getByLabel('Quantity')).toHaveValue('2');
    await fillDuckForm(page, { price: '10' });
    await submit(page);
    await expect(dialog).toBeHidden();
    await expectRows(page, [['1', 'Red', 'Medium', '$10.00', '2']]);
});

test('a merge that would overflow shows the server message and saves nothing', async ({ page }) => {
    await insertDucks([{ color: 'Red', size: 'Medium', price: '10.00', quantity: MAX_INT }]);
    await openInventory(page);
    await page.locator('#add-duck').click();
    await fillDuckForm(page, { price: '10', quantity: '1' });
    await submit(page);
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('The combined quantity exceeds 2,147,483,647.');
    expect((await allRows())[0].quantity).toBe(MAX_INT);
});

test('double-clicking Add submits only once', async ({ page }) => {
    await openInventory(page);
    const requests = recordApiRequests(page);
    const { release } = await holdRequests(page, '**/api/ducks', 'POST');
    await page.locator('#add-duck').click();
    await fillDuckForm(page, { price: '1', quantity: '1' });
    await page.getByRole('dialog').getByRole('button', { name: 'Add Duck' }).dblclick();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Saving…' })).toBeDisabled();
    release();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
    expect((await allRows())[0].quantity).toBe(1);
});

test('a lost connection during Add keeps the form and its input, says the save is unconfirmed, and never resubmits', async ({ page }) => {
    await openInventory(page);
    const requests = recordApiRequests(page);
    // The server saves the duck, but the browser never sees the response.
    await page.route('**/api/ducks', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        await route.fetch();
        await route.abort('connectionreset');
    });
    await page.locator('#add-duck').click();
    await fillDuckForm(page, { price: '6', quantity: '3' });
    await submit(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('alert')).toHaveText(
        'We couldn’t confirm whether your change was saved. Refresh inventory before submitting again.'
    );
    await expect(dialog.getByLabel('Price (USD)')).toHaveValue('6');
    await expect(dialog.getByLabel('Quantity')).toHaveValue('3');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Refresh inventory' }).click();
    await expectRows(page, [['1', 'Red', 'Medium', '$6.00', '3']]);
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
});
