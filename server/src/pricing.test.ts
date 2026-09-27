import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Decimal } from 'decimal.js';
import type { OrderInput } from '../../shared/contracts.js';
import { calculateOrder } from './pricing.js';

const order = (overrides: Partial<OrderInput> = {}): OrderInput => ({
    color: 'Red',
    size: 'Medium',
    quantity: 1,
    destinationCountry: 'USA',
    shippingMode: 'Land',
    ...overrides,
});
const amounts = (result: ReturnType<typeof calculateOrder>) =>
    Object.fromEntries(result.adjustments.map((adjustment) => [adjustment.code, adjustment.amount]));

test('README example: 101 Medium to USA by Sea', () => {
    const result = calculateOrder(order({ quantity: 101, shippingMode: 'Sea' }), '10.00');
    assert.equal(result.packageType, 'Cardboard');
    assert.deepEqual(result.protectionTypes, ['Moisture-absorbing beads', 'Bubble wrap']);
    assert.equal(result.merchandiseSubtotal, '1010.00');
    assert.deepEqual(amounts(result), {
        VOLUME_DISCOUNT: '-202.00',
        PACKAGING: '-8.08',
        DESTINATION: '143.99',
        SHIPPING: '400.00',
    });
    assert.equal(result.totalAmount, '1343.91');
});

test('README example: 1,001 Large to USA by Air', () => {
    const result = calculateOrder(order({ size: 'Large', quantity: 1001, shippingMode: 'Air' }), '10.00');
    assert.deepEqual(amounts(result), {
        VOLUME_DISCOUNT: '-2002.00',
        PACKAGING: '400.40',
        DESTINATION: '1513.51',
        SHIPPING: '30030.00',
        AIR_DISCOUNT: '-4504.50',
    });
    assert.deepEqual(result.shipping, { mode: 'Air', baseAmount: '30030.00', discountAmount: '-4504.50', totalAmount: '25525.50' });
    assert.equal(result.totalAmount, '35447.41');
});

test('each percentage rounds half-up to cents on the running total', () => {
    const result = calculateOrder(order({ size: 'Large', destinationCountry: 'Peru', shippingMode: 'Sea' }), '0.10');
    assert.deepEqual(amounts(result), { PACKAGING: '0.01', DESTINATION: '0.02', SHIPPING: '400.00' });
    assert.equal(result.totalAmount, '400.13');
});

test('volume discount applies above 100 units only', () => {
    assert.equal(amounts(calculateOrder(order({ quantity: 100 }), '1.00')).VOLUME_DISCOUNT, undefined);
    assert.equal(amounts(calculateOrder(order({ quantity: 101 }), '1.00')).VOLUME_DISCOUNT, '-20.20');
});

test('Air shipping discount applies above 1,000 units only', () => {
    assert.equal(amounts(calculateOrder(order({ quantity: 1000, shippingMode: 'Air' }), '1.00')).AIR_DISCOUNT, undefined);
    assert.equal(amounts(calculateOrder(order({ quantity: 1001, shippingMode: 'Air' }), '1.00')).AIR_DISCOUNT, '-4504.50');
    assert.equal(amounts(calculateOrder(order({ quantity: 1001, shippingMode: 'Land' }), '1.00')).AIR_DISCOUNT, undefined);
});

test('shipping cost per mode', () => {
    const shipping = (shippingMode: OrderInput['shippingMode']) =>
        calculateOrder(order({ quantity: 3, shippingMode }), '1.00').shipping.totalAmount;
    assert.equal(shipping('Land'), '30.00');
    assert.equal(shipping('Air'), '90.00');
    assert.equal(shipping('Sea'), '400.00');
});

test('package type by size and protection by shipping mode', () => {
    const expected = {
        XLarge: ['Wood', { Land: ['Polystyrene balls'], Air: ['Polystyrene balls'] }],
        Large: ['Wood', { Land: ['Polystyrene balls'], Air: ['Polystyrene balls'] }],
        Medium: ['Cardboard', { Land: ['Polystyrene balls'], Air: ['Polystyrene balls'] }],
        Small: ['Plastic', { Land: ['Polystyrene balls'], Air: ['Bubble wrap'] }],
        XSmall: ['Plastic', { Land: ['Polystyrene balls'], Air: ['Bubble wrap'] }],
    } as const;
    for (const [size, [packageType, protection]] of Object.entries(expected)) {
        for (const shippingMode of ['Land', 'Air', 'Sea'] as const) {
            const result = calculateOrder(order({ size: size as OrderInput['size'], shippingMode }), '1.00');
            assert.equal(result.packageType, packageType, size);
            const expectedProtection = shippingMode === 'Sea' ? ['Moisture-absorbing beads', 'Bubble wrap'] : protection[shippingMode];
            assert.deepEqual(result.protectionTypes, expectedProtection, `${size} by ${shippingMode}`);
        }
    }
});

test('packaging rate by material', () => {
    const packaging = (size: OrderInput['size']) => calculateOrder(order({ size }), '100.00').adjustments[0];
    assert.equal(packaging('Large').rate, '0.05');
    assert.equal(packaging('Medium').rate, '-0.01');
    assert.equal(packaging('Small').rate, '0.10');
});

test('destination rates match case-insensitively after trimming; other countries pay 15%', () => {
    const rate = (destinationCountry: string) =>
        calculateOrder(order({ destinationCountry }), '1.00').adjustments.find((adjustment) => adjustment.code === 'DESTINATION')?.rate;
    assert.equal(rate(' usa '), '0.18');
    assert.equal(rate('BOLIVIA'), '0.13');
    assert.equal(rate('India'), '0.19');
    assert.equal(rate('US'), '0.15');
    assert.equal(rate('Peru'), '0.15');
});

test('line items always sum to the total', () => {
    for (const quantity of [1, 99, 101, 999, 1001, 2_147_483_647]) {
        for (const shippingMode of ['Land', 'Air', 'Sea'] as const) {
            const result = calculateOrder(order({ size: 'XSmall', quantity, shippingMode, destinationCountry: 'Bolivia' }), '19.99');
            const sum = result.adjustments.reduce(
                (total, adjustment) => total.plus(adjustment.amount),
                new Decimal(result.merchandiseSubtotal)
            );
            assert.equal(sum.toFixed(2), result.totalAmount, `${quantity} by ${shippingMode}`);
        }
    }
});
