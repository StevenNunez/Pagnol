import { supabase } from '@/modules/core/lib/supabase';

/**
 * Construye los headers para llamar a rutas API protegidas con `requireAuth`.
 * Adjunta el access token de la sesión Supabase actual como Bearer.
 */
export async function authHeaders(
    extra?: Record<string, string>
): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    return {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...extra,
    };
}

/**
 * Solo el header Authorization (sin Content-Type). Úsalo cuando el body es
 * FormData/multipart, donde el navegador debe fijar el Content-Type con boundary.
 */
export async function bearerHeader(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}
