import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

// Cifrado simétrico (AES-256-GCM) para secretos en reposo (p. ej. credenciales
// de integraciones ERP). SOLO server-side. La clave se deriva de la variable de
// entorno INTEGRATION_ENCRYPTION_KEY; si falta, las funciones lanzan para FALLAR
// CERRADO (nunca se guarda texto plano).

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function getKey(): Buffer {
    const secret = process.env.INTEGRATION_ENCRYPTION_KEY;
    if (!secret || secret.length < 16) {
        throw new Error('INTEGRATION_ENCRYPTION_KEY no configurada o demasiado corta (mín. 16 caracteres).');
    }
    // Deriva 32 bytes determinísticos desde el secreto.
    return createHash('sha256').update(secret).digest();
}

/** Cifra un texto. Devuelve `enc:v1:<iv>:<tag>:<ciphertext>` en base64. */
export function encryptSecret(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, getKey(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/** Descifra un valor producido por encryptSecret(). Si no tiene el prefijo, lo
 *  devuelve tal cual (compatibilidad con datos legacy en texto plano). */
export function decryptSecret(payload: string): string {
    if (!payload?.startsWith(PREFIX)) return payload;
    const [ivB64, tagB64, encB64] = payload.slice(PREFIX.length).split(':');
    const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
}
