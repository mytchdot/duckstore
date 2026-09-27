import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { allRows, clearDucks, insertDucks, mockupDucks, recreateSchema } from '../support/database';
import { type RunningServer, request, startServer } from '../support/server';

const MAX_INT = 2_147_483_647;
let server: RunningServer;
const api = (method: string, path: string, options?: Parameters<typeof request>[3]) => request(server.url, method, `/api${path}`, options);
const addDuck = (duck: Record<string, unknown>) => api('POST', '/ducks', { body: duck });
const redMedium = { color: 'Red', size: 'Medium', price: '10.00', quantity: 5 };

before(async () => {
    await recreateSchema();
    server = await startServer();
});
beforeEach(clearDucks);
after(async () => {
    await server?.stop();
    assert.doesNotMatch(server.output(), /Error/, 'the server logged an unexpected error');
});

function assertValidationError(response: Awaited<ReturnType<typeof api>>, field: string) {
    assert.equal(response.status, 400, response.text);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.ok(response.body.error.fieldErrors[field]?.length, `expected a "${field}" error, got ${response.text}`);
}

describe('GET /api/ducks', () => {
    test('returns an empty list for an empty warehouse', async () => {
        const response = await api('GET', '/ducks');
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /application\/json/);
        assert.deepEqual(response.body, []);
    });

    test('lists active ducks by quantity descending, then ID ascending, in the documented shape', async () => {
        await insertDucks(mockupDucks);
        await insertDucks([
            { color: 'Black', size: 'XSmall', price: '1.00', quantity: 800 },
            { color: 'Black', size: 'Large', price: '1.00', quantity: 99999, deleted: true },
        ]);
        const response = await api('GET', '/ducks');
        assert.deepEqual(
            response.body.map((duck: { id: number }) => duck.id),
            [6, 2, 1, 4, 3, 8, 5, 7]
        );
        assert.deepEqual(response.body[0], { id: 6, color: 'Yellow', size: 'XLarge', price: '25.00', quantity: 5000, deleted: false });
    });

    test('does not expose internal columns or headers', async () => {
        await insertDucks([redMedium]);
        const response = await api('GET', '/ducks');
        assert.deepEqual(Object.keys(response.body[0]).sort(), ['color', 'deleted', 'id', 'price', 'quantity', 'size']);
        assert.equal(response.headers.get('x-powered-by'), null);
    });
});

