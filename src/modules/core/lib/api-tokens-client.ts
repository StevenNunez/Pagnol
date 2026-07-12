/**
 * Generación de tokens de API (MCP) en el navegador. El token en texto plano
 * NUNCA se envía a un endpoint propio ni se persiste — se genera acá, se
 * hashea (SHA-256) con Web Crypto, y solo el hash + un prefijo corto (para
 * reconocerlo en la lista) viajan al INSERT en `api_tokens`. Se muestra al
 * usuario una sola vez.
 */

export interface GeneratedApiToken {
    /** Texto plano completo — mostrar UNA vez, nunca se puede recuperar después. */
    raw: string;
    /** Primeros caracteres, para mostrar en la lista de tokens existentes. */
    prefix: string;
    /** SHA-256 hex — esto es lo único que se guarda en la base de datos. */
    hash: string;
}

function toHex(buf: ArrayBuffer): string {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function generateApiToken(): Promise<GeneratedApiToken> {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const raw = 'pgnl_' + toHex(bytes.buffer);
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return { raw, prefix: raw.slice(0, 14), hash: toHex(hashBuf) };
}
