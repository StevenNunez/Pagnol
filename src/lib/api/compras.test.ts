import { describe, it, expect } from 'vitest';
import { compraEstado, lineaEstado, recibidoNeto, toCompraDTO, toCompraRecepcionCorregidaDTO, toCompraRecibidaDTO, type CompraLineaRow, type CompraRow, type RecepcionCorreccionRow, type RecepcionLineaRow, type RecepcionRow } from './compras';
import { CompraRecepcionCorregidaSchema, CompraRecibidaSchema, CompraSchema, CreateCompraBodySchema, PatchCompraBodySchema, PatchWebhookBodySchema, WebhookEventTypeSchema } from './schemas';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const compra: CompraRow = {
    id: U(1), external_ref: 'valar:oc:123', supplier_id: U(2), warehouse_id: U(3), estimated_date: '2026-11-01',
    contract_ref: 'CT-9', canceled_at: null, created_at: '2026-10-21T10:00:00+00:00', updated_at: '2026-10-21T10:00:00+00:00',
};
const linea = (n: number, qty: number, over: Partial<CompraLineaRow> = {}): CompraLineaRow =>
    ({ id: U(10 + n), purchase_id: U(1), external_ref: `valar:compra:123:item:${n}`, material_id: U(20 + n), expected_qty: qty, canceled_at: null, ...over });
const recep = (n: number, guia: string, at: string): RecepcionRow =>
    ({ id: U(40 + n), purchase_id: U(1), warehouse_id: U(3), guide_number: guia, received_on: '2026-10-22', received_by: U(5), received_by_name: 'María González', created_at: at });
const rlin = (n: number, receipt: number, line: number, qty: number, at: string, refs: RecepcionLineaRow['created_refs'] = []): RecepcionLineaRow =>
    ({ id: U(60 + n), receipt_id: U(40 + receipt), line_id: U(10 + line), qty, created_refs: refs, created_at: at });
const ctx = (recepcionLineas: RecepcionLineaRow[] = [], recepciones: RecepcionRow[] = []) => ({
    materiales: new Map([[U(21), { id: U(21), name: 'Taladro', usage_type: 'Herramienta Menor' }], [U(22), { id: U(22), name: 'Guantes', usage_type: 'Consumible' }]]),
    proveedor: { id: U(2), nombre: 'Ferretería Sur' }, panol: { id: U(3), nombre: 'Misceláneos – Torres' }, recepciones, recepcionLineas,
});

describe('estado de una línea (derivado)', () => {
    it('esperada, parcial, recibida; cancelada gana a todo', () => {
        expect(lineaEstado(10, 0, false)).toBe('esperada');
        expect(lineaEstado(10, 4, false)).toBe('parcial');
        expect(lineaEstado(10, 10, false)).toBe('recibida');
        expect(lineaEstado(10, 10, true)).toBe('cancelada');
    });
});

describe('estado de la compra (derivado)', () => {
    const l = (estado: any) => ({ estado });
    it('abierta mientras algo espera; cerrada cuando todo lo vigente llegó', () => {
        expect(compraEstado(null, [l('esperada'), l('recibida')])).toBe('abierta');
        expect(compraEstado(null, [l('parcial')])).toBe('abierta');
        expect(compraEstado(null, [l('recibida'), l('recibida')])).toBe('cerrada');
        expect(compraEstado(null, [l('recibida'), l('cancelada')])).toBe('cerrada');
    });
    it('cancelada: entera o con todas sus líneas canceladas', () => {
        expect(compraEstado('2026-10-22T00:00:00Z', [l('esperada')])).toBe('cancelada');
        expect(compraEstado(null, [l('cancelada'), l('cancelada')])).toBe('cancelada');
    });
    it('una compra sin líneas no se da por cerrada', () => {
        expect(compraEstado(null, [])).toBe('abierta');
    });
});

describe('DTO de compra esperada', () => {
    it('valida contra el schema público y trae rastreable y estado por línea', () => {
        const dto = toCompraDTO(compra, [linea(1, 2), linea(2, 10, { canceled_at: '2026-10-22T00:00:00Z' })],
            ctx([rlin(1, 1, 1, 1, '2026-10-22T10:00:00Z')], [recep(1, 'G-1', '2026-10-22T10:00:00Z')]));
        expect(CompraSchema.parse(dto)).toEqual(dto);
        expect(dto.estado).toBe('abierta');
        expect(dto.lineas[0]).toMatchObject({ cantidad_esperada: 2, cantidad_recibida: 1, estado: 'parcial', material: { nombre: 'Taladro', rastreable: true } });
        expect(dto.lineas[1]).toMatchObject({ estado: 'cancelada', material: { rastreable: false } });
    });
    it('sólo toma las líneas de SU compra', () => {
        const otra = linea(3, 5, { purchase_id: U(99) });
        expect(toCompraDTO(compra, [linea(1, 2), otra], ctx()).lineas).toHaveLength(1);
    });
});

