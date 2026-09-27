import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type RequestHandler } from 'express';
import { createPool, waitForDatabase } from './db.js';
import { duckRepository } from './ducks.js';
import { AppError, errorHandler, unsupportedMediaType } from './errors.js';
import { calculateOrder } from './pricing.js';
import { addDuckSchema, editDuckSchema, idSchema, orderSchema } from './validation.js';

const port = Number(process.env.PORT ?? 3001);
const pool = createPool();
const ducks = duckRepository(pool);
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
// express.json() skips other content types, which would otherwise surface as a confusing "missing body" validation error.
const requireJson: RequestHandler = (req, _res, next) => next(req.is('application/json') ? undefined : unsupportedMediaType());

app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
});

app.get('/api/ducks', async (_req, res) => {
    res.json(await ducks.list());
});

app.post('/api/ducks', requireJson, async (req, res) => {
    const { duck, created } = await ducks.add(addDuckSchema.parse(req.body));
    res.status(created ? 201 : 200).json(duck);
});

app.patch('/api/ducks/:id', requireJson, async (req, res) => {
    res.json(await ducks.edit(idSchema.parse(req.params.id), editDuckSchema.parse(req.body)));
});

app.delete('/api/ducks/:id', async (req, res) => {
    await ducks.delete(idSchema.parse(req.params.id));
    res.status(204).end();
});

app.post('/api/orders', requireJson, async (req, res) => {
    const input = orderSchema.parse(req.body);
    const price = await ducks.resolvePrice(input.color, input.size);
    res.json(calculateOrder(input, price));
});

app.use('/api', (_req, _res, next) => next(new AppError(404, 'ROUTE_NOT_FOUND', 'API route not found.')));

// In development, Vite serves the client and proxies /api here.
if (process.env.NODE_ENV === 'production') {
    const client = resolve(import.meta.dirname, '../../client');
    if (!existsSync(resolve(client, 'index.html'))) throw new Error('Run npm run build before npm start.');
    app.use(express.static(client));
}

app.use(errorHandler);

try {
    await waitForDatabase(pool);
    await pool.query('SELECT id FROM ducks LIMIT 1');
} catch (error) {
    console.error('Unable to start. Check DATABASE_URL, start MySQL, and run npm run db:setup.', error);
    await pool.end();
    process.exit(1);
}

const server = app.listen(port, '127.0.0.1', (error) => {
    if (error) throw error;
    console.log(`Duck Store API: http://localhost:${port}`);
});

const shutdown = () =>
    server.close(() => {
        void pool.end().then(() => process.exit(0));
    });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
