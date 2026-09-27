import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import mysql, { type Connection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? 'mysql://duckstore:duckstore@127.0.0.1:3307/duckstore_test';

// Tests erase this database, so never let them point at a real one.
const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!databaseName.endsWith('_test')) {
    throw new Error(`Refusing to use database "${databaseName}": the test database name must end in _test because tests erase it.`);
}

export interface DuckRow {
    id: number;
    color: string;
    size: string;
    price: string;
    quantity: number;
    deleted: number;
}

async function withConnection<T>(work: (connection: Connection) => Promise<T>): Promise<T> {
    let connection: Connection | undefined;
    try {
        connection = await mysql.createConnection({ uri: testDatabaseUrl, decimalNumbers: false });
        return await work(connection);
    } catch (error) {
        const code = (error as { code?: string }).code;
        if (
            code === 'ECONNREFUSED' ||
            code === 'ER_BAD_DB_ERROR' ||
            code === 'ER_DBACCESS_DENIED_ERROR' ||
            code === 'ER_ACCESS_DENIED_ERROR'
        ) {
            throw new Error(`Cannot use the test database (${code}). See readme.md: API and browser tests for setup instructions.`, {
                cause: error,
            });
        }
        throw error;
    } finally {
        await connection?.end();
    }
}

/** Drops and recreates the table from server/db/schema.sql, so tests always run against the current schema. */
export async function recreateSchema() {
    const schema = await readFile(new URL('../../server/db/schema.sql', import.meta.url), 'utf8');
    await withConnection(async (connection) => {
        await connection.query('DROP TABLE IF EXISTS ducks');
        await connection.query(schema);
    });
}

/** Removes every duck and resets AUTO_INCREMENT, so IDs start at 1. */
export async function clearDucks() {
    await withConnection((connection) => connection.query('TRUNCATE TABLE ducks'));
}

export async function dropDucksTable() {
    await withConnection((connection) => connection.query('DROP TABLE IF EXISTS ducks'));
}

/** Inserts rows directly, bypassing the API, for states the API cannot create in one step (such as deleted ducks). */
export async function insertDucks(ducks: { color: string; size: string; price: string; quantity: number; deleted?: boolean }[]) {
    return withConnection(async (connection) => {
        const ids: number[] = [];
        for (const duck of ducks) {
            const [result] = await connection.execute<ResultSetHeader>(
                'INSERT INTO ducks (color, size, price, quantity, deleted) VALUES (?, ?, ?, ?, ?)',
                [duck.color, duck.size, duck.price, duck.quantity, duck.deleted ?? false]
            );
            ids.push(result.insertId);
        }
        return ids;
    });
}

/** Every row, including deleted ones, ordered by ID. */
export async function allRows(): Promise<DuckRow[]> {
    return withConnection(async (connection) => {
        const [rows] = await connection.query<(DuckRow & RowDataPacket)[]>(
            'SELECT id, color, size, price, quantity, deleted FROM ducks ORDER BY id'
        );
        return rows.map((row) => ({ ...row }));
    });
}

/** The ducks from the specification mockup, in mockup ID order. */
export const mockupDucks = [
    { color: 'Red', size: 'Large', price: '20.00', quantity: 1800 },
    { color: 'Green', size: 'Large', price: '20.00', quantity: 2000 },
    { color: 'Yellow', size: 'Medium', price: '15.00', quantity: 800 },
    { color: 'Black', size: 'Medium', price: '15.00', quantity: 950 },
    { color: 'Green', size: 'Small', price: '10.00', quantity: 600 },
    { color: 'Yellow', size: 'XLarge', price: '25.00', quantity: 5000 },
    { color: 'Red', size: 'XSmall', price: '8.00', quantity: 300 },
];
