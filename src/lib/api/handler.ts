import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { authenticate, type ApiKeyContext } from './auth';
import { ApiError, toErrorResponse } from './errors';
import { canonicalJson, readIdempotencyKey, withIdempotency } from './idempotency';
import { IdParamSchema } from './schemas';
import type { ApiScope } from './scopes';

type Db = ReturnType<typeof getSupabaseAdmin>;
type Scope = ApiScope | readonly ApiScope[];
type RouteCtx = { params: Promise<{ id: string }> };
// Next pasa SIEMPRE el contexto; en una ruta sin [id] sus params vienen vacíos.
type AnyRouteCtx = { params: Promise<Record<string, string | string[]>> };

export interface ApiCall<P> {
    req: Request;
    key: ApiKeyContext;
    db: Db;
    params: P;
}

/** Valida query string, params de ruta o cuerpo; un error sale como `400 validation_error` con el detalle por campo. */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        const flat = parsed.error.flatten();
        throw new ApiError('validation_error', 'Parámetros inválidos.', {
            fields: flat.fieldErrors,
            ...(flat.formErrors.length ? { errors: flat.formErrors } : {}),
        });
    }
    return parsed.data;
}

function queryObject(req: Request): Record<string, string> {
    return Object.fromEntries(new URL(req.url).searchParams.entries());
}

/** GET de listado: auth con scope → valida query → responde `{ data, next_cursor }`. */
export function listRoute<S extends z.ZodTypeAny>(
    scope: Scope,
    querySchema: S,
    run: (call: ApiCall<z.infer<S>>) => Promise<unknown>,
) {
    return async function GET(req: Request): Promise<NextResponse> {
        try {
            const key = await authenticate(req, scope);
            const params = parseOrThrow(querySchema, queryObject(req));
            return NextResponse.json(await run({ req, key, db: getSupabaseAdmin(), params }));
        } catch (e) {
            return toErrorResponse(e);
        }
    };
}

/** GET de detalle `/{id}`: auth con scope → valida el uuid → responde el recurso. */
export function detailRoute(
    scope: Scope,
    run: (call: ApiCall<{ id: string }>) => Promise<unknown>,
) {
    return async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
        try {
            const key = await authenticate(req, scope);
            const params = parseOrThrow(IdParamSchema, await ctx.params);
            return NextResponse.json(await run({ req, key, db: getSupabaseAdmin(), params }));
        } catch (e) {
            return toErrorResponse(e);
        }
    };
}

export interface WriteCall<B> extends ApiCall<{ id?: string }> {
    body: B;
}

/**
 * POST/PATCH: auth con scope → `Idempotency-Key` obligatorio → cuerpo JSON
 * validado → se ejecuta una sola vez por llave. `run` devuelve el status de
 * éxito (201 creado / 200 ya existía o editado) y el cuerpo.
 */
export function writeRoute<S extends z.ZodTypeAny>(
    scope: Scope,
    bodySchema: S,
    run: (call: WriteCall<z.infer<S>>) => Promise<{ status: number; body: unknown }>,
    opts: { idParam?: boolean } = {},
) {
    return async function handler(req: Request, ctx: AnyRouteCtx): Promise<NextResponse> {
        try {
            const key = await authenticate(req, scope);
            const idemKey = readIdempotencyKey(req);
            const params: { id?: string } = opts.idParam ? parseOrThrow(IdParamSchema, await ctx.params) : {};

            let raw: unknown;
            try {
                raw = await req.json();
            } catch {
                throw new ApiError('validation_error', 'El cuerpo debe ser JSON válido.');
            }

            const db = getSupabaseAdmin();
            const url = new URL(req.url);
            const fingerprint = `${req.method} ${url.pathname}\n${canonicalJson(raw)}`;
            const result = await withIdempotency(db, key.apiKeyId, idemKey, fingerprint, () =>
                run({ req, key, db, params, body: parseOrThrow(bodySchema, raw) }),
            );
            return NextResponse.json(result.body, {
                status: result.status,
                headers: result.replayed ? { 'Idempotent-Replayed': 'true' } : undefined,
            });
        } catch (e) {
            return toErrorResponse(e);
        }
    };
}
