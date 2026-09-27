import { readFile } from 'node:fs/promises';
import { createPool, waitForDatabase } from '../src/db.js';

const pool = createPool();
try {
    await waitForDatabase(pool);
    await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    console.log('Duck Store schema is ready. Existing inventory was preserved.');
} finally {
    await pool.end();
}
