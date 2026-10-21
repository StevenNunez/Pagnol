import { describe, expect, it } from 'vitest';
import { lineaSolicitudEstado, solicitudEstado, toSolicitudCompraDTO, type SolicitudRow } from './solicitudes';
import { SolicitudCompraSchema, WebhookEventTypeSchema } from './schemas';

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const row = (n: number, over: Partial<SolicitudRow> = {}): SolicitudRow => ({
    id: U(n), batch_id: U(900), internal_code: `PRQ-00${n}`, material_name: 'Guantes', item_description: null, quantity: 3, unit: 'par',
    category: 'EPP', request_type: 'producto', justification: 'Reposición', supervisor_id: U(5), requester_name: 'Marcela Pizarro',
    contract_id: U(7), contract_name: 'Contrato Torres', area: 'Faena', urgency: null, urgency_reason: null, needed_by: null,
    status: 'pending', rejection_reason: null, adc_authorized_at: null, adc_authorized_by: null, ops_reviewed_by: null, ops_reviewed_by_name: null,
    created_at: `2026-10-22T10:00:0${n}Z`, ...over,
});
const names = new Map([[U(6), 'Ana ADC']]);
const auth = { adc_authorized_at: '2026-10-22T12:00:00Z', adc_authorized_by: U(6) };

describe('estado de la solicitud', () => {
    it('línea: rechazada gana; luego autorizada o pendiente', () => {
        expect(lineaSolicitudEstado({ status: 'rejected', adc_authorized_at: '2026-10-22' })).toBe('rechazada');
        expect(lineaSolicitudEstado({ status: 'pending', adc_authorized_at: '2026-10-22' })).toBe('autorizada');
        expect(lineaSolicitudEstado({ status: 'pending', adc_authorized_at: null })).toBe('pendiente');
    });
    it('solicitud: rechazada sin líneas vivas, aprobada con todas las vivas autorizadas, pendiente si no', () => {
        expect(solicitudEstado([{ estado: 'rechazada' }, { estado: 'rechazada' }])).toBe('rechazada');
        expect(solicitudEstado([{ estado: 'autorizada' }, { estado: 'rechazada' }])).toBe('aprobada');
        expect(solicitudEstado([{ estado: 'autorizada' }, { estado: 'pendiente' }])).toBe('pendiente');
        expect(solicitudEstado([])).toBe('rechazada');
    });
});

describe('toSolicitudCompraDTO', () => {
    it('una solicitud con varias líneas sale como UNA, con el código de la primera', () => {
        const dto = toSolicitudCompraDTO(U(900), [row(2), row(1, { material_name: 'Casco', quantity: '2' })], names);
        expect(SolicitudCompraSchema.parse(dto)).toEqual(dto);
        expect(dto).toMatchObject({ id: U(900), codigo: 'PRQ-001', estado: 'pendiente', prioridad: 'normal', origen: 'manual' });
        expect(dto.lineas.map(l => l.descripcion)).toEqual(['Casco', 'Guantes']);
        expect(dto.lineas[0].cantidad).toBe(2);
        expect(dto.contrato).toEqual({ id: U(7), nombre: 'Contrato Torres' });
        expect(dto.solicitante).toEqual({ id: U(5), nombre: 'Marcela Pizarro' });
    });
    it('aprobada: dice quién la autorizó y cada línea queda autorizada', () => {
        const dto = toSolicitudCompraDTO(U(900), [row(1, auth), row(2, auth)], names);
        expect(dto.estado).toBe('aprobada');
        expect(dto.autorizada_por).toEqual({ id: U(6), nombre: 'Ana ADC' });
        expect(dto.lineas.every(l => l.estado === 'autorizada')).toBe(true);
    });
    it('aprobada con una línea rechazada: esa va marcada para que no se compre', () => {
        const dto = toSolicitudCompraDTO(U(900), [row(1, auth), row(2, { status: 'rejected', rejection_reason: 'Sin presupuesto' })], names);
        expect(dto.estado).toBe('aprobada');
        expect(dto.lineas.map(l => l.estado)).toEqual(['autorizada', 'rechazada']);
        expect(dto.motivo_rechazo).toBeNull();
    });
    it('rechazada: trae el motivo', () => {
        const dto = toSolicitudCompraDTO(U(900), [row(1, { status: 'rejected', rejection_reason: 'Sin presupuesto' })], names);
        expect(dto).toMatchObject({ estado: 'rechazada', motivo_rechazo: 'Sin presupuesto' });
    });
    it('urgente con su motivo y fecha; servicio; descripción sin repetir el nombre', () => {
        const dto = toSolicitudCompraDTO(U(900), [row(1, {
            urgency: 'alta', urgency_reason: 'Se detiene la faena', needed_by: '2026-10-25T00:00:00+00:00',
            request_type: 'servicio', item_description: 'Calibrar balanza', material_name: 'Calibración',
        })], names);
        expect(dto).toMatchObject({ prioridad: 'urgente', motivo_urgencia: 'Se detiene la faena', necesaria_para: '2026-10-25' });
        expect(dto.lineas[0]).toMatchObject({ tipo: 'servicio', descripcion: 'Calibración — Calibrar balanza' });
        expect(toSolicitudCompraDTO(U(900), [row(1, { material_name: 'Guantes', item_description: 'Guantes' })], names).lineas[0].descripcion).toBe('Guantes');
    });
    it('sin contrato ni autorizador', () => {
        const dto = toSolicitudCompraDTO(U(900), [row(1, { contract_id: null, contract_name: null })], names);
        expect(dto.contrato).toBeNull();
        expect(dto.autorizada_por).toBeNull();
        expect(dto.revisada_por).toBeNull();
    });
});

describe('eventos', () => {
    it('los tres se pueden suscribir', () => {
        for (const t of ['solicitud_compra.creada', 'solicitud_compra.aprobada', 'solicitud_compra.rechazada'])
            expect(WebhookEventTypeSchema.safeParse(t).success).toBe(true);
    });
});
