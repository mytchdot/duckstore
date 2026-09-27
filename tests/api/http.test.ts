import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { allRows, clearDucks, dropDucksTable, insertDucks, recreateSchema } from '../support/database';
import { launchServer, type RunningServer, request, startServer } from '../support/server';

let server: RunningServer;
const api = (method: string, path: string, options?: Parameters<typeof request>[3]) => request(server.url, method, `/api${path}`, options);
const duck = { color: 'Red', size: 'Medium', price: '10.00', quantity: 5 };

before(async () => {
    await recreateSchema();
    server = await startServer();
});
beforeEach(clearDucks);
after(async () => {
    await server?.stop();
    assert.doesNotMatch(server.output(), /Error/, 'the server logged an unexpected error');
});

function assertError(response: Awaited<ReturnType<typeof api>>, status: number, code: string) {
    assert.equal(response.status, status, response.text);
    assert.equal(response.body?.error?.code, code, response.text);
    assert.equal(typeof response.body.error.message, 'string');
    assert.doesNotMatch(response.text, /\bat .+\.(ts|js):\d+/, 'no stack traces in responses');
}

describe('request bodies', () => {
    test('accepts JSON with an explicit UTF-8 charset, and non-ASCII text', async () => {
        const response = await api('POST', '/ducks', { body: duck, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
        assert.equal(response.status, 201);
        await insertDucks([{ ...duck, color: 'Green' }]);
        const orderResponse = await api('POST', '/orders', {
            body: { color: 'Green', size: 'Medium', quantity: 1, destinationCountry: 'Perú 🦆', shippingMode: 'Land' },
        });
        assert.equal(orderResponse.body.adjustments[1].description, 'Destination charge (Perú 🦆)');
    });

    test('accepts a gzip-compressed JSON body', async () => {
        const response = await api('POST', '/ducks', {
            raw: gzipSync(JSON.stringify(duck)),
            headers: { 'Content-Encoding': 'gzip' },
        });
        assert.equal(response.status, 201);
    });

    test('rejects malformed JSON with 400 INVALID_JSON', async () => {
        for (const raw of ['{bad', '{"color":', '"just a string"', '12']) {
            assertError(await api('POST', '/ducks', { raw }), 400, 'INVALID_JSON');
        }
    });

    test('rejects bodies over 16 KB with 413', async () => {
        assertError(await api('POST', '/ducks', { body: { ...duck, padding: 'x'.repeat(17_000) } }), 413, 'BODY_TOO_LARGE');
    });

    test('rejects non-JSON content types with 415, including JSON text sent as text/plain', async () => {
        for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'application/xml']) {
            const response = await api('POST', '/ducks', { raw: JSON.stringify(duck), headers: { 'Content-Type': contentType } });
            assertError(response, 415, 'UNSUPPORTED_MEDIA_TYPE');
        }
        assert.deepEqual(await allRows(), []);
    });

    test('rejects a PATCH with no body with 415', async () => {
        const [id] = await insertDucks([duck]);
        assertError(await api('PATCH', `/ducks/${id}`), 415, 'UNSUPPORTED_MEDIA_TYPE');
    });

    test('rejects unsupported charsets and encodings as client errors, not server errors', async () => {
        assertError(
            await api('POST', '/ducks', { raw: JSON.stringify(duck), headers: { 'Content-Type': 'application/json; charset=latin1' } }),
            415,
            'UNSUPPORTED_MEDIA_TYPE'
        );
        assertError(
            await api('POST', '/ducks', { raw: JSON.stringify(duck), headers: { 'Content-Encoding': 'compress' } }),
            415,
            'UNSUPPORTED_MEDIA_TYPE'
        );
        assertError(await api('POST', '/ducks', { raw: 'not gzip', headers: { 'Content-Encoding': 'gzip' } }), 400, 'BAD_REQUEST');
    });
});

describe('routes and URLs', () => {
    test('health check reports ok', async () => {
        const response = await api('GET', '/health');
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { status: 'ok' });
    });

    test('unknown API routes and methods return 404 ROUTE_NOT_FOUND', async () => {
        for (const [method, path] of [
            ['GET', '/nope'],
            ['GET', '/ducks/1'],
            ['PUT', '/ducks/1'],
            ['POST', '/ducks/1'],
            ['GET', '/orders'],
            ['DELETE', '/ducks'],
        ]) {
            assertError(await api(method, path), 404, 'ROUTE_NOT_FOUND');
        }
    });

    test('malformed percent-encoding in an ID is a 400, not a server error', async () => {
        assertError(await api('PATCH', '/ducks/%E0%A4%A', { body: { quantity: 1 } }), 400, 'BAD_REQUEST');
        assertError(await api('DELETE', '/ducks/%ZZ'), 400, 'BAD_REQUEST');
    });

    test('tolerates a trailing slash and percent-encoded digits', async () => {
        const [id] = await insertDucks([duck]);
        assert.equal((await api('GET', '/ducks/')).status, 200);
        assert.equal((await api('PATCH', `/ducks/%3${id}`, { body: { quantity: 2 } })).status, 200);
    });

    test('does not serve the client outside production', async () => {
        const response = await request(server.url, 'GET', '/');
        assert.equal(response.status, 404);
    });
});

describe('server startup', () => {
    async function expectStartupFailure(env: Record<string, string>, message: RegExp) {
        const { exited, output } = launchServer(env);
        const { code } = await exited;
        assert.notEqual(code, 0, output());
        assert.match(output(), message);
    }

    test('exits with a clear message when DATABASE_URL is missing', async () => {
        await expectStartupFailure({ DATABASE_URL: '', PORT: '0' }, /Set DATABASE_URL/);
    });

    test('exits with a clear message when the schema is missing', async () => {
        await dropDucksTable();
        try {
            await expectStartupFailure({ PORT: '0' }, /run npm run db:setup/);
        } finally {
            await recreateSchema();
        }
    });

    test('exits when the port is already in use', async () => {
        await expectStartupFailure({ PORT: String(server.port) }, /EADDRINUSE/);
    });
});
