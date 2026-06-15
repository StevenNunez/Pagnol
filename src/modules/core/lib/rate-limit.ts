import { getSupabaseAdmin } from '@/modules/core/lib/supabase';

/** Extrae la IP del cliente desde los headers (Vercel fija x-forwarded-for). */
export function getClientIp(req: Request): string {
    return (
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        'unknown'
    );
}

/**
 * Rate limit respaldado por Postgres. Devuelve `true` si la petición está
 * permitida, `false` si superó `max` peticiones en `windowSeconds`.
 *
 * Falla ABIERTO (devuelve true) si el limitador no está disponible, para no
 * tumbar el servicio si la BD/función falla.
 */
export async function checkRateLimit(
    key: string,
    max: number,
    windowSeconds: number
): Promise<boolean> {
    try {
        const admin = getSupabaseAdmin();
        const { data, error } = await admin.rpc('check_rate_limit', {
            p_key: key,
            p_max: max,
            p_window_seconds: windowSeconds,
        });
        if (error) {
            console.error('[rate-limit] rpc error:', error.message);
            return true; // fail-open
        }
        return data === true;
    } catch (e: any) {
        console.error('[rate-limit] error:', e?.message);
        return true; // fail-open
    }
}

/** Helper combinado: arma la key con IP + endpoint y evalúa el límite. */
export async function rateLimitByIp(
    req: Request,
    endpoint: string,
    max: number,
    windowSeconds: number
): Promise<boolean> {
    return checkRateLimit(`${endpoint}:${getClientIp(req)}`, max, windowSeconds);
}
