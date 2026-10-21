import type { CompraDTO, CompraLineaDTO, CompraRecepcionCorregidaDTO, CompraRecepcionDTO, CompraRecibidaDTO, RefDTO } from './schemas';
import { ACTIVO_USAGE_TYPES } from './mappers';

// Compras esperadas: filas de Postgres → DTO público, y el estado DERIVADO.
// Nada de esto toca la base: se prueba solo (compras.test.ts).

export interface CompraRow {
    id: string;
    external_ref: string;
    supplier_id: string | null;
    warehouse_id: string;
    estimated_date: string | null;
    contract_ref: string | null;
    canceled_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface CompraLineaRow {
    id: string;
    purchase_id: string;
    external_ref: string;
    material_id: string;
    expected_qty: number | string;
    unit_value?: number | string | null;
    canceled_at: string | null;
}

export interface RecepcionRow {
    id: string;
    purchase_id: string;
    guide_number: string;
    /** Pañol de la compra el día de la recepción (copia). */
    warehouse_id?: string;
    received_on: string;
    received_by: string;
    received_by_name: string;
    created_at: string;
}

export interface RecepcionLineaRow {
    id: string;
    receipt_id: string;
    line_id: string;
    qty: number | string;
    /** Cantidad esperada de la línea AL RECIBIR (copia): el aviso cuenta lo que pasó entonces, no lo de hoy. */
    expected_qty?: number | string | null;
    created_refs: { tipo: 'activo' | 'movimiento'; id: string; external_ref: string }[] | null;
    created_at: string;
}

/** Una corrección: quita cantidad de una recepción ya hecha (hecho nuevo; la recepción no se edita). */
export interface RecepcionCorreccionRow {
    id: string;
    receipt_line_id: string;
    qty_removed: number | string;
    expected_qty?: number | string | null;
    reason: string;
    corrected_by: string;
    corrected_by_name: string;
    removed_refs: { tipo: 'activo' | 'movimiento'; id: string; external_ref: string }[] | null;
    created_at: string;
}

export interface MaterialLite { id: string; name: string; usage_type: string | null }

type LineaEstado = CompraLineaDTO['estado'];

/**
 * Estado de una línea, derivado de lo que ya se recibió (no se guarda): cancelada gana a todo;
 * después, nada recibido = esperada, algo = parcial, todo = recibida.
 */
export function lineaEstado(expected: number, received: number, canceled: boolean): LineaEstado {
    if (canceled) return 'cancelada';
    if (received <= 0) return 'esperada';
    return received >= expected ? 'recibida' : 'parcial';
}

/**
 * Estado de la compra: cancelada si se canceló entera o todas sus líneas; cerrada cuando
 * ninguna línea sigue esperando algo; abierta en cualquier otro caso.
 */
export function compraEstado(canceledAt: string | null, lineas: readonly { estado: LineaEstado }[]): CompraDTO['estado'] {
    if (canceledAt || (lineas.length > 0 && lineas.every(l => l.estado === 'cancelada'))) return 'cancelada';
    const vivas = lineas.filter(l => l.estado !== 'cancelada');
    if (vivas.length > 0 && vivas.every(l => l.estado === 'recibida')) return 'cerrada';
    return 'abierta';
}

/** Orden estable de los hechos: por momento y, si empatan, por id. */
const byCreated = <T extends { created_at: string; id: string }>(a: T, b: T) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Lo recibido NETO de una línea hasta un momento (o hoy): lo recibido menos lo corregido.
 * `hasta` es un instante ISO; sin él, cuenta todo.
 */
export function recibidoNeto(
    lineId: string,
    recepcionLineas: readonly RecepcionLineaRow[],
    correcciones: readonly RecepcionCorreccionRow[],
    hasta?: string,
): number {
    const mias = recepcionLineas.filter(r => r.line_id === lineId);
    const ids = new Set(mias.map(r => r.id));
    const bruto = mias.filter(r => !hasta || r.created_at <= hasta).reduce((s, r) => s + Number(r.qty), 0);
    const quitado = correcciones.filter(c => ids.has(c.receipt_line_id) && (!hasta || c.created_at <= hasta))
        .reduce((s, c) => s + Number(c.qty_removed), 0);
    return bruto - quitado;
}

export function toCompraDTO(
    row: CompraRow,
    lineas: readonly CompraLineaRow[],
    ctx: {
        materiales: Map<string, MaterialLite>;
        proveedor: RefDTO | null;
        panol: RefDTO;
        recepciones?: readonly RecepcionRow[];
        recepcionLineas?: readonly RecepcionLineaRow[];
        correcciones?: readonly RecepcionCorreccionRow[];
    },
): CompraDTO {
    const rLineas = ctx.recepcionLineas ?? [];
    const correcciones = ctx.correcciones ?? [];
    const quitadoPorRL = new Map<string, number>();
    for (const c of correcciones) quitadoPorRL.set(c.receipt_line_id, (quitadoPorRL.get(c.receipt_line_id) ?? 0) + Number(c.qty_removed));

    const ls: CompraLineaDTO[] = lineas
        .filter(l => l.purchase_id === row.id)
        .map(l => {
            const esperada = Number(l.expected_qty);
            const recibida = recibidoNeto(l.id, rLineas, correcciones);
            const m = ctx.materiales.get(l.material_id);
            return {
                id: l.id,
                external_ref: l.external_ref,
                material: {
                    id: l.material_id,
                    nombre: m?.name ?? '',
                    rastreable: !!m?.usage_type && (ACTIVO_USAGE_TYPES as readonly string[]).includes(m.usage_type),
                },
                cantidad_esperada: esperada,
                cantidad_recibida: recibida,
                valor_unitario: l.unit_value == null ? null : Number(l.unit_value),
                estado: lineaEstado(esperada, recibida, !!l.canceled_at),
            };
        });

    const refOf = new Map(lineas.map(l => [l.id, l.external_ref]));
    const recepcionesDeLaCompra = [...(ctx.recepciones ?? [])].filter(r => r.purchase_id === row.id).sort(byCreated);
    const recepciones: CompraRecepcionDTO[] = recepcionesDeLaCompra.map(r => ({
        id: r.id,
        guia_despacho: r.guide_number,
        fecha_recepcion: r.received_on,
        recibido_por: { id: r.received_by, nombre: r.received_by_name },
        lineas: rLineas
            .filter(rl => rl.receipt_id === r.id)
            .sort(byCreated)
            .map(rl => ({
                linea_external_ref: refOf.get(rl.line_id) ?? '',
                cantidad: Number(rl.qty),
                cantidad_corregida: quitadoPorRL.get(rl.id) ?? 0,
                creados: rl.created_refs ?? [],
            })),
    }));

    const rlById = new Map(rLineas.map(rl => [rl.id, rl]));
    const recById = new Map(recepcionesDeLaCompra.map(r => [r.id, r]));
    const deEstaCompra = correcciones.filter(c => {
        const rl = rlById.get(c.receipt_line_id);
        return !!rl && recById.has(rl.receipt_id);
    });
    const correccionesDTO = [...deEstaCompra].sort(byCreated).map(c => {
        const rl = rlById.get(c.receipt_line_id)!;
        const rec = recById.get(rl.receipt_id)!;
        return {
            id: c.id,
            recepcion_id: rec.id,
            guia_despacho: rec.guide_number,
            linea_external_ref: refOf.get(rl.line_id) ?? '',
            cantidad_quitada: Number(c.qty_removed),
            motivo: c.reason,
            corregido_por: { id: c.corrected_by, nombre: c.corrected_by_name },
            fecha: new Date(c.created_at).toISOString(),
            revertidos: c.removed_refs ?? [],
        };
    });

    return {
        id: row.id,
        external_ref: row.external_ref,
        estado: compraEstado(row.canceled_at, ls),
        proveedor: ctx.proveedor,
        panol: ctx.panol,
        fecha_estimada: row.estimated_date,
        contrato_ref: row.contract_ref,
        lineas: ls,
        recepciones,
        correcciones: correccionesDTO,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

type EventoCtx = {
    compra: Pick<CompraRow, 'id' | 'external_ref'>;
    recepcion: RecepcionRow;
    /** Todas las recepciones de ESA línea y todas las correcciones de sus recepciones (para la acumulada). */
    deLaLinea: readonly RecepcionLineaRow[];
    correcciones?: readonly RecepcionCorreccionRow[];
    linea: Pick<CompraLineaRow, 'id' | 'external_ref' | 'material_id' | 'expected_qty' | 'canceled_at'>;
    material: { id: string; name: string };
    panol: RefDTO;
};

/**
 * `data` de `compra.recibida`: UNA línea recibida en UNA recepción. La acumulada cuenta lo recibido
 * NETO hasta esa recepción inclusive (orden de los hechos), no lo que haya cuando se despacha el aviso.
 */
export function toCompraRecibidaDTO(p: EventoCtx & { recepcionLinea: RecepcionLineaRow }): CompraRecibidaDTO {
    const mias = p.deLaLinea.map(r => ({ ...r, line_id: p.linea.id }));
    const acumulada = recibidoNeto(p.linea.id, mias, p.correcciones ?? [], p.recepcionLinea.created_at);
    const esperada = Number(p.recepcionLinea.expected_qty ?? p.linea.expected_qty);
    return {
        compra_id: p.compra.id,
        compra_external_ref: p.compra.external_ref,
        recepcion_id: p.recepcion.id,
        guia_despacho: p.recepcion.guide_number,
        fecha_recepcion: p.recepcion.received_on,
        recibido_por: { id: p.recepcion.received_by, nombre: p.recepcion.received_by_name },
        panol: p.panol,
        linea: {
            id: p.linea.id,
            external_ref: p.linea.external_ref,
            material: { id: p.material.id, nombre: p.material.name },
            cantidad_esperada: esperada,
            cantidad_recibida_ahora: Number(p.recepcionLinea.qty),
            cantidad_recibida_acumulada: acumulada,
            // El estado al momento de ESA recepción (cancelar o corregir después no reescribe el pasado).
            estado: lineaEstado(esperada, acumulada, false),
            creados: p.recepcionLinea.created_refs ?? [],
        },
    };
}

/**
 * `data` de `compra.recepcion_corregida`: se quitó cantidad de una recepción ya informada. Con esto
 * el sistema que compra descuenta lo que había registrado como recibido.
 */
export function toCompraRecepcionCorregidaDTO(p: EventoCtx & { correccion: RecepcionCorreccionRow }): CompraRecepcionCorregidaDTO {
    const mias = p.deLaLinea.map(r => ({ ...r, line_id: p.linea.id }));
    const acumulada = recibidoNeto(p.linea.id, mias, p.correcciones ?? [p.correccion], p.correccion.created_at);
    const esperada = Number(p.correccion.expected_qty ?? p.linea.expected_qty);
    return {
        compra_id: p.compra.id,
        compra_external_ref: p.compra.external_ref,
        recepcion_id: p.recepcion.id,
        guia_despacho: p.recepcion.guide_number,
        correccion_id: p.correccion.id,
        motivo: p.correccion.reason,
        corregido_por: { id: p.correccion.corrected_by, nombre: p.correccion.corrected_by_name },
        fecha_correccion: new Date(p.correccion.created_at).toISOString(),
        panol: p.panol,
        linea: {
            id: p.linea.id,
            external_ref: p.linea.external_ref,
            material: { id: p.material.id, nombre: p.material.name },
            cantidad_esperada: esperada,
            cantidad_quitada: Number(p.correccion.qty_removed),
            cantidad_recibida_acumulada: acumulada,
            estado: lineaEstado(esperada, acumulada, false),
            revertidos: p.correccion.removed_refs ?? [],
        },
    };
}
