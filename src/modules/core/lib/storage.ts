import { supabase } from './supabase';

// Acceso a archivos privados de Storage (P0 de seguridad, 2026-07-30).
//
// El bucket `contracts` era PÚBLICO y guarda documentos con datos personales:
// los PDF de entrega/devolución firmados de `pagnol/movimientos` —con nombre,
// RUT y la firma del trabajador capturada en el cierre biométrico—, las fotos de
// evidencia de devolución y los documentos EA. Con `public=true` cualquiera con
// la URL los abría sin autenticación.
//
// El bucket pasa a privado y los archivos se sirven con URL FIRMADA y expiración.

/** Bucket con documentos laborales y evidencia. Privado. */
export const CONTRACTS_BUCKET = 'contracts';

/** Vigencia por defecto de una URL firmada: suficiente para abrir el archivo. */
export const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Extrae el path dentro del bucket a partir de lo que haya guardado la fila.
 *
 * Convive con datos viejos a propósito: hasta hoy se guardaba la URL pública
 * completa (`…/storage/v1/object/public/contracts/<path>`), y las filas ya
 * escritas no se van a migrar. Si recibe un path, lo devuelve tal cual.
 *
 * Devuelve null cuando no puede resolverlo, para que el llamador muestre el
 * error en vez de abrir un enlace roto.
 */
export function contractsPath(stored: string | null | undefined): string | null {
    if (!stored) return null;
    const s = String(stored).trim();
    if (!s) return null;

    // URL pública o firmada de Supabase: el path va después del nombre del bucket.
    const marker = `/${CONTRACTS_BUCKET}/`;
    const idx = s.indexOf(marker);
    if (idx >= 0) {
        const path = s.slice(idx + marker.length).split('?')[0];
        return decodeURIComponent(path) || null;
    }

    // Una URL de otro host que no reconocemos no es un path del bucket.
    if (/^https?:\/\//i.test(s)) return null;

    return s.replace(/^\/+/, '');
}

/**
 * URL firmada para abrir un archivo del bucket privado.
 *
 * Acepta indistintamente el path nuevo o la URL pública que guardaban las filas
 * antiguas. Firma en el momento del uso —no se persiste— porque una URL firmada
 * expira: guardarla en la base la dejaría muerta a los minutos.
 */
export async function getContractsSignedUrl(
    stored: string | null | undefined,
    expiresIn: number = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
    const path = contractsPath(stored);
    if (!path) return null;

    const { data, error } = await supabase.storage
        .from(CONTRACTS_BUCKET)
        .createSignedUrl(path, expiresIn);

    if (error) {
        console.warn('No se pudo firmar la URL del documento:', error.message);
        return null;
    }
    return data?.signedUrl ?? null;
}
