import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDuckSchema, editDuckSchema, idSchema, priceSchema } from './validation.js';

test('price accepts positive decimal strings with at most two decimal places', () => {
    for (const price of ['10', '10.5', '10.50', '.5', '0.01', '99999999.99']) {
        assert.equal(priceSchema.safeParse(price).success, true, price);
    }
    for (const price of ['', '.', '0', '0.00', '10.', '10.555', '1e1', '-1', '100000000', ' 10']) {
        assert.equal(priceSchema.safeParse(price).success, false, String(price));
    }
});

test('numeric prices normalize to strings without rounding fractional cents or coercing other types', () => {
    for (const price of [20, 10.5, 0.5, 0.01, 99999999.99]) {
        assert.equal(priceSchema.parse(price), String(price));
    }
    for (const price of [0, -1, 1.005, 0.001, 100000000, Number.NaN, Number.POSITIVE_INFINITY, null, true, [], {}]) {
        assert.equal(priceSchema.safeParse(price).success, false, String(price));
    }
    assert.equal(addDuckSchema.parse({ color: 'Red', size: 'Medium', price: 20, quantity: 1 }).price, '20');
    assert.deepEqual(editDuckSchema.parse({ price: 12.5 }), { price: '12.5' });
});

test('adding requires exact enum values, a positive quantity, and no unknown fields', () => {
    const duck = { color: 'Red', size: 'Medium', price: '10', quantity: 1 };
    assert.equal(addDuckSchema.safeParse(duck).success, true);
    assert.equal(addDuckSchema.safeParse({ ...duck, color: 'red' }).success, false);
    assert.equal(addDuckSchema.safeParse({ ...duck, quantity: 0 }).success, false);
    assert.equal(addDuckSchema.safeParse({ ...duck, quantity: 1.5 }).success, false);
    assert.equal(addDuckSchema.safeParse({ ...duck, deleted: true }).success, false);
});

test('editing accepts only price and quantity, and at least one of them', () => {
    assert.equal(editDuckSchema.safeParse({ quantity: 0 }).success, true);
    assert.equal(editDuckSchema.safeParse({ price: '5' }).success, true);
    assert.equal(editDuckSchema.safeParse({}).success, false);
    assert.equal(editDuckSchema.safeParse({ color: 'Red' }).success, false);
});

test('duck IDs must be positive integers within MySQL INT range', () => {
    assert.equal(idSchema.parse('2147483647'), 2_147_483_647);
    for (const id of ['0', '01', '-1', '1.5', 'abc', '2147483648']) {
        assert.equal(idSchema.safeParse(id).success, false, id);
    }
});
