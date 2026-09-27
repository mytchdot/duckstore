import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { allRows, clearDucks, insertDucks, recreateSchema } from '../support/database';
import { type RunningServer, request, startServer } from '../support/server';

const MAX_INT = 2_147_483_647;
let server: RunningServer;
const api = (method: string, path: string, body?: unknown) => request(server.url, method, `/api${path}`, { body });
const duck = { color: 'Black', size: 'Small', price: '7.00', quantity: 1 };
function statuses(responses: { status: number }[]) {
    const counts: Record<number, number> = {};
    for (const { status } of responses) counts[status] = (counts[status] ?? 0) + 1;
    return counts;
}

before(async () => {
    await recreateSchema();
    server = await startServer();
});
beforeEach(clearDucks);
after(async () => {
    await server?.stop();
    assert.doesNotMatch(server.output(), /Error/, 'the server logged an unexpected error');
});

test('simultaneous adds of the same new duck create it once and merge the rest', async () => {
    for (let round = 0; round < 3; round++) {
        await clearDucks();
        const responses = await Promise.all(Array.from({ length: 50 }, () => api('POST', '/ducks', duck)));
        assert.deepEqual(statuses(responses), { 200: 49, 201: 1 });
        const rows = await allRows();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].quantity, 50);
        assert.equal(new Set(responses.map((response) => response.body.id)).size, 1);
    }
});

test('simultaneous adds near the INT limit never overflow or lose an accepted unit', async () => {
    await insertDucks([{ ...duck, quantity: MAX_INT - 5 }]);
    const responses = await Promise.all(Array.from({ length: 12 }, () => api('POST', '/ducks', duck)));
    assert.deepEqual(statuses(responses), { 200: 5, 409: 7 });
    assert.equal((await allRows())[0].quantity, MAX_INT);
});

test('simultaneous edits to the same new price: exactly one wins', async () => {
    const ids = await insertDucks([
        { ...duck, price: '1.00' },
        { ...duck, price: '2.00' },
        { ...duck, price: '3.00' },
    ]);
    const responses = await Promise.all(ids.map((id) => api('PATCH', `/ducks/${id}`, { price: '9.00' })));
    assert.deepEqual(statuses(responses), { 200: 1, 409: 2 });
    assert.equal((await allRows()).filter((row) => row.price === '9.00').length, 1);
});

test('adds, edits, and deletes racing on one duck leave at most one active match and a consistent quantity', async () => {
    const [id] = await insertDucks([duck]);
    const responses = await Promise.all([
        ...Array.from({ length: 10 }, () => api('POST', '/ducks', duck)),
        api('DELETE', `/ducks/${id}`),
        ...Array.from({ length: 10 }, (_, i) => api('PATCH', `/ducks/${id}`, { quantity: 100 + i })),
        ...Array.from({ length: 10 }, () => api('POST', '/ducks', duck)),
    ]);
    for (const response of responses) assert.ok([200, 201, 204, 404].includes(response.status), response.text);
    const active = (await allRows()).filter((row) => !row.deleted);
    assert.ok(active.length <= 1);
    const adds = responses.filter((_response, index) => index < 10 || index >= 21);
    const addedToNewDuck = adds.filter((response) => response.body.id !== id).length;
    if (active.length === 1 && active[0].id !== id) assert.equal(active[0].quantity, addedToNewDuck);
});

test('simultaneous adds of different ducks all create separate rows', async () => {
    const colors = ['Red', 'Green', 'Yellow', 'Black'];
    const sizes = ['XLarge', 'Large', 'Medium', 'Small', 'XSmall'];
    const responses = await Promise.all(
        colors.flatMap((color) => sizes.map((size) => api('POST', '/ducks', { color, size, price: '5.00', quantity: 3 })))
    );
    assert.deepEqual(statuses(responses), { 201: 20 });
    assert.equal((await api('GET', '/ducks')).body.length, 20);
});
