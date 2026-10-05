import { NextResponse } from 'next/server';

// Formato único de error de la API pública v1:
//   { "error": { "code": "...", "message": "...", "details": { } } }

export type ApiErrorCode =
    | 'validation_error'
    | 'unauthorized'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'idempotency_conflict'
    | 'rate_limited'
    | 'internal_error';

const STATUS: Record<ApiErrorCode, number> = {
    validation_error: 400,
    unauthorized: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    idempotency_conflict: 409,
    rate_limited: 429,
    internal_error: 500,
};

export class ApiError extends Error {
    readonly status: number;
    constructor(
        readonly code: ApiErrorCode,
        message: string,
        readonly details?: Record<string, unknown>,
        readonly headers?: Record<string, string>,
    ) {
        super(message);
        this.status = STATUS[code];
    }
}

export function errorResponse(err: ApiError): NextResponse {
    return NextResponse.json(
        { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
        { status: err.status, headers: err.headers },
    );
}

/** Convierte cualquier excepción en la respuesta estándar. Lo inesperado se registra y sale como 500 sin detalles internos. */
export function toErrorResponse(e: unknown): NextResponse {
    if (e instanceof ApiError) return errorResponse(e);
    console.error('[api/v1] error inesperado:', e);
    return errorResponse(new ApiError('internal_error', 'Error interno del servidor.'));
}
