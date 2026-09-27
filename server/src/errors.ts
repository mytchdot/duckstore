import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ErrorResponse } from '../../shared/contracts.js';

export class AppError extends Error {
    constructor(
        public status: number,
        public code: string,
        message: string
    ) {
        super(message);
    }
}

export function databaseError(error: unknown): never {
    const code = (error as { code?: string }).code;

    if (code === 'ER_DUP_ENTRY') {
        throw new AppError(409, 'DUCK_ALREADY_EXISTS', 'Another duck already has that color, size, and price.');
    }

    if (code === 'ER_WARN_DATA_OUT_OF_RANGE' || code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
        throw new AppError(409, 'QUANTITY_LIMIT_EXCEEDED', 'The combined quantity exceeds 2,147,483,647. No changes were saved.');
    }

    if (code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT') {
        throw new AppError(
            409,
            'CONCURRENT_MODIFICATION',
            'Another request changed this inventory. Review the latest inventory and try again.'
        );
    }

    throw error;
}

export const unsupportedMediaType = () =>
    new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request body as UTF-8 JSON with Content-Type: application/json.');

function toAppError(error: unknown): AppError | null {
    if (error instanceof AppError) return error;
    const { type, status } = (error ?? {}) as { type?: string; status?: unknown };
    if (type === 'entity.parse.failed') return new AppError(400, 'INVALID_JSON', 'The request body must be valid JSON.');
    if (type === 'entity.too.large') return new AppError(413, 'BODY_TOO_LARGE', 'The request body is too large.');
    if (status === 415) return unsupportedMediaType();
    // Other client errors raised by Express and its body parser, such as malformed URL encoding or a corrupt gzip body.
    if (typeof status === 'number' && status >= 400 && status < 500) {
        return new AppError(status, 'BAD_REQUEST', 'The request could not be read.');
    }
    return null;
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof ZodError) {
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of error.issues) {
            const key = issue.path.join('.') || '_form';
            fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
        }
        res.status(400).json({
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Check the supplied fields.',
                fieldErrors,
            },
        } satisfies ErrorResponse);
        return;
    }
    const appError = toAppError(error);
    if (appError) {
        res.status(appError.status).json({ error: { code: appError.code, message: appError.message } } satisfies ErrorResponse);
        return;
    }
    console.error(error);
    res.status(500).json({
        error: {
            code: 'INTERNAL_ERROR',
            message: 'The request could not be completed.',
        },
    } satisfies ErrorResponse);
};
