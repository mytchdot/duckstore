import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Duck } from '../../shared/contracts';
import { saveDuckChanges } from '../src/duckEdits';

const original: Duck = { id: 7, color: 'Red', size: 'XSmall', price: '8.00', quantity: 300, deleted: false };

test('changing only price omits stale quantity from the PATCH request', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ ...original, price: '8.50', quantity: 325 }));
    assert.equal(await saveDuckChanges(original, '8.50', 300), true);
    assert.equal(fetch.mock.callCount(), 1);
    const [url, options] = fetch.mock.calls[0].arguments;
    assert.equal(url, '/api/ducks/7');
    assert.equal(options?.method, 'PATCH');
    assert.deepEqual(JSON.parse(String(options?.body)), { price: '8.50' });
});

test('changing only quantity omits price, including numerically equivalent price input', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ ...original, price: '9.00', quantity: 0 }));
    assert.equal(await saveDuckChanges(original, '8', 0), true);
    assert.deepEqual(JSON.parse(String(fetch.mock.calls[0].arguments[1]?.body)), { quantity: 0 });
});

test('changing both fields submits both while preserving the entered price string', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ ...original, price: '10.00', quantity: 400 }));
    assert.equal(await saveDuckChanges(original, '10', 400), true);
    assert.deepEqual(JSON.parse(String(fetch.mock.calls[0].arguments[1]?.body)), { price: '10', quantity: 400 });
});

test('unchanged or numerically equivalent inputs send no request', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('An unchanged edit must not make a request');
    });
    for (const price of ['8.00', '8', '8.0']) {
        assert.equal(await saveDuckChanges(original, price, 300), false);
    }
    assert.equal(fetch.mock.callCount(), 0);
});
