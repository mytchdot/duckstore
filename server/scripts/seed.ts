import { createPool, waitForDatabase } from '../src/db.js';

// Listed in mockup ID order, so a fresh database matches the mockup. Existing rows, including deleted ones, are left untouched.
const demoDucks = [
    ['Red', 'Large', '20.00', 1800],
    ['Green', 'Large', '20.00', 2000],
    ['Yellow', 'Medium', '15.00', 800],
    ['Black', 'Medium', '15.00', 950],
    ['Green', 'Small', '10.00', 600],
    ['Yellow', 'XLarge', '25.00', 5000],
    ['Red', 'XSmall', '8.00', 300],
];

const pool = createPool();
try {
    await waitForDatabase(pool);
    await pool.query('INSERT INTO ducks (color, size, price, quantity) VALUES ? ON DUPLICATE KEY UPDATE id = id', [demoDucks]);
    console.log('Demo ducks added where no active duck matched. Existing stock was preserved.');
} finally {
    await pool.end();
}
