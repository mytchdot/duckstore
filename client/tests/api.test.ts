import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddDuckInput, Duck } from '../../shared/contracts';
import { ApiError, addDuck, deleteDuck, editDuck, listDucks } from '../src/api';

const input = { color: 'Red', size: 'Medium', price: '10.00', quantity: 3 } satisfies AddDuckInput;
const duck: Duck = { id: 1, ...input, deleted: false };
const unconfirmed = (error: unknown) =>
    error instanceof ApiError && error.message.startsWith('We couldn’t confirm whether your change was saved');

test('a lost connection during a change is reported as unconfirmed and never retried', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
        throw new TypeError('Connection closed');
    });
    await assert.rejects(addDuck(input), unconfirmed);
    await assert.rejects(editDuck(duck.id, { quantity: 5 }), unconfirmed);
    await assert.rejects(deleteDuck(duck.id), unconfirmed);
    assert.equal(fetch.mock.callCount(), 3);
});

test('an unreadable successful response to a change is also unconfirmed', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('{', { status: 201 }));
    await assert.rejects(addDuck(input), unconfirmed);
});

test('a failed inventory load does not mention a change', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
        throw new TypeError('Connection closed');
    });
    await assert.rejects(listDucks(), { message: 'Unable to load inventory. Check your connection and try again.' });
});

test('server errors keep their message and field errors', async (t) => {
    const fieldErrors = { price: ['Price must be greater than zero.'] };
    t.mock.method(globalThis, 'fetch', async () =>
        Response.json({ error: { code: 'VALIDATION_ERROR', message: 'Check the supplied fields.', fieldErrors } }, { status: 400 })
    );
    await assert.rejects(addDuck(input), (error: unknown) => {
        assert(error instanceof ApiError);
        assert.equal(error.message, 'Check the supplied fields.');
        assert.deepEqual(error.fieldErrors, fieldErrors);
        return true;
    });
});

test('an unreadable error response falls back to a generic message', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status: 503 }));
    await assert.rejects(addDuck(input), { message: 'The request could not be completed.' });
});

test('Add distinguishes a created duck (201) from a merged one (200)', async (t) => {
    const merged = { ...duck, quantity: 6 };
    const responses = [Response.json(duck, { status: 201 }), Response.json(merged, { status: 200 })];
    t.mock.method(globalThis, 'fetch', async () => responses.shift() as Response);
    assert.deepEqual(await addDuck(input), { duck, created: true });
    assert.deepEqual(await addDuck(input), { duck: merged, created: false });
});

test('Delete accepts an empty 204 without reading JSON', async (t) => {
    const response = new Response(null, { status: 204 });
    const json = t.mock.method(response, 'json');
    t.mock.method(globalThis, 'fetch', async () => response);
    await deleteDuck(duck.id);
    assert.equal(json.mock.callCount(), 0);
});
