import { after } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { checkRateLimit } from '@/modules/core/lib/rate-limit';
import { ApiError } from './errors';
import type { ApiScope } from './scopes';

// Peticiones permitidas por llave en cada ventana.
export const RATE_LIMIT_MAX = 600;
export const RATE_LIMIT_WINDOW_SECONDS = 60;

export interface ApiKeyContext {
    apiKeyId: string;
    /** Nombre de la llave: queda como autor en el kardex ("API: <nombre>"). */
    name: string;
    /** Empresa dueña de la llave. TODA consulta se filtra por este valor. */
    tenantId: string;
    scopes: string[];
}

async function sha256Hex(text: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const KEY_RE = /^pk_(live|test)_[0-9a-f]{64}$/;

/**
 * Valida `Authorization: Bearer pk_...`, resuelve la empresa y exige el scope
 * (con una lista, basta cualquiera de ellos). 401 si falta la llave, no existe
 * o está revocada; 403 si no tiene el scope; 429 si superó el límite.
 */
export async function authenticate(req: Request, scope: ApiScope | readonly ApiScope[]): Promise<ApiKeyContext> {
    const accepted: readonly ApiScope[] = typeof scope === 'string' ? [scope] : scope;
    const header = req.headers.get('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match) throw new ApiError('unauthorized', 'Falta la API key (header `Authorization: Bearer <key>`).');

    const raw = match[1];
    // Un formato imposible no merece una consulta a la base.
    if (!KEY_RE.test(raw)) throw new ApiError('unauthorized', 'API key inválida.');

    const admin = getSupabaseAdmin();
    const { data: key, error } = await admin
        .from('api_keys')
        .select('id, tenant_id, name, scopes, revoked_at, last_used_at')
        .eq('key_hash', await sha256Hex(raw))
        .maybeSingle();
    if (error) throw error;
    if (!key || key.revoked_at) throw new ApiError('unauthorized', 'API key inválida o revocada.');

    const scopes: string[] = key.scopes ?? [];
    if (!accepted.some(s => scopes.includes(s))) {
        const label = accepted.map(s => `\`${s}\``).join(' o ');
        throw new ApiError('forbidden', `La API key no tiene el scope ${label}.`, { required_scope: accepted.join(' | ') });
    }

    const allowed = await checkRateLimit(`api_v1:${key.id}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS);
    if (!allowed) {
        throw new ApiError(
            'rate_limited',
            'Se superó el límite de peticiones. Reintenta más tarde.',
            undefined,
            { 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) },
        );
    }

    // `last_used_at` se escribe después de responder y como mucho una vez por
    // minuto: sin ese freno, cada GET haría una escritura extra.
    const lastUsed = key.last_used_at ? Date.parse(key.last_used_at) : 0;
    if (Date.now() - lastUsed > 60_000) {
        after(async () => {
            await admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', key.id);
        });
    }

    return { apiKeyId: key.id, name: key.name, tenantId: key.tenant_id, scopes };
}
