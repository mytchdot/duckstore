import { test as base, expect, type Page, type Route } from '@playwright/test';
import { clearDucks } from '../support/database';

export { expect };
export const MAX_INT = 2_147_483_647;

/** Marks a response a test fakes on purpose, so the 5xx guard below ignores it. */
export const SIMULATED = { 'x-simulated-by-test': '1' };

export const test = base.extend({
    page: async ({ page }, use) => {
        // Every test starts from an empty warehouse; tests seed what they need after this runs.
        await clearDucks();
        // Keep runs offline and deterministic: the page's only external request is the Inter font stylesheet.
        await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
        const problems: string[] = [];
        page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
        page.on('console', (message) => {
            // Chrome logs every 4xx/5xx fetch as "Failed to load resource"; expected 4xx responses are part of the tests.
            if (['error', 'warning'].includes(message.type()) && !message.text().startsWith('Failed to load resource')) {
                problems.push(`console ${message.type()}: ${message.text()}`);
            }
        });
        page.on('response', (response) => {
            if (response.status() >= 500 && !response.headers()['x-simulated-by-test']) {
                problems.push(`HTTP ${response.status()} from ${response.url()}`);
            }
        });
        await use(page);
        expect(problems, 'no console errors or warnings, page errors, or server errors').toEqual([]);
    },
});

/** Visible table cells (ID, color, size, price, quantity) for every row, once loading has finished. */
export async function tableRows(page: Page) {
    await expect(page.getByText('Loading inventory…')).toHaveCount(0);
    return page
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll('td')].slice(0, 5).map((cell) => cell.textContent?.trim())));
}

/** Waits until the table shows exactly these rows. Use after any action, since the table reloads asynchronously. */
export async function expectRows(page: Page, rows: string[][]) {
    await expect.poll(() => tableRows(page)).toEqual(rows);
}

export async function openInventory(page: Page) {
    await page.goto('/');
    await expect(page.getByText('Loading inventory…')).toHaveCount(0);
}

export async function fillDuckForm(page: Page, fields: { color?: string; size?: string; price?: string; quantity?: string }) {
    const dialog = page.getByRole('dialog');
    if (fields.color) await dialog.getByLabel('Color').selectOption(fields.color);
    if (fields.size) await dialog.getByLabel('Size').selectOption(fields.size);
    if (fields.price !== undefined) await dialog.getByLabel('Price (USD)').fill(fields.price);
    if (fields.quantity !== undefined) await dialog.getByLabel('Quantity').fill(fields.quantity);
}

/** Holds matching requests until `release` is called, to observe the UI while a request is in flight. */
export async function holdRequests(page: Page, url: string, method: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const held: Route[] = [];
    await page.route(url, async (route) => {
        if (route.request().method() !== method) return route.continue();
        held.push(route);
        await gate;
        await route.continue();
    });
    return { release, held };
}

/** Records the method and JSON body of every API request the page sends. */
export function recordApiRequests(page: Page) {
    const requests: { method: string; path: string; body: unknown }[] = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (!url.pathname.startsWith('/api/')) return;
        const text = request.postData();
        requests.push({ method: request.method(), path: url.pathname, body: text ? JSON.parse(text) : undefined });
    });
    return requests;
}
