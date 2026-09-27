import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Decimal } from 'decimal.js';
import { allRows, clearDucks, insertDucks, recreateSchema } from '../support/database';
import { type RunningServer, request, startServer } from '../support/server';

const MAX_INT = 2_147_483_647;
let server: RunningServer;
const order = (body: Record<string, unknown>) => request(server.url, 'POST', '/api/orders', { body });
const redMediumOrder = { color: 'Red', size: 'Medium', quantity: 101, destinationCountry: 'USA', shippingMode: 'Sea' };

before(async () => {
    await recreateSchema();
    server = await startServer();
});
beforeEach(clearDucks);
after(async () => {
    await server?.stop();
    assert.doesNotMatch(server.output(), /Error/, 'the server logged an unexpected error');
});

describe('POST /api/orders', () => {
    test('matches the README example exactly', async () => {
        await insertDucks([{ color: 'Red', size: 'Medium', price: '10.00', quantity: 5 }]);
        const response = await order(redMediumOrder);
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, {
            packageType: 'Cardboard',
            protectionTypes: ['Moisture-absorbing beads', 'Bubble wrap'],
            currency: 'USD',
            quantity: 101,
            unitPrice: '10.00',
            merchandiseSubtotal: '1010.00',
            adjustments: [
                {
                    code: 'VOLUME_DISCOUNT',
                    description: '20% discount for more than 100 ducks',
                    base: '1010.00',
                    rate: '-0.20',
                    amount: '-202.00',
                },
                { code: 'PACKAGING', description: 'Cardboard packaging adjustment', base: '808.00', rate: '-0.01', amount: '-8.08' },
                { code: 'DESTINATION', description: 'Destination charge (USA)', base: '799.92', rate: '0.18', amount: '143.99' },
                { code: 'SHIPPING', description: 'Sea shipping', base: '400.00', amount: '400.00' },
            ],
            shipping: { mode: 'Sea', baseAmount: '400.00', discountAmount: '0.00', totalAmount: '400.00' },
            totalAmount: '1343.91',
        });
    });

    test('never changes inventory, and ignores stock levels', async () => {
        await insertDucks([{ color: 'Red', size: 'Medium', price: '10.00', quantity: 0 }]);
        const before = await allRows();
        assert.equal((await order({ ...redMediumOrder, quantity: 1_000_000 })).status, 200);
        assert.deepEqual(await allRows(), before);
    });

    test('uses the single active duck and ignores deleted ducks at other prices', async () => {
        await insertDucks([
            { color: 'Red', size: 'Medium', price: '99.00', quantity: 5, deleted: true },
            { color: 'Red', size: 'Medium', price: '10.00', quantity: 5 },
            { color: 'Red', size: 'Large', price: '50.00', quantity: 5 },
            { color: 'Green', size: 'Medium', price: '60.00', quantity: 5 },
        ]);
        const response = await order(redMediumOrder);
        assert.equal(response.body.unitPrice, '10.00');
    });

    test('returns 404 when no active duck has that color and size', async () => {
        await insertDucks([{ color: 'Red', size: 'Medium', price: '10.00', quantity: 5, deleted: true }]);
        const response = await order(redMediumOrder);
        assert.equal(response.status, 404);
        assert.equal(response.body.error.code, 'DUCK_NOT_FOUND');
    });

    test('returns 409 when active ducks with that color and size have different prices', async () => {
        await insertDucks([
            { color: 'Red', size: 'Medium', price: '10.00', quantity: 5 },
            { color: 'Red', size: 'Medium', price: '11.00', quantity: 5 },
        ]);
        const response = await order(redMediumOrder);
        assert.equal(response.status, 409);
        assert.equal(response.body.error.code, 'AMBIGUOUS_DUCK_PRICE');
    });

    test('packages and protects every size and shipping mode as specified', async () => {
        const sizes = { XLarge: 'Wood', Large: 'Wood', Medium: 'Cardboard', Small: 'Plastic', XSmall: 'Plastic' } as const;
        await insertDucks(Object.keys(sizes).map((size) => ({ color: 'Black', size, price: '1.00', quantity: 1 })));
        for (const [size, packageType] of Object.entries(sizes)) {
            for (const shippingMode of ['Land', 'Air', 'Sea']) {
                const response = await order({ color: 'Black', size, quantity: 1, destinationCountry: 'Peru', shippingMode });
                assert.equal(response.body.packageType, packageType);
                const expected =
                    shippingMode === 'Sea'
                        ? ['Moisture-absorbing beads', 'Bubble wrap']
                        : shippingMode === 'Air' && packageType === 'Plastic'
                          ? ['Bubble wrap']
                          : ['Polystyrene balls'];
                assert.deepEqual(response.body.protectionTypes, expected, `${size} by ${shippingMode}`);
            }
        }
    });

    test('never reports a negative-zero amount', async () => {
        await insertDucks([{ color: 'Red', size: 'Medium', price: '0.25', quantity: 1 }]);
        const response = await order({ ...redMediumOrder, quantity: 1 });
        assert.equal(response.body.adjustments[0].amount, '0.00');
        assert.doesNotMatch(response.text, /"-0\.00"/);
    });

    test('handles the largest possible order exactly, with line items that sum to the total', async () => {
        await insertDucks([{ color: 'Red', size: 'Medium', price: '99999999.99', quantity: 1 }]);
        for (const shippingMode of ['Land', 'Air', 'Sea']) {
            const response = await order({ ...redMediumOrder, quantity: MAX_INT, destinationCountry: 'Bolivia', shippingMode });
            assert.equal(response.status, 200);
            assert.equal(response.body.merchandiseSubtotal, '214748364678525163.53');
            const sum = response.body.adjustments.reduce(
                (total: Decimal, adjustment: { amount: string }) => total.plus(adjustment.amount),
                new Decimal(response.body.merchandiseSubtotal)
            );
            assert.equal(sum.toFixed(2), response.body.totalAmount);
        }
    });

    test('trims and matches the destination case-insensitively, and echoes the trimmed name', async () => {
        await insertDucks([{ color: 'Red', size: 'Medium', price: '10.00', quantity: 5 }]);
        const response = await order({ ...redMediumOrder, destinationCountry: '  bOLIVIA\t' });
        const destination = response.body.adjustments.find((adjustment: { code: string }) => adjustment.code === 'DESTINATION');
        assert.equal(destination.rate, '0.13');
        assert.equal(destination.description, 'Destination charge (bOLIVIA)');
    });

    const invalidOrders: [string, Record<string, unknown>, string][] = [
        ['zero quantity', { ...redMediumOrder, quantity: 0 }, 'quantity'],
        ['quantity above INT', { ...redMediumOrder, quantity: MAX_INT + 1 }, 'quantity'],
        ['fractional quantity', { ...redMediumOrder, quantity: 2.5 }, 'quantity'],
        ['blank destination', { ...redMediumOrder, destinationCountry: '   ' }, 'destinationCountry'],
        ['missing destination', { ...redMediumOrder, destinationCountry: undefined }, 'destinationCountry'],
        ['numeric destination', { ...redMediumOrder, destinationCountry: 1 }, 'destinationCountry'],
        ['lowercase shipping mode', { ...redMediumOrder, shippingMode: 'sea' }, 'shippingMode'],
        ['unknown shipping mode', { ...redMediumOrder, shippingMode: 'Rail' }, 'shippingMode'],
        ['unknown color', { ...redMediumOrder, color: 'Blue' }, 'color'],
        ['price supplied', { ...redMediumOrder, price: '1.00' }, '_form'],
    ];
    for (const [name, body, field] of invalidOrders) {
        test(`rejects ${name}`, async () => {
            await insertDucks([{ color: 'Red', size: 'Medium', price: '10.00', quantity: 5 }]);
            const response = await order(body);
            assert.equal(response.status, 400, response.text);
            assert.ok(response.body.error.fieldErrors[field], response.text);
        });
    }

    test('validates before looking up the duck', async () => {
        const response = await order({ ...redMediumOrder, shippingMode: 'Rail' });
        assert.equal(response.status, 400);
    });
});
