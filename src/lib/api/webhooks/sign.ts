import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Firma "Standard Webhooks" (https://www.standardwebhooks.com): HMAC-SHA256 de
// `${webhook-id}.${webhook-timestamp}.${cuerpo}` con la llave del secreto
// (`whsec_<base64>`, se firma con los bytes ya decodificados). El receptor
// puede usar la librería `standardwebhooks` tal cual con el mismo `whsec_…`.

export const SECRET_PREFIX = 'whsec_';

export function generateWebhookSecret(): string {
    return SECRET_PREFIX + randomBytes(32).toString('base64');
}

function keyBytes(secret: string): Buffer {
    return Buffer.from(secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret, 'base64');
}

function mac(secret: string, id: string, timestamp: string, body: string): string {
    return createHmac('sha256', keyBytes(secret)).update(`${id}.${timestamp}.${body}`).digest('base64');
}

/** Cabeceras de un envío. El timestamp (segundos) y la firma se rehacen en CADA intento: el receptor rechaza los de más de 5 minutos. */
export function signedHeaders(secret: string, id: string, body: string, nowMs: number = Date.now()): Record<string, string> {
    const timestamp = String(Math.floor(nowMs / 1000));
    return {
        'content-type': 'application/json',
        'webhook-id': id,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${mac(secret, id, timestamp, body)}`,
    };
}

export const TOLERANCE_SECONDS = 300;

/** Lo que hace el receptor. Aquí sólo sirve para probar que firmamos como debemos. */
export function verifyWebhook(
    secret: string, headers: Record<string, string>, body: string, nowMs: number = Date.now(),
): boolean {
    const id = headers['webhook-id'];
    const timestamp = headers['webhook-timestamp'];
    const signatures = headers['webhook-signature'];
    if (!id || !timestamp || !signatures) return false;
    if (Math.abs(nowMs / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
    const expected = Buffer.from(mac(secret, id, timestamp, body));
    return signatures.split(' ').some(part => {
        const [version, sig] = part.split(',');
        if (version !== 'v1' || !sig) return false;
        const given = Buffer.from(sig);
        return given.length === expected.length && timingSafeEqual(given, expected);
    });
}
