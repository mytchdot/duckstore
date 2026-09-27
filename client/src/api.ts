import type { AddDuckInput, Duck, EditDuckInput, ErrorResponse } from '../../shared/contracts';

export class ApiError extends Error {
    constructor(
        message: string,
        public fieldErrors?: Record<string, string[]>
    ) {
        super(message);
    }
}

async function send<T>(path: string, options?: RequestInit): Promise<{ data: T; status: number }> {
    try {
        const response = await fetch(`/api${path}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...options?.headers },
        });
        if (!response.ok) {
            const body = (await response.json().catch(() => null)) as ErrorResponse | null;
            throw new ApiError(body?.error?.message ?? 'The request could not be completed.', body?.error?.fieldErrors);
        }
        // Reading the body can fail even after fetch has received successful response headers.
        const data = (response.status === 204 ? undefined : await response.json()) as T;
        return { data, status: response.status };
    } catch (error) {
        if (error instanceof ApiError) throw error;
        // Never replay a change automatically: the server may have saved it before the response was lost.
        throw new ApiError(
            options?.method
                ? 'We couldn’t confirm whether your change was saved. Refresh inventory before submitting again.'
                : 'Unable to load inventory. Check your connection and try again.'
        );
    }
}

export async function listDucks(): Promise<Duck[]> {
    return (await send<Duck[]>('/ducks')).data;
}

// The server merges a duck into an existing one with the same color, size, and price: 201 means created, 200 means merged.
export async function addDuck(body: AddDuckInput): Promise<{ duck: Duck; created: boolean }> {
    const response = await send<Duck>('/ducks', { method: 'POST', body: JSON.stringify(body) });
    return { duck: response.data, created: response.status === 201 };
}

export async function editDuck(id: number, body: EditDuckInput): Promise<Duck> {
    return (await send<Duck>(`/ducks/${id}`, { method: 'PATCH', body: JSON.stringify(body) })).data;
}

export async function deleteDuck(id: number): Promise<void> {
    await send<void>(`/ducks/${id}`, { method: 'DELETE' });
}
