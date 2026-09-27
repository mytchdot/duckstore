import 'dotenv/config';
import mysql from 'mysql2/promise';

export function createPool() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Set DATABASE_URL in .env (see .env.example).');
    const pool = mysql.createPool({
        uri: url,
        connectionLimit: 10,
        decimalNumbers: false,
    });
    // MySQL must reject overflow rather than clamp it, including on existing installations.
    pool.on('connection', (connection) => {
        connection.query("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'");
    });
    return pool;
}

export async function waitForDatabase(pool: mysql.Pool, attempts = 30) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await pool.query('SELECT 1');
            return;
        } catch (error) {
            if (attempt === attempts) throw error;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
}
