import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { before, test } from 'node:test';
import { promisify } from 'node:util';
import { allRows, dropDucksTable, insertDucks, mockupDucks, recreateSchema } from '../support/database';
import { projectRoot, serverEnv } from '../support/server';

const run = promisify(execFile);
const script = (name: 'setup' | 'seed') =>
    run(process.execPath, ['--import', 'tsx', `server/scripts/${name}.ts`], { cwd: projectRoot, env: serverEnv({}) });

before(dropDucksTable);

test('db:setup creates the schema and is safe to repeat without touching inventory', async () => {
    await script('setup');
    await insertDucks([{ color: 'Red', size: 'Medium', price: '1.00', quantity: 3, deleted: true }]);
    const { stdout } = await script('setup');
    assert.match(stdout, /schema is ready/);
    assert.equal((await allRows()).length, 1);
});

test('db:seed on an empty database reproduces the mockup IDs', async () => {
    await recreateSchema();
    await script('seed');
    assert.deepEqual(
        (await allRows()).map(({ id, color, size, price, quantity }) => ({ id, color, size, price, quantity })),
        mockupDucks.map((duck, index) => ({ id: index + 1, ...duck }))
    );
});

test('db:seed never changes existing stock, and adds a demo duck again only if no active duck matches', async () => {
    await recreateSchema();
    await script('seed');
    await insertDucks([{ color: 'Black', size: 'XSmall', price: '1.00', quantity: 1 }]);
    const [first] = await allRows();
    await script('seed');
    let rows = await allRows();
    assert.equal(rows.length, 8);
    assert.deepEqual(rows[0], first);

    await recreateSchema();
    await insertDucks([{ ...mockupDucks[0], quantity: 1 }]);
    await insertDucks([{ ...mockupDucks[1], quantity: 7, deleted: true }]);
    await script('seed');
    rows = await allRows();
    assert.equal(rows.filter((row) => row.color === 'Red' && row.size === 'Large')[0].quantity, 1, 'active match kept its stock');
    const greenLarge = rows.filter((row) => row.color === 'Green' && row.size === 'Large');
    assert.deepEqual(
        greenLarge.map((row) => [row.quantity, row.deleted]),
        [
            [7, 1],
            [2000, 0],
        ],
        'the deleted row stays deleted and a fresh demo duck is added'
    );
});