describe('POST /api/ducks', () => {
    test('creates a duck and returns 201 with the stored duck', async () => {
        const response = await addDuck(redMedium);
        assert.equal(response.status, 201);
        assert.deepEqual(response.body, { id: 1, ...redMedium, deleted: false });
        assert.deepEqual(await allRows(), [{ id: 1, ...redMedium, deleted: 0 }]);
    });

    test('normalizes prices to two decimal places', async () => {
        for (const [input, stored] of [
            ['10', '10.00'],
            ['10.5', '10.50'],
            ['.5', '0.50'],
            ['0.01', '0.01'],
            ['99999999.99', '99999999.99'],
            ['00000012.30', '12.30'],
        ]) {
            const response = await addDuck({ ...redMedium, price: input });
            assert.equal(response.status, 201, `${input}: ${response.text}`);
            assert.equal(response.body.price, stored);
        }
    });

    test('merges into an active duck with the same color, size, and price (200, same ID, summed quantity)', async () => {
        const created = await addDuck(redMedium);
        const merged = await addDuck({ ...redMedium, price: 10, quantity: 7 });
        assert.equal(merged.status, 200);
        assert.deepEqual(merged.body, { ...created.body, quantity: 12 });
        assert.equal((await allRows()).length, 1);
    });

    test('accepts numeric prices and returns exact two-decimal strings', async () => {
        for (const price of [20, 10.5, 0.5, 0.01, 99999999.99]) {
            const response = await addDuck({ ...redMedium, price });
            assert.equal(response.status, 201, response.text);
            assert.equal(response.body.price, price.toFixed(2));
            assert.equal((await allRows()).find((row) => row.id === response.body.id)?.price, price.toFixed(2));
        }
    });

    test('creates separate ducks when color, size, or price differ', async () => {
        const statuses = [];
        for (const duck of [
            redMedium,
            { ...redMedium, color: 'Green' },
            { ...redMedium, size: 'Large' },
            { ...redMedium, price: '10.01' },
        ]) {
            statuses.push((await addDuck(duck)).status);
        }
        assert.deepEqual(statuses, [201, 201, 201, 201]);
    });

    test('never restores a deleted duck: a matching add creates a new duck with only the new quantity', async () => {
        const [deletedId] = await insertDucks([{ ...redMedium, quantity: 5000, deleted: true }]);
        const response = await addDuck({ ...redMedium, quantity: 1 });
        assert.equal(response.status, 201);
        assert.notEqual(response.body.id, deletedId);
        assert.equal(response.body.quantity, 1);
        const rows = await allRows();
        assert.deepEqual(
            rows.map((row) => [row.quantity, row.deleted]),
            [
                [5000, 1],
                [1, 0],
            ]
        );
    });

    test('allows several deleted ducks with the same color, size, and price', async () => {
        await insertDucks([
            { ...redMedium, deleted: true },
            { ...redMedium, deleted: true },
        ]);
        const first = await addDuck(redMedium);
        assert.equal(first.status, 201);
        assert.equal((await api('DELETE', `/ducks/${first.body.id}`)).status, 204);
        assert.equal((await addDuck(redMedium)).status, 201);
        assert.equal((await allRows()).length, 4);
    });

    test('accepts quantities up to the INT maximum, including a merge that lands exactly on it', async () => {
        assert.equal((await addDuck({ ...redMedium, quantity: MAX_INT - 1 })).status, 201);
        const merged = await addDuck({ ...redMedium, quantity: 1 });
        assert.equal(merged.status, 200);
        assert.equal(merged.body.quantity, MAX_INT);
    });

    test('rejects a merge that would overflow and changes nothing', async () => {
        await addDuck({ ...redMedium, quantity: MAX_INT });
        const before = await allRows();
        const response = await addDuck({ ...redMedium, quantity: 1 });
        assert.equal(response.status, 409);
        assert.equal(response.body.error.code, 'QUANTITY_LIMIT_EXCEEDED');
        assert.deepEqual(await allRows(), before);
    });

    const invalidAdds: [string, Record<string, unknown>, string][] = [
        ['lowercase color', { ...redMedium, color: 'red' }, 'color'],
        ['unknown color', { ...redMedium, color: 'Blue' }, 'color'],
        ['unknown size', { ...redMedium, size: 'Huge' }, 'size'],
        ['numeric zero price', { ...redMedium, price: 0 }, 'price'],
        ['numeric negative price', { ...redMedium, price: -1 }, 'price'],
        ['numeric fractional cents', { ...redMedium, price: 1.005 }, 'price'],
        ['numeric price above the limit', { ...redMedium, price: 100000000 }, 'price'],
        ['boolean price', { ...redMedium, price: true }, 'price'],
        ['zero price', { ...redMedium, price: '0' }, 'price'],
        ['zero price with decimals', { ...redMedium, price: '0.00' }, 'price'],
        ['negative price', { ...redMedium, price: '-1' }, 'price'],
        ['three decimal places', { ...redMedium, price: '1.005' }, 'price'],
        ['nine integer digits', { ...redMedium, price: '100000000' }, 'price'],
        ['exponent price', { ...redMedium, price: '1e2' }, 'price'],
        ['trailing dot', { ...redMedium, price: '10.' }, 'price'],
        ['empty price', { ...redMedium, price: '' }, 'price'],
        ['padded price', { ...redMedium, price: ' 10' }, 'price'],
        ['zero quantity', { ...redMedium, quantity: 0 }, 'quantity'],
        ['negative quantity', { ...redMedium, quantity: -1 }, 'quantity'],
        ['fractional quantity', { ...redMedium, quantity: 1.5 }, 'quantity'],
        ['string quantity', { ...redMedium, quantity: '5' }, 'quantity'],
        ['quantity above INT', { ...redMedium, quantity: MAX_INT + 1 }, 'quantity'],
        ['missing price', { color: 'Red', size: 'Medium', quantity: 1 }, 'price'],
        ['unknown field', { ...redMedium, deleted: true }, '_form'],
        ['id supplied', { ...redMedium, id: 99 }, '_form'],
    ];
    for (const [name, body, field] of invalidAdds) {
        test(`rejects ${name} and saves nothing`, async () => {
            assertValidationError(await addDuck(body), field);
            assert.deepEqual(await allRows(), []);
        });
    }

    test('reports each invalid price with exactly one message', async () => {
        for (const price of ['-1', 'abc', '1.005', '0', '']) {
            const response = await addDuck({ ...redMedium, price });
            assert.equal(response.body.error.fieldErrors.price.length, 1, `${JSON.stringify(price)}: ${response.text}`);
        }
    });

    test('rejects a body that is not a JSON object', async () => {
        assertValidationError(await api('POST', '/ducks', { raw: '[]' }), '_form');
        // Express's strict JSON parser accepts only objects and arrays at the top level.
        const response = await api('POST', '/ducks', { raw: 'null' });
        assert.equal(response.status, 400);
        assert.equal(response.body.error.code, 'INVALID_JSON');
    });
});

