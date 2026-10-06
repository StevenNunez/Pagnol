import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './errors';

// Idempotencia de las escrituras (contrato §3): el cliente manda
// `Idempotency-Key: <uuid>` y, durante 24 h, repetir la misma llave con el
// mismo cuerpo devuelve la MISMA respuesta sin volver a ejecutar nada. Con otro
// cuerpo → 409 idempotency_conflict. Sólo se guardan los éxitos: un error
// (validación, un pañol que aún no existe, una caída) libera la llave y el
// reintento se vuelve a evaluar, en vez de repetir el error durante 24 h.
//
// Es la red para reintentos de red. La `external_ref` única de cada activo o
// movimiento es la segunda red: aunque el cliente pierda la llave, la misma
// referencia nunca duplica.

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoredResponse {
    status: number;
    body: unknown;
}

/** JSON con las claves ordenadas: el mismo cuerpo con otro orden de campos es el mismo cuerpo. */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const entries = Object.keys(value as Record<string, unknown>).sort()
            .filter(k => (value as Record<string, unknown>)[k] !== undefined)
            .map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

async function sha256Hex(text: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function readIdempotencyKey(req: Request): string {
    const key = req.headers.get('idempotency-key')?.trim();
    if (!key) throw new ApiError('validation_error', 'Falta el header `Idempotency-Key` (uuid), obligatorio en toda escritura.');
    if (!UUID_RE.test(key)) throw new ApiError('validation_error', 'El header `Idempotency-Key` debe ser un uuid.');
    return key.toLowerCase();
}

/**
 * Ejecuta `exec` una sola vez por (llave de API, Idempotency-Key). Devuelve la
 * respuesta guardada si ya se ejecutó con el mismo cuerpo.
 */
export async function withIdempotency(
    db: SupabaseClient,
    apiKeyId: string,
    idemKey: string,
    fingerprint: string,
    exec: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
    const requestHash = await sha256Hex(fingerprint);

    const { data: prev, error: selErr } = await db.from('idempotency_keys')
        .select('request_hash, response_status, response_body, created_at')
        .eq('api_key_id', apiKeyId).eq('key', idemKey)
        .maybeSingle();
    if (selErr) throw selErr;

    if (prev && Date.now() - Date.parse(prev.created_at) > IDEMPOTENCY_TTL_MS) {
        // Vencida: se libera la llave y se trata como nueva.
        await db.from('idempotency_keys').delete().eq('api_key_id', apiKeyId).eq('key', idemKey);
    } else if (prev) {
        if (prev.request_hash !== requestHash) {
            throw new ApiError('idempotency_conflict', 'Esta Idempotency-Key ya se usó con otro cuerpo de petición.');
        }
        if (prev.response_status === null) {
            throw new ApiError('conflict', 'La petición original con esta Idempotency-Key sigue en curso. Reintenta en unos segundos.');
        }
        return { status: prev.response_status, body: prev.response_body, replayed: true };
    }

    // Se reserva la llave ANTES de ejecutar: dos peticiones simultáneas con la
    // misma llave no pueden ejecutar las dos.
    const { error: insErr } = await db.from('idempotency_keys')
        .insert({ api_key_id: apiKeyId, key: idemKey, request_hash: requestHash });
    if (insErr) {
        if ((insErr as { code?: string }).code === '23505') {
            throw new ApiError('conflict', 'La petición original con esta Idempotency-Key sigue en curso. Reintenta en unos segundos.');
        }
        throw insErr;
    }

    const release = () => db.from('idempotency_keys').delete().eq('api_key_id', apiKeyId).eq('key', idemKey);
    let result: StoredResponse;
    try {
        result = await exec();
    } catch (e) {
        await release();
        throw e;
    }

    const { error: updErr } = await db.from('idempotency_keys')
        .update({ response_status: result.status, response_body: result.body })
        .eq('api_key_id', apiKeyId).eq('key', idemKey);
    if (updErr) throw updErr;

    // Limpieza ocasional de llaves vencidas, después de responder.
    if (Math.random() < 0.02) {
        after(async () => {
            await db.from('idempotency_keys').delete().lt('created_at', new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString());
        });
    }

    return { ...result, replayed: false };
}
