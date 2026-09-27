import { allRows, insertDucks } from '../support/database';
import { expect, fillDuckForm, holdRequests, openInventory, test } from './fixtures';

test('Escape, Cancel, and the close button dismiss the form without saving', async ({ page }) => {
    await openInventory(page);
    const dialog = page.getByRole('dialog');
    for (const dismiss of [
        () => page.keyboard.press('Escape'),
        () => dialog.getByRole('button', { name: 'Cancel' }).click(),
        () => dialog.getByRole('button', { name: 'Close dialog' }).click(),
    ]) {
        await page.locator('#add-duck').click();
        await fillDuckForm(page, { price: '1', quantity: '1' });
        await dismiss();
        await expect(dialog).toBeHidden();
        await expect(page.locator('#add-duck')).toBeFocused();
    }
    expect(await allRows()).toEqual([]);
});

test('reopening the form starts fresh', async ({ page }) => {
    await openInventory(page);
    await page.locator('#add-duck').click();
    await fillDuckForm(page, { color: 'Black', price: '1e1', quantity: '4' });
    await page.getByRole('dialog').getByRole('button', { name: 'Add Duck' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#add-duck').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Color')).toHaveValue('Red');
    await expect(dialog.getByLabel('Price (USD)')).toHaveValue('');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('Tab and Shift+Tab stay inside the open dialog', async ({ page }) => {
    await insertDucks([{ color: 'Red', size: 'Medium', price: '1.00', quantity: 1 }]);
    await openInventory(page);
    for (const opener of ['#add-duck', '[aria-label="Edit duck 1"]', '[aria-label="Delete duck 1"]']) {
        await page.locator(opener).click();
        for (const key of ['Tab', 'Shift+Tab']) {
            for (let press = 0; press < 12; press++) {
                await page.keyboard.press(key);
                expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog'))), `${opener} ${key} #${press}`).toBe(
                    true
                );
            }
        }
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();
    }
});

test('while saving, the form cannot be dismissed or edited, and it closes once the save finishes', async ({ page }) => {
    await openInventory(page);
    const { release } = await holdRequests(page, '**/api/ducks', 'POST');
    await page.locator('#add-duck').click();
    await fillDuckForm(page, { price: '2', quantity: '2' });
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Add Duck' }).click();
    await expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await expect(dialog.getByLabel('Price (USD)')).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    // Chrome force-closes a modal on a second Escape; the app must reopen it while the request is running.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).toBeHidden();
    expect(await allRows()).toHaveLength(1);
});

test('the page behind an open dialog is inert', async ({ page }) => {
    await insertDucks([{ color: 'Red', size: 'Medium', price: '1.00', quantity: 1 }]);
    await openInventory(page);
    await page.locator('#add-duck').click();
    // A click on the backdrop must not dismiss the form or reach the page.
    await page.mouse.click(5, 5);
    await expect(page.getByRole('dialog')).toBeVisible();
    const clickedBehind = await page
        .getByRole('button', { name: 'Edit duck 1' })
        .click({ timeout: 1000 })
        .then(() => true)
        .catch(() => false);
    expect(clickedBehind).toBe(false);
    await expect(page.getByRole('dialog', { name: 'Add Duck' })).toBeVisible();
});
