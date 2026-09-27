import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { testDatabaseUrl } from './database';

export const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

export async function freePort(): Promise<number> {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    server.close();
    await once(server, 'close');
    return port;
}

/** Environment for a server child process. Drops variables from the test runner itself. */
export function serverEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testDatabaseUrl, ...overrides };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_ENV;
    return env;
}

export interface RunningServer {
    url: string;
    port: number;
    /** Everything the server has printed so far, stdout and stderr combined. */
    output: () => string;
    stop: () => Promise<void>;
}

/** Runs the real server source (server/src/index.ts) as a child process, the same way `npm run dev` does. */
export function launchServer(env: Record<string, string>) {
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
        cwd: projectRoot,
        env: serverEnv(env),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
        output += chunk;
    });
    child.stderr.on('data', (chunk) => {
        output += chunk;
    });
    const exited = once(child, 'exit').then(([code, signal]) => ({ code: code as number | null, signal: signal as string | null }));
    return { child, exited, output: () => output };
}

export async function startServer(): Promise<RunningServer> {
    const port = await freePort();
    const { child, exited, output } = launchServer({ PORT: String(port) });
    const url = `http://127.0.0.1:${port}`;
    let running = true;
    void exited.then(() => {
        running = false;
    });
    for (let attempt = 0; ; attempt++) {
        if (!running) throw new Error(`Server exited during startup:\n${output()}`);
        if (attempt > 150) throw new Error(`Server did not become healthy:\n${output()}`);
        try {
            if ((await fetch(`${url}/api/health`)).ok) break;
        } catch {
            // Not listening yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return {
        url,
        port,
        output,
        stop: async () => {
            if (!running) return;
            child.kill('SIGTERM');
            await exited;
        },
    };
}

export interface ApiResponse {
    status: number;
    headers: Headers;
    text: string;
    // biome-ignore lint/suspicious/noExplicitAny: response bodies are asserted field by field in tests.
    body: any;
}

/** Sends a request and parses the JSON response. `body` is JSON-encoded unless `raw` is given. */
export async function request(
    baseUrl: string,
    method: string,
    path: string,
    options: { body?: unknown; raw?: string | Uint8Array; headers?: Record<string, string> } = {}
): Promise<ApiResponse> {
    const hasBody = options.body !== undefined || options.raw !== undefined;
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
        body: (options.raw as BodyInit | undefined) ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text && response.headers.get('content-type')?.includes('application/json')) body = JSON.parse(text);
    return { status: response.status, headers: response.headers, text, body };
}
