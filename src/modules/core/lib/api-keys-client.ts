/**
 * Generación de API keys de la API pública v1 en el navegador. Igual que los
 * tokens del MCP: el texto plano se genera acá y se muestra UNA vez; a la base
 * sólo viajan el SHA-256 y un prefijo corto para reconocerla en la lista.
 *
 * Formato: `pk_live_` (producción) o `pk_test_` + 64 hex. `src/lib/api/auth.ts`
 * rechaza cualquier otra forma sin consultar la base.
 */

export interface GeneratedApiKey {
    /** Texto plano completo — mostrar UNA vez. */
    raw: string;
    /** Primeros caracteres, para la lista. */
    prefix: string;
    /** SHA-256 hex — lo único que se guarda. */
    hash: string;
}

function toHex(buf: ArrayBuffer): string {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
    const env = process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' ? 'live' : 'test';
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const raw = `pk_${env}_${toHex(bytes.buffer)}`;
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return { raw, prefix: raw.slice(0, 16), hash: toHex(hashBuf) };
}