describe('recepciones: lo recibido y el estado salen de los hechos', () => {
    const lineas = [linea(1, 3, { unit_value: 250000 }), linea(2, 40)];
    const rs = [recep(1, 'G-100', '2026-10-22T10:00:00Z'), recep(2, 'G-101', '2026-10-23T10:00:00Z')];
    const rl = [
        rlin(1, 1, 1, 2, '2026-10-22T10:00:00Z', [{ tipo: 'activo', id: U(70), external_ref: 'valar:oc:123:item:1:unidad:1' }, { tipo: 'activo', id: U(71), external_ref: 'valar:oc:123:item:1:unidad:2' }]),
        rlin(2, 2, 1, 1, '2026-10-23T10:00:00Z', [{ tipo: 'activo', id: U(72), external_ref: 'valar:oc:123:item:1:unidad:3' }]),
        rlin(3, 2, 2, 25, '2026-10-23T10:00:00Z'),
    ];
    it('suma lo recibido por línea a través de varias recepciones', () => {
        const dto = toCompraDTO(compra, lineas, ctx(rl, rs));
        expect(CompraSchema.parse(dto)).toEqual(dto);
        expect(dto.lineas[0]).toMatchObject({ cantidad_recibida: 3, estado: 'recibida', valor_unitario: 250000 });
        expect(dto.lineas[1]).toMatchObject({ cantidad_recibida: 25, estado: 'parcial', valor_unitario: null });
        expect(dto.estado).toBe('abierta'); // los guantes siguen esperando
    });
    it('lista las recepciones en orden, con la guía, quién recibió y lo que se creó', () => {
        const dto = toCompraDTO(compra, lineas, ctx(rl, rs));
        expect(dto.recepciones.map(r => r.guia_despacho)).toEqual(['G-100', 'G-101']);
        expect(dto.recepciones[0]).toMatchObject({ recibido_por: { nombre: 'María González' }, fecha_recepcion: '2026-10-22' });
        expect(dto.recepciones[0].lineas[0].creados.map(c => c.external_ref)).toEqual(['valar:oc:123:item:1:unidad:1', 'valar:oc:123:item:1:unidad:2']);
        expect(dto.recepciones[1].lineas).toHaveLength(2);
    });
    it('cerrada cuando todo lo vigente llegó', () => {
        const dto = toCompraDTO(compra, [linea(1, 3)], ctx(rl.slice(0, 2), rs));
        expect(dto.estado).toBe('cerrada');
    });
});

