import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { authenticate, type ApiKeyContext } from './auth';
import { ApiError, toErrorResponse } from './errors';
import { IdParamSchema } from './schemas';
import type { ApiScope } from './scopes';

type Db = ReturnType<typeof getSupabaseAdmin>;

export interface ApiCall<P> {
    req: Request;
    key: ApiKeyContext;
    db: Db;
    params: P;
}

/** Valida query string o params de ruta; un error sale como `400 validation_error` con el detalle por campo. */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        throw new ApiError('validation_error', 'Parámetros inválidos.', {
            fields: parsed.error.flatten().fieldErrors,
        });
    }
    return parsed.data;
}

function queryObject(req: Request): Record<string, string> {
    return Object.fromEntries(new URL(req.url).searchParams.entries());
}

/** GET de listado: auth con scope → valida query → responde `{ data, next_cursor }`. */
export function listRoute<S extends z.ZodTypeAny>(
    scope: ApiScope,
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
    scope: ApiScope,
    run: (call: ApiCall<{ id: string }>) => Promise<unknown>,
) {
    return async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
        try {
            const key = await authenticate(req, scope);
            const params = parseOrThrow(IdParamSchema, await ctx.params);
            return NextResponse.json(await run({ req, key, db: getSupabaseAdmin(), params }));
        } catch (e) {
            return toErrorResponse(e);
        }
    };
}
