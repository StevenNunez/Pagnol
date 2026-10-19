import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Pagnol hace una petición saliente a la URL que registra el cliente: sin
// freno, una URL como http://169.254.169.254/ o http://localhost:5432 usaría a
// Pagnol para tocar la red interna (SSRF). Sólo se envía a https públicos.

const MAX_URL_LENGTH = 2048;

/** IPv4/IPv6 que no son de Internet pública (loopback, privadas, enlace local, CGNAT, multicast…). */
export function isPrivateIp(ip: string): boolean {
    if (isIP(ip) === 4) {
        const [a, b] = ip.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 192 && b === 0)
            || (a === 198 && (b === 18 || b === 19));
    }
    const v6 = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return isPrivateIp(mapped[1]);
    return v6 === '::' || v6 === '::1'
        || /^f[cd]/.test(v6)          // fc00::/7 únicas locales
        || /^fe[89ab]/.test(v6)       // fe80::/10 enlace local
        || v6.startsWith('ff');       // multicast
}

/** Validación sin red: forma de la URL. Devuelve el motivo del rechazo, o null si sirve. */
export function webhookUrlProblem(raw: string): string | null {
    if (raw.length > MAX_URL_LENGTH) return 'La URL es demasiado larga.';
    let u: URL;
    try { u = new URL(raw); } catch { return 'La URL no es válida.'; }
    if (u.protocol !== 'https:') return 'La URL debe ser https.';
    if (u.username || u.password) return 'La URL no puede llevar usuario ni contraseña.';
    if (u.port && u.port !== '443') return 'La URL debe usar el puerto 443.';
    if (u.hash) return 'La URL no puede llevar fragmento (#).';
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
        return 'La URL debe apuntar a un servidor público.';
    }
    const bare = host.replace(/^\[|\]$/g, '');
    if (isIP(bare) && isPrivateIp(bare)) return 'La URL debe apuntar a un servidor público.';
    if (!isIP(bare) && !host.includes('.')) return 'La URL debe apuntar a un servidor público.';
    return null;
}

/**
 * Antes de CADA envío: el nombre se resuelve ahora y todas sus direcciones
 * deben ser públicas (un dominio puede apuntar a una IP interna, o cambiarlo
 * después de registrarse). Devuelve el motivo del rechazo, o null si sirve.
 */
export async function resolvedHostProblem(raw: string): Promise<string | null> {
    const shape = webhookUrlProblem(raw);
    if (shape) return shape;
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) return null;
    try {
        const addrs = await lookup(host, { all: true });
        if (!addrs.length) return 'El dominio no resuelve.';
        if (addrs.some(a => isPrivateIp(a.address))) return 'El dominio apunta a una red interna.';
        return null;
    } catch {
        return 'El dominio no resuelve.';
    }
}
