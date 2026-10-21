import { describe, it, expect } from 'vitest';
import { safeInternalUrl, sanitizePushPayload, cleanTargetIds } from './push-payload';

describe('safeInternalUrl — sólo enlaces dentro de la app', () => {
    it('deja pasar rutas internas, con su query', () => {
        expect(safeInternalUrl('/dashboard/pagnol/solicitudes?paso=por-aprobar')).toBe('/dashboard/pagnol/solicitudes?paso=por-aprobar');
        expect(safeInternalUrl('/dashboard')).toBe('/dashboard');
    });
    it('rechaza lo externo, en todas sus formas', () => {
        for (const evil of [
            'https://evil.com', 'http://evil.com/x', '//evil.com', '///evil.com', '/\\evil.com', '\\\\evil.com',
            'javascript:alert(1)', 'data:text/html,hola', 'evil.com', '', '   ', '/https://evil.com', '/\t/evil.com',
        ]) expect(safeInternalUrl(evil)).toBe('/dashboard');
    });
    it('lo que no es texto cae al inicio', () => {
        expect(safeInternalUrl(undefined)).toBe('/dashboard');
        expect(safeInternalUrl({ a: 1 })).toBe('/dashboard');
        expect(safeInternalUrl(null, '/x')).toBe('/x');
    });
});

describe('sanitizePushPayload', () => {
    it('conserva lo que las pantallas mandan de verdad', () => {
        expect(sanitizePushPayload({
            title: 'Retiro por revisar', body: 'Juan retiró 3 ítems en el pañol.', url: '/dashboard/supervisor/revisar-retiros',
            tag: 'withdrawal-review-TX-0001', requireInteraction: true,
        })).toEqual({
            title: 'Retiro por revisar', body: 'Juan retiró 3 ítems en el pañol.', url: '/dashboard/supervisor/revisar-retiros',
            tag: 'withdrawal-review-TX-0001', requireInteraction: true,
        });
    });
    it('sin título no hay aviso', () => {
        expect(sanitizePushPayload({ body: 'x' })).toBeNull();
        expect(sanitizePushPayload({ title: '   ' })).toBeNull();
        expect(sanitizePushPayload(null)).toBeNull();
        expect(sanitizePushPayload('hola')).toBeNull();
    });
    it('un enlace externo se reemplaza; el texto se recorta y sin saltos de línea', () => {
        const p = sanitizePushPayload({ title: 'T'.repeat(200), body: 'a\n\nb\tc' + 'x'.repeat(500), url: 'https://phishing.example/login' })!;
        expect(p.url).toBe('/dashboard');
        expect(p.title).toHaveLength(80);
        expect(p.body.length).toBeLessThanOrEqual(240);
        expect(p.body.startsWith('a b c')).toBe(true);
    });
    it('el tag se limpia y requireInteraction sólo vale con true', () => {
        expect(sanitizePushPayload({ title: 'x', tag: 'a b<script>', requireInteraction: 'sí' })).toEqual({ title: 'x', body: '', url: '/dashboard', tag: 'abscript' });
    });
    it('ignora campos que no conoce', () => {
        expect(sanitizePushPayload({ title: 'x', icon: 'https://evil/x.png', actions: [1] })).toEqual({ title: 'x', body: '', url: '/dashboard' });
    });
});

describe('cleanTargetIds', () => {
    it('sin repetir, sólo textos, con tope', () => {
        expect(cleanTargetIds(['a', 'a', 'b', 3, null, ''])).toEqual(['a', 'b']);
        expect(cleanTargetIds(Array.from({ length: 80 }, (_, i) => `u${i}`))).toHaveLength(50);
    });
    it('lo que no es lista es lista vacía (antes: avisar a TODA la empresa)', () => {
        expect(cleanTargetIds(undefined)).toEqual([]);
        expect(cleanTargetIds('todos')).toEqual([]);
    });
});
