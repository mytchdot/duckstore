import { insertDucks, mockupDucks } from '../support/database';
import { expect, expectRows, fillDuckForm, openInventory, SIMULATED, test } from './fixtures';

test('shows the mockup inventory sorted by quantity, with formatted money and counts', async ({ page }) => {
    await insertDucks(mockupDucks);
    await openInventory(page);
    await expect(page).toHaveTitle('Duck Warehouse | Duck Store Platform');
    await expect(page.getByRole('heading', { name: 'Duck Warehouse' })).toBeVisible();
    await expectRows(page, [
        ['6', 'Yellow', 'XLarge', '$25.00', '5,000'],
        ['2', 'Green', 'Large', '$20.00', '2,000'],
        ['1', 'Red', 'Large', '$20.00', '1,800'],
        ['4', 'Black', 'Medium', '$15.00', '950'],
        ['3', 'Yellow', 'Medium', '$15.00', '800'],
        ['5', 'Green', 'Small', '$10.00', '600'],
        ['7', 'Red', 'XSmall', '$8.00', '300'],
    ]);
    await expect(page.getByRole('button', { name: /^Edit duck/ })).toHaveCount(7);
    await expect(page.getByRole('button', { name: /^Delete duck/ })).toHaveCount(7);
});

test('hides deleted ducks and shows zero-quantity ducks last', async ({ page }) => {
    await insertDucks([
        { color: 'Red', size: 'Large', price: '1.00', quantity: 0 },
        { color: 'Green', size: 'Large', price: '1.00', quantity: 9, deleted: true },
        { color: 'Black', size: 'Large', price: '99999999.99', quantity: 2_147_483_647 },
    ]);
    await openInventory(page);
    await expectRows(page, [
        ['3', 'Black', 'Large', '$99,999,999.99', '2,147,483,647'],
        ['1', 'Red', 'Large', '$1.00', '0'],
    ]);
});

test('shows an empty state for an empty warehouse', async ({ page }) => {
    await openInventory(page);
    await expect(page.getByRole('heading', { name: 'Your warehouse is empty' })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(0);
});

test('shows Store as unavailable, because the Store module is backend-only', async ({ page }) => {
    await openInventory(page);
    await expect(page.getByRole('button', { name: /Store/ })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Warehouse' })).toHaveAttribute('aria-current', 'page');
});

test('the refresh button picks up changes made elsewhere', async ({ page }) => {
    await openInventory(page);
    await insertDucks([{ color: 'Red', size: 'Small', price: '3.00', quantity: 4 }]);
    await page.getByRole('button', { name: 'Refresh inventory' }).click();
    await expectRows(page, [['1', 'Red', 'Small', '$3.00', '4']]);
});

test('a failed load explains the problem without mentioning a change, and Try again recovers', async ({ page }) => {
    await insertDucks(mockupDucks.slice(0, 1));
    await page.route('**/api/ducks', (route) => route.abort('connectionreset'));
    await page.goto('/');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Unable to load inventory');
    await expect(alert).not.toContainText(/change|saved/i);
    await expect(page.getByText('Your warehouse is empty')).toHaveCount(0);
    await page.unroute('**/api/ducks');
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expectRows(page, [['1', 'Red', 'Large', '$20.00', '1,800']]);
    await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an unreadable server error shows a generic message', async ({ page }) => {
    await page.route('**/api/ducks', (route) => route.fulfill({ status: 503, body: 'Service Unavailable', headers: SIMULATED }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('The request could not be completed.');
});

test('a slow, stale inventory response never overwrites a newer one', async ({ page }) => {
    let delayedFirst = false;
    await page.route('**/api/ducks', async (route) => {
        if (route.request().method() !== 'GET' || delayedFirst) return route.continue();
        delayedFirst = true;
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await route.fulfill({ response }).catch(() => {});
    });
    await page.goto('/');
    await page.locator('#add-duck').click();
    await fillDuckForm(page, { price: '4.00', quantity: '2' });
    await page.getByRole('dialog').getByRole('button', { name: 'Add Duck' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Duck added to inventory.' })).toBeVisible();
    await expectRows(page, [['1', 'Red', 'Medium', '$4.00', '2']]);
    // The first request, fetched before the add, resolves now and must be ignored.
    await page.waitForTimeout(3500);
    await expectRows(page, [['1', 'Red', 'Medium', '$4.00', '2']]);
});

test('the Actions header lines up with the Edit and Delete links, as in the mockup', async ({ page }) => {
    await insertDucks(mockupDucks);
    await openInventory(page);
    for (const width of [1280, 1000, 1600]) {
        await page.setViewportSize({ width, height: 900 });
        const [header, links] = await page.evaluate(() => {
            const th = [...document.querySelectorAll('th')].find((cell) => cell.textContent?.trim() === 'Actions') as HTMLElement;
            const actions = document.querySelector('tbody tr td:last-child > div') as HTMLElement;
            return [
                th.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(th).paddingLeft),
                actions.getBoundingClientRect().left,
            ];
        });
        expect(Math.abs(header - links), `at ${width}px`).toBeLessThan(1);
    }
});

test('at phone width the page never scrolls sideways; the table scrolls inside its card', async ({ page }) => {
    await insertDucks(mockupDucks);
    await page.setViewportSize({ width: 375, height: 800 });
    await openInventory(page);
    const layout = await page.evaluate(() => {
        const scroller = document.querySelector('table')?.parentElement as HTMLElement;
        return {
            pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
            tableScrolls: scroller.scrollWidth > scroller.clientWidth,
        };
    });
    expect(layout).toEqual({ pageOverflow: 0, tableScrolls: true });
    await page.locator('#add-duck').click();
    const dialogBox = await page.getByRole('dialog').boundingBox();
    expect(dialogBox?.x).toBeGreaterThanOrEqual(0);
    expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(375);
});
