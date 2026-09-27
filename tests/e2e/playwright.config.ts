import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { testDatabaseUrl } from '../support/database';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const ports = { devApi: 3297, devWeb: 5297, production: 3298 };

// Both apps share the test database, so tests run one at a time and reset it before each test.
export default defineConfig({
    testDir: '.',
    outputDir: join(tmpdir(), 'duckstore-e2e'),
    fullyParallel: false,
    workers: 1,
    forbidOnly: true,
    reporter: 'list',
    use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
    projects: [
        // `npm run dev`: Vite with React StrictMode and development warnings, proxying /api to Express.
        { name: 'dev', use: { baseURL: `http://127.0.0.1:${ports.devWeb}` } },
        // `npm start`: the production build served by Express.
        { name: 'production', use: { baseURL: `http://127.0.0.1:${ports.production}` } },
    ],
    webServer: [
        {
            command: 'node --import tsx server/src/index.ts',
            cwd: projectRoot,
            env: { DATABASE_URL: testDatabaseUrl, PORT: String(ports.devApi), NODE_ENV: 'development' },
            url: `http://127.0.0.1:${ports.devApi}/api/health`,
        },
        {
            command: `npx vite --config client/vite.config.ts --port ${ports.devWeb}`,
            cwd: projectRoot,
            env: { PORT: String(ports.devApi), NODE_ENV: 'development' },
            url: `http://127.0.0.1:${ports.devWeb}`,
        },
        {
            command: 'node dist/server/src/index.js',
            cwd: projectRoot,
            env: { DATABASE_URL: testDatabaseUrl, PORT: String(ports.production), NODE_ENV: 'production' },
            url: `http://127.0.0.1:${ports.production}/api/health`,
        },
    ],
});
