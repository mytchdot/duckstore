import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { AddDuckInput, Color, Duck, EditDuckInput, Size } from '../../shared/contracts.js';
import { AppError, databaseError } from './errors.js';

type DuckRow = RowDataPacket & Omit<Duck, 'deleted'> & { deleted: number };
const toDuck = (row: DuckRow): Duck => ({
    ...row,
    deleted: Boolean(row.deleted),
});
const notFound = () => new AppError(404, 'DUCK_NOT_FOUND', 'Duck not found.');
// Listed explicitly so the schema's generated uniqueness column never reaches API responses.
const duckColumns = 'id, color, size, price, quantity, deleted';

export function duckRepository(pool: Pool) {
    async function transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const result = await work(connection);
            await connection.commit();
            return result;
        } catch (error) {
            await connection.rollback();
            return databaseError(error);
        } finally {
            connection.release();
        }
    }

    return {
        async list(): Promise<Duck[]> {
            const [rows] = await pool.query<DuckRow[]>(
                `SELECT ${duckColumns} FROM ducks WHERE deleted = FALSE ORDER BY quantity DESC, id ASC`
            );
            return rows.map(toDuck);
        },

        async add(input: AddDuckInput): Promise<{ duck: Duck; created: boolean }> {
            return transaction(async (connection) => {
                // The unique index covers active ducks only, so this merges into an active match and never restores a deleted duck.
                // It also serializes matching additions, and strict SQL mode enforces the INT limit inside this statement.
                const [result] = await connection.execute<ResultSetHeader>(
                    `INSERT INTO ducks (color, size, price, quantity) VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), quantity = quantity + ?`,
                    [input.color, input.size, input.price, input.quantity, input.quantity]
                );
                const [rows] = await connection.execute<DuckRow[]>(`SELECT ${duckColumns} FROM ducks WHERE id = ?`, [result.insertId]);
                return { duck: toDuck(rows[0]), created: result.affectedRows === 1 };
            });
        },

        async edit(id: number, input: EditDuckInput): Promise<Duck> {
            return transaction(async (connection) => {
                const [rows] = await connection.execute<DuckRow[]>(
                    `SELECT ${duckColumns} FROM ducks WHERE id = ? AND deleted = FALSE FOR UPDATE`,
                    [id]
                );
                if (!rows.length) throw notFound();
                await connection.execute('UPDATE ducks SET price = ?, quantity = ? WHERE id = ?', [
                    input.price ?? rows[0].price,
                    input.quantity ?? rows[0].quantity,
                    id,
                ]);
                const [updated] = await connection.execute<DuckRow[]>(`SELECT ${duckColumns} FROM ducks WHERE id = ?`, [id]);
                return toDuck(updated[0]);
            });
        },

        async delete(id: number): Promise<void> {
            // mysql2 reports matched rows, so deleting an already-deleted duck still counts as found.
            const [result] = await pool.execute<ResultSetHeader>('UPDATE ducks SET deleted = TRUE WHERE id = ?', [id]);
            if (!result.affectedRows) throw notFound();
        },

        async resolvePrice(color: Color, size: Size): Promise<string> {
            const [rows] = await pool.execute<DuckRow[]>(
                'SELECT price FROM ducks WHERE color = ? AND size = ? AND deleted = FALSE LIMIT 2',
                [color, size]
            );
            if (!rows.length) throw notFound();
            if (rows.length > 1) {
                throw new AppError(
                    409,
                    'AMBIGUOUS_DUCK_PRICE',
                    'Multiple active ducks have this color and size at different prices. A single price is required to calculate the order.'
                );
            }
            return rows[0].price;
        },
    };
}