describe('PATCH /api/ducks/:id', () => {
    let id: number;
    beforeEach(async () => {
        [id] = await insertDucks([redMedium]);
    });

    test('updates only the price when only the price is sent', async () => {
        const response = await api('PATCH', `/ducks/${id}`, { body: { price: '12.5' } });
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { id, ...redMedium, price: '12.50', deleted: false });
    });

    test('accepts a numeric price edit and preserves quantity', async () => {
        const response = await api('PATCH', `/ducks/${id}`, { body: { price: 12.5 } });
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { id, ...redMedium, price: '12.50', deleted: false });
        assert.deepEqual((await allRows())[0], { id, ...redMedium, price: '12.50', deleted: 0 });
    });

    test('updates only the quantity when only the quantity is sent, allowing zero', async () => {
        const response = await api('PATCH', `/ducks/${id}`, { body: { quantity: 0 } });
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { id, ...redMedium, quantity: 0, deleted: false });
        assert.equal((await api('GET', '/ducks')).body[0].quantity, 0, 'a zero-quantity duck stays listed');
    });

    test('updates price and quantity together and re-sorts the list', async () => {
        await insertDucks([{ ...redMedium, color: 'Green', quantity: 100 }]);
        await api('PATCH', `/ducks/${id}`, { body: { price: '11', quantity: 500 } });
        const list = (await api('GET', '/ducks')).body;
        assert.deepEqual(
            list.map((duck: { id: number; price: string }) => [duck.id, duck.price]),
            [
                [id, '11.00'],
                [id + 1, '10.00'],
            ]
        );
    });

    test('accepts its own current price in another format', async () => {
        const response = await api('PATCH', `/ducks/${id}`, { body: { price: '10' } });
        assert.equal(response.status, 200);
        assert.equal(response.body.price, '10.00');
    });

    test('rejects a price that collides with another active duck, and changes nothing', async () => {
        await insertDucks([{ ...redMedium, price: '12.00' }]);
        const before = await allRows();
        const response = await api('PATCH', `/ducks/${id}`, { body: { price: '12', quantity: 1 } });
        assert.equal(response.status, 409);
        assert.equal(response.body.error.code, 'DUCK_ALREADY_EXISTS');
        assert.deepEqual(await allRows(), before);
    });

    test('allows a price used only by deleted ducks, or by a different color or size', async () => {
        await insertDucks([
            { ...redMedium, price: '12.00', deleted: true },
            { ...redMedium, color: 'Green', price: '13.00' },
            { ...redMedium, size: 'Large', price: '14.00' },
        ]);
        for (const price of ['12.00', '13.00', '14.00']) {
            assert.equal((await api('PATCH', `/ducks/${id}`, { body: { price } })).status, 200, price);
        }
    });

    test('returns 404 for unknown and deleted ducks without changing them', async () => {
        const [deletedId] = await insertDucks([{ ...redMedium, price: '1.00', deleted: true }]);
        for (const target of [deletedId, 999, MAX_INT]) {
            const response = await api('PATCH', `/ducks/${target}`, { body: { quantity: 1 } });
            assert.equal(response.status, 404, String(target));
            assert.equal(response.body.error.code, 'DUCK_NOT_FOUND');
        }
        assert.equal((await allRows()).find((row) => row.id === deletedId)?.quantity, 5);
    });

    const invalidEdits: [string, unknown, string][] = [
        ['an empty body', {}, '_form'],
        ['color', { color: 'Green' }, '_form'],
        ['size', { size: 'Large' }, '_form'],
        ['deleted', { deleted: true }, '_form'],
        ['a negative quantity', { quantity: -1 }, 'quantity'],
        ['a quantity above INT', { quantity: MAX_INT + 1 }, 'quantity'],
        ['a null price', { price: null }, 'price'],
        ['a zero price', { price: '0.00' }, 'price'],
        ['numeric fractional cents', { price: 1.005 }, 'price'],
        ['a numeric price above the limit', { price: 100000000 }, 'price'],
    ];
    for (const [name, body, field] of invalidEdits) {
        test(`rejects ${name}`, async () => {
            assertValidationError(await api('PATCH', `/ducks/${id}`, { body }), field);
            assert.deepEqual((await allRows())[0], { id, ...redMedium, deleted: 0 });
        });
    }

    test('rejects malformed and out-of-range IDs with 400', async () => {
        for (const bad of ['0', '01', '-1', '1.5', 'abc', '1e3', '2147483648', '99999999999']) {
            const response = await api('PATCH', `/ducks/${bad}`, { body: { quantity: 1 } });
            assert.equal(response.status, 400, bad);
            assert.equal(response.body.error.code, 'VALIDATION_ERROR', bad);
        }
    });
});

describe('DELETE /api/ducks/:id', () => {
    test('soft-deletes: 204, hidden from the list, row kept with its quantity', async () => {
        const [id, otherId] = await insertDucks([redMedium, { ...redMedium, color: 'Green' }]);
        const response = await api('DELETE', `/ducks/${id}`);
        assert.equal(response.status, 204);
        assert.equal(response.text, '');
        assert.deepEqual(
            (await api('GET', '/ducks')).body.map((duck: { id: number }) => duck.id),
            [otherId]
        );
        assert.deepEqual((await allRows())[0], { id, ...redMedium, deleted: 1 });
    });

    test('is harmless to repeat', async () => {
        const [id] = await insertDucks([redMedium]);
        assert.equal((await api('DELETE', `/ducks/${id}`)).status, 204);
        assert.equal((await api('DELETE', `/ducks/${id}`)).status, 204);
    });

    test('returns 404 for unknown IDs and 400 for malformed ones', async () => {
        assert.equal((await api('DELETE', '/ducks/42')).status, 404);
        assert.equal((await api('DELETE', '/ducks/abc')).status, 400);
        assert.equal((await api('DELETE', '/ducks/0')).status, 400);
    });
});
