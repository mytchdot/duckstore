import { allRows, insertDucks } from '../support/database';
import { expect, expectRows, fillDuckForm, holdRequests, openInventory, recordApiRequests, test } from './fixtures';

const red = { color: 'Red', size: 'Medium', price: '10.00', quantity: 5 };

test.describe('Edit', () => {
    test('uses the same form, with color and size read-only and current values filled in', async ({ page }) => {
        await insertDucks([red]);
        await openInventory(page);
        await page.getByRole('button', { name: 'Edit duck 1' }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit Duck' });
        for (const [label, value] of [
            ['Color', 'Red'],
            ['Size', 'Medium'],
        ]) {
            await expect(dialog.getByLabel(label)).toHaveValue(value);
            await expect(dialog.getByLabel(label)).not.toBeEditable();
        }
        await expect(dialog.getByLabel('Price (USD)')).toHaveValue('10.00');
        await expect(dialog.getByLabel('Price (USD)')).toBeFocused();
        await expect(dialog.getByLabel('Quantity')).toHaveValue('5');
    });

    test('saves price and quantity, re-sorts, and returns focus to the Edit button', async ({ page }) => {
        await insertDucks([red, { ...red, color: 'Green', quantity: 50 }]);
        await openInventory(page);
        const requests = recordApiRequests(page);
        await page.getByRole('button', { name: 'Edit duck 1' }).click();
        await fillDuckForm(page, { price: '11.25', quantity: '100' });
        await page.getByRole('dialog').getByRole('button', { name: 'Save Changes' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Duck updated successfully.' })).toBeVisible();
        await expectRows(page, [
            ['1', 'Red', 'Medium', '$11.25', '100'],
            ['2', 'Green', 'Medium', '$10.00', '50'],
        ]);
        expect(requests.find((request) => request.method === 'PATCH')?.body).toEqual({ price: '11.25', quantity: 100 });
        await expect(page.getByRole('button', { name: 'Edit duck 1' })).toBeFocused();
    });

    test('sends only the changed field, so stock added meanwhile is not overwritten', async ({ page }) => {
        await insertDucks([red]);
        await openInventory(page);
        const requests = recordApiRequests(page);
        await page.getByRole('button', { name: 'Edit duck 1' }).click();
        // Another user adds 10 of the same duck while this form is open.
        expect((await page.request.post('/api/ducks', { data: { ...red, quantity: 10 } })).status()).toBe(200);
        await fillDuckForm(page, { price: '12' });
        await page.getByRole('dialog').getByRole('button', { name: 'Save Changes' }).click();
        await expectRows(page, [['1', 'Red', 'Medium', '$12.00', '15']]);
        expect(requests.find((request) => request.method === 'PATCH')?.body).toEqual({ price: '12' });
    });

    test('allows setting the quantity to zero', async ({ page }) => {
        await insertDucks([red]);
        await openInventory(page);
        await page.getByRole('button', { name: 'Edit duck 1' }).click();
        await fillDuckForm(page, { quantity: '0' });
        await page.getByRole('dialog').getByRole('button', { name: 'Save Changes' }).click();
        await expectRows(page, [['1', 'Red', 'Medium', '$10.00', '0']]);
    });

    test('saving without changes closes the dialog without a request', async ({ page }) => {
        await insertDucks([red]);
        await openInventory(page);
        const requests = recordApiRequests(page);
        await page.getByRole('button', { name: 'Edit duck 1' }).click();
        await fillDuckForm(page, { price: '10' });
        await page.getByRole('dialog').getByRole('button', { name: 'Save Changes' }).click();
        await expect(page.getByRole('dialog')).toBeHidden();
        expect(requests.filter((request) => request.method === 'PATCH')).toEqual([]);
        await expect(page.getByRole('button', { name: 'Edit duck 1' })).toBeFocused();
    });

    test('a price that collides with another active duck shows the conflict and keeps the dialog open', async ({ page }) => {
        await insertDucks([red, { ...red, price: '12.00' }]);
        await openInventory(page);
        await page.getByRole('button', { name: 'Edit duck 1' }).click();
        await fillDuckForm(page, { price: '12' });
        await page.getByRole('dialog').getByRole('button', { name: 'Save Changes' }).click();
        await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Another duck already has that color, size, and price.');
        await expect(page.getByRole('dialog').getByLabel('Price (USD)')).toHaveValue('12');
        expect((await allRows()).map((row) => row.price)).toEqual(['10.00', '12.00']);
    });

    test('editing a duck deleted elsewhere reports that it no longer exists', async ({ page }) => {
        await insertDucks([red]);
        await openInventory(page);
        await page.getByRole('button', { name: 'Edit duck 1' }).click();
        expect((await page.request.delete('/api/ducks/1')).status()).toBe(204);
        await fillDuckForm(page, { quantity: '9' });
        await page.getByRole('dialog').getByRole('button', { name: 'Save Changes' }).click();
        await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Duck not found.');
    });

    test('a lost connection during Edit keeps the form open so the same absolute values can be sent again', async ({ page }) => {
        await insertDucks([red]);
        await openInventory(page);
        await page.route('**/api/ducks/1', (route) => route.abort('connectionreset'));
        await page.getByRole('button', { name: 'Edit duck 1' }).click();
        await fillDuckForm(page, { quantity: '9' });
        const save = page.getByRole('dialog').getByRole('button', { name: 'Save Changes' });
        await save.click();
        await expect(page.getByRole('dialog').getByRole('alert')).toContainText('couldn’t confirm whether your change was saved');
        await page.unroute('**/api/ducks/1');
        await save.click();
        await expectRows(page, [['1', 'Red', 'Medium', '$10.00', '9']]);
    });
});

test.describe('Delete', () => {
    test('asks for confirmation; Cancel keeps the duck and returns focus to its Delete button', async ({ page }) => {
        await insertDucks([red]);
        await openInventory(page);
        await page.getByRole('button', { name: 'Delete duck 1' }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete Duck' });
        await expect(dialog).toContainText('Delete duck #1 (Red, Medium) from inventory?');
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
        await expectRows(page, [['1', 'Red', 'Medium', '$10.00', '5']]);
        await expect(page.getByRole('button', { name: 'Delete duck 1' })).toBeFocused();
    });

    test('confirming soft-deletes the duck, removes the row, and moves focus to Add Duck', async ({ page }) => {
        await insertDucks([red, { ...red, color: 'Green' }]);
        await openInventory(page);
        await page.getByRole('button', { name: 'Delete duck 1' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Delete Duck' }).click();
        await expect(page.getByRole('dialog')).toBeHidden();
        await expect(page.getByRole('status').filter({ hasText: 'Duck deleted from inventory.' })).toBeVisible();
        await expectRows(page, [['2', 'Green', 'Medium', '$10.00', '5']]);
        await expect(page.locator('#add-duck')).toBeFocused();
        expect((await allRows())[0]).toMatchObject({ id: 1, deleted: 1, quantity: 5 });
    });

    test('deleting a duck already deleted elsewhere still succeeds', async ({ page }) => {
        await insertDucks([red]);
        await openInventory(page);
        await page.request.delete('/api/ducks/1');
        await page.getByRole('button', { name: 'Delete duck 1' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Delete Duck' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Duck deleted from inventory.' })).toBeVisible();
        await expect(page.getByText('Your warehouse is empty')).toBeVisible();
    });

    test('a failed delete keeps the dialog open with the error, and retrying works', async ({ page }) => {
        await insertDucks([red]);
        await openInventory(page);
        await page.route('**/api/ducks/1', (route) => route.abort('connectionreset'));
        await page.getByRole('button', { name: 'Delete duck 1' }).click();
        const confirm = page.getByRole('dialog').getByRole('button', { name: 'Delete Duck' });
        await confirm.click();
        await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
        await expect(confirm).toBeEnabled();
        await page.unroute('**/api/ducks/1');
        await confirm.click();
        await expect(page.getByRole('dialog')).toBeHidden();
        await expect(page.getByText('Your warehouse is empty')).toBeVisible();
    });

    test('the dialog cannot be dismissed while the delete is in flight', async ({ page }) => {
        await insertDucks([red]);
        await openInventory(page);
        const { release } = await holdRequests(page, '**/api/ducks/1', 'DELETE');
        await page.getByRole('button', { name: 'Delete duck 1' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Delete Duck' }).click();
        await expect(page.getByRole('dialog').getByRole('button', { name: 'Deleting…' })).toBeDisabled();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeVisible();
        release();
        await expect(page.getByRole('dialog')).toBeHidden();
    });
});