describe('correcciones: lo que se quita de una recepción', () => {
    const corr = (n: number, rlineN: number, qty: number, at: string, reason = 'No venían'): RecepcionCorreccionRow =>
        ({ id: U(80 + n), receipt_line_id: U(60 + rlineN), qty_removed: qty, expected_qty: 3, reason, corrected_by: U(5), corrected_by_name: 'María González', removed_refs: [{ tipo: 'activo', id: U(72), external_ref: 'valar:oc:123:item:1:unidad:3' }], created_at: at });
    const rs = [recep(1, 'G-100', '2026-10-22T10:00:00Z')];
    const rl = [rlin(1, 1, 1, 3, '2026-10-22T10:00:00Z')];

    it('lo recibido neto = lo recibido − lo corregido', () => {
        expect(recibidoNeto(U(11), rl, [])).toBe(3);
        expect(recibidoNeto(U(11), rl, [corr(1, 1, 1, '2026-10-23T10:00:00Z')])).toBe(2);
        expect(recibidoNeto(U(11), rl, [corr(1, 1, 1, '2026-10-23T10:00:00Z'), corr(2, 1, 2, '2026-10-24T10:00:00Z')])).toBe(0);
    });
    it('hasta un momento: una corrección posterior no cambia el pasado', () => {
        const c = [corr(1, 1, 1, '2026-10-23T10:00:00Z')];
        expect(recibidoNeto(U(11), rl, c, '2026-10-22T12:00:00Z')).toBe(3);
        expect(recibidoNeto(U(11), rl, c, '2026-10-23T10:00:00Z')).toBe(2);
    });
    it('la compra cerrada vuelve a abierta y la línea a «parcial»; la recepción original no cambia', () => {
        const cerrada = toCompraDTO(compra, [linea(1, 3)], ctx(rl, rs));
        expect(cerrada.estado).toBe('cerrada');
        const dto = toCompraDTO(compra, [linea(1, 3)], { ...ctx(rl, rs), correcciones: [corr(1, 1, 1, '2026-10-23T10:00:00Z')] });
        expect(CompraSchema.parse(dto)).toEqual(dto);
        expect(dto.estado).toBe('abierta');
        expect(dto.lineas[0]).toMatchObject({ cantidad_recibida: 2, estado: 'parcial' });
        expect(dto.recepciones[0].lineas[0]).toMatchObject({ cantidad: 3, cantidad_corregida: 1 });
        expect(dto.correcciones[0]).toMatchObject({ cantidad_quitada: 1, motivo: 'No venían', guia_despacho: 'G-100', corregido_por: { nombre: 'María González' } });
        expect(dto.correcciones[0].revertidos[0].external_ref).toBe('valar:oc:123:item:1:unidad:3');
    });
    it('si se quita todo, la línea vuelve a «esperada»', () => {
        const dto = toCompraDTO(compra, [linea(1, 3)], { ...ctx(rl, rs), correcciones: [corr(1, 1, 3, '2026-10-23T10:00:00Z')] });
        expect(dto.lineas[0]).toMatchObject({ cantidad_recibida: 0, estado: 'esperada' });
    });
    it('el evento dice cuánto se quitó, cuánto queda neto y en qué estado quedó la línea', () => {
        const c = corr(1, 1, 1, '2026-10-23T10:00:00Z', 'La tercera unidad no venía');
        const e = toCompraRecepcionCorregidaDTO({ compra, recepcion: rs[0], correccion: c, deLaLinea: rl, correcciones: [c], linea: linea(1, 3), material: { id: U(21), name: 'Taladro' }, panol: { id: U(3), nombre: 'P' } });
        expect(CompraRecepcionCorregidaSchema.parse(e)).toEqual(e);
        expect(e).toMatchObject({ motivo: 'La tercera unidad no venía', guia_despacho: 'G-100', corregido_por: { nombre: 'María González' } });
        expect(e.linea).toMatchObject({ cantidad_esperada: 3, cantidad_quitada: 1, cantidad_recibida_acumulada: 2, estado: 'parcial' });
        expect(e.linea.revertidos[0].tipo).toBe('activo');
    });
    it('la acumulada de un compra.recibida viejo no incluye correcciones posteriores', () => {
        const c = corr(1, 1, 1, '2026-10-23T10:00:00Z');
        const e = toCompraRecibidaDTO({ compra, recepcion: rs[0], recepcionLinea: rl[0], deLaLinea: rl, correcciones: [c], linea: linea(1, 3), material: { id: U(21), name: 'Taladro' }, panol: { id: U(3), nombre: 'P' } });
        expect(e.linea).toMatchObject({ cantidad_recibida_acumulada: 3, estado: 'recibida' });
    });
});

describe('evento compra.recibida', () => {
    const l1 = linea(1, 3);
    const rs = [recep(1, 'G-100', '2026-10-22T10:00:00Z'), recep(2, 'G-101', '2026-10-23T10:00:00Z')];
    const rl = [rlin(1, 1, 1, 2, '2026-10-22T10:00:00Z', [{ tipo: 'activo', id: U(70), external_ref: 'valar:oc:123:item:1:unidad:1' }]), rlin(2, 2, 1, 1, '2026-10-23T10:00:00Z')];
    const dto = (i: number) => toCompraRecibidaDTO({
        compra, recepcion: rs[i], recepcionLinea: rl[i], deLaLinea: rl, linea: l1, material: { id: U(21), name: 'Taladro' }, panol: { id: U(3), nombre: 'Misceláneos – Torres' },
    });
    it('trae la cantidad de ESA recepción y la acumulada hasta ella, no la de hoy', () => {
        expect(dto(0).linea).toMatchObject({ cantidad_recibida_ahora: 2, cantidad_recibida_acumulada: 2, cantidad_esperada: 3, estado: 'parcial' });
        expect(dto(1).linea).toMatchObject({ cantidad_recibida_ahora: 1, cantidad_recibida_acumulada: 3, estado: 'recibida' });
    });
    it('lleva guía, fecha, quién recibió, pañol y lo que se creó; valida contra el schema', () => {
        const e = dto(0);
        expect(CompraRecibidaSchema.parse(e)).toEqual(e);
        expect(e).toMatchObject({ compra_external_ref: 'valar:oc:123', guia_despacho: 'G-100', fecha_recepcion: '2026-10-22', recibido_por: { nombre: 'María González' }, panol: { nombre: 'Misceláneos – Torres' } });
        expect(e.linea.creados[0].external_ref).toBe('valar:oc:123:item:1:unidad:1');
    });
    it('si la cantidad esperada cambia después, el aviso cuenta la de ESE momento', () => {
        // Valar subió la línea de 3 a 4 DESPUÉS de la primera recepción: ésta debe seguir diciendo «esperada 3».
        const viejo = { ...rl[0], expected_qty: 3 };
        const e = toCompraRecibidaDTO({ compra, recepcion: rs[0], recepcionLinea: viejo, deLaLinea: [viejo, rl[1]], linea: { ...l1, expected_qty: 4 }, material: { id: U(21), name: 'Taladro' }, panol: { id: U(3), nombre: 'P' } });
        expect(e.linea).toMatchObject({ cantidad_esperada: 3, cantidad_recibida_acumulada: 2, estado: 'parcial' });
        // Y si la bajaron hasta lo recibido, la primera no pasa a «recibida» retroactivamente.
        const bajo = { ...rl[0], expected_qty: 3 };
        const e2 = toCompraRecibidaDTO({ compra, recepcion: rs[0], recepcionLinea: bajo, deLaLinea: [bajo], linea: { ...l1, expected_qty: 2 }, material: { id: U(21), name: 'Taladro' }, panol: { id: U(3), nombre: 'P' } });
        expect(e2.linea.estado).toBe('parcial');
    });
    it('cancelar la línea después NO reescribe el estado de una recepción pasada', () => {
        const e = toCompraRecibidaDTO({ compra, recepcion: rs[0], recepcionLinea: rl[0], deLaLinea: rl, linea: { ...l1, canceled_at: '2026-10-25T00:00:00Z' }, material: { id: U(21), name: 'Taladro' }, panol: { id: U(3), nombre: 'P' } });
        expect(e.linea.estado).toBe('parcial');
    });
});

