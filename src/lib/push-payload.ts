// Limpieza de lo que un cliente pide mandar como push. Puro (no toca la red ni la base) para
// probarlo solo.
//
// POR QUÉ EXISTE: `/api/push/send` reenviaba tal cual el título, el texto y el enlace que mandara
// cualquier usuario con sesión, a quien indicara. Un enlace externo en una notificación de Pagnol es
// un anzuelo de phishing perfecto (llega «de la app», con su logo, y se abre con un toque), y sin
// destinatarios avisaba a toda la empresa. Aquí se deja pasar sólo lo que las pantallas de verdad
// mandan: texto corto y enlaces DENTRO de la app.

export interface CleanPushPayload {
    title: string;
    body: string;
    url: string;
    tag?: string;
    requireInteraction?: boolean;
}

/** Sin saltos ni caracteres de control, espacios colapsados, recortado. */
const oneLine = (v: unknown, max: number) =>
    String(v ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Un enlace sólo es válido si es una ruta de la propia app: empieza con una sola `/` y no trae
 * esquema, host ni barras invertidas (`//evil.com`, `/\evil.com`, `https://…`, `javascript:…`).
 * Cualquier otra cosa cae al inicio del dashboard.
 */
export function safeInternalUrl(raw: unknown, fallback = '/dashboard'): string {
    const u = typeof raw === 'string' ? raw.trim() : '';
    if (!u.startsWith('/') || u.startsWith('//')) return fallback;
    if (/[\\\u0000-\u001F\u007F]/.test(u) || /^\/+[a-z][a-z0-9+.-]*:/i.test(u)) return fallback;
    return u.slice(0, 300);
}

/** El payload limpio, o null si no trae título (no hay aviso que mandar). */
export function sanitizePushPayload(raw: unknown): CleanPushPayload | null {
    if (!raw || typeof raw !== 'object') return null;
    const p = raw as Record<string, unknown>;
    const title = oneLine(p.title, 80);
    if (!title) return null;
    const tag = oneLine(p.tag, 80).replace(/[^A-Za-z0-9:_.-]/g, '');
    return {
        title,
        body: oneLine(p.body, 240),
        url: safeInternalUrl(p.url),
        ...(tag ? { tag } : {}),
        ...(p.requireInteraction === true ? { requireInteraction: true } : {}),
    };
}

/** Los ids de destinatarios: sólo textos, sin repetir, con tope. */
export function cleanTargetIds(raw: unknown, max = 50): string[] {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, max);
}