describe('webhooks: evento nuevo y PATCH', () => {
    it('compra.recibida es un evento suscribible', () => {
        expect(WebhookEventTypeSchema.safeParse('compra.recibida').success).toBe(true);
        expect(WebhookEventTypeSchema.safeParse('compra.recepcion_corregida').success).toBe(true);
        expect(WebhookEventTypeSchema.safeParse('compra.cancelada').success).toBe(false);
    });
    it('PATCH: algo que cambiar; url con las mismas reglas que al crear; sin tocar el secreto', () => {
        expect(PatchWebhookBodySchema.safeParse({}).success).toBe(false);
        expect(PatchWebhookBodySchema.safeParse({ events: ['activo.creado', 'compra.recibida'] }).success).toBe(true);
        expect(PatchWebhookBodySchema.safeParse({ activo: false }).success).toBe(true);
        expect(PatchWebhookBodySchema.safeParse({ events: [] }).success).toBe(false);
        expect(PatchWebhookBodySchema.safeParse({ events: ['activo.creado', 'activo.creado'] }).success).toBe(false);
        expect(PatchWebhookBodySchema.safeParse({ url: 'http://localhost/x' }).success).toBe(false);
        expect(PatchWebhookBodySchema.safeParse({ secret: 'whsec_x' }).success).toBe(false);
    });
});

describe('cuerpos de escritura', () => {
    const ok = { external_ref: 'valar:oc:123', panol_id: U(3), lineas: [{ external_ref: 'a', material_id: U(21), cantidad: 2 }] };
    it('acepta lo mínimo y rechaza campos desconocidos', () => {
        expect(CreateCompraBodySchema.safeParse(ok).success).toBe(true);
        expect(CreateCompraBodySchema.safeParse({ ...ok, gasto: 100 }).success).toBe(false);
        expect(CreateCompraBodySchema.safeParse({ ...ok, lineas: [] }).success).toBe(false);
        expect(CreateCompraBodySchema.safeParse({ ...ok, lineas: [{ ...ok.lineas[0], cantidad: 0 }] }).success).toBe(false);
        expect(CreateCompraBodySchema.safeParse({ ...ok, fecha_estimada: '01-11-2026' }).success).toBe(false);
        expect(CreateCompraBodySchema.safeParse({ ...ok, lineas: [{ ...ok.lineas[0], valor_unitario: 250000 }] }).success).toBe(true);
        expect(CreateCompraBodySchema.safeParse({ ...ok, lineas: [{ ...ok.lineas[0], valor_unitario: -1 }] }).success).toBe(false);
    });
    it('PATCH: algo que cambiar, y cada línea dice qué', () => {
        expect(PatchCompraBodySchema.safeParse({}).success).toBe(false);
        expect(PatchCompraBodySchema.safeParse({ fecha_estimada: null }).success).toBe(true);
        expect(PatchCompraBodySchema.safeParse({ cancelar: true }).success).toBe(true);
        expect(PatchCompraBodySchema.safeParse({ cancelar: false }).success).toBe(false);
        expect(PatchCompraBodySchema.safeParse({ lineas: [{ external_ref: 'a' }] }).success).toBe(false);
        expect(PatchCompraBodySchema.safeParse({ lineas: [{ external_ref: 'a', cantidad: 3 }, { external_ref: 'b', cancelar: true }] }).success).toBe(true);
    });
});
