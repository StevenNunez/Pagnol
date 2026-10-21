import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type ApiErrorCode } from './errors';
import { generateWebhookSecret } from './webhooks/sign';
import { afterCursorFilter, decodeCursor, paginate } from './pagination';
import {
    ACTIVO_USAGE_TYPES, MATERIAL_API_COLUMNS, PRODUCTO_USAGE_TYPES, SIN_LUGAR, SUPPLIER_API_COLUMNS,
    rutVariants, toActivoDTO, toMaterialDTO, toProveedorDTO,
    type ActivoLugar, type MaterialRow, type SupplierRow,
} from './mappers';
import { toSolicitudCompraDTO, type SolicitudRow } from './solicitudes';
import { toCompraDTO, toCompraRecepcionCorregidaDTO, toCompraRecibidaDTO, type CompraLineaRow, type CompraRow, type MaterialLite, type RecepcionCorreccionRow, type RecepcionLineaRow, type RecepcionRow } from './compras';
import type {
    ActivoDTO, ActivoEstado, CompraDTO, CompraRecepcionCorregidaDTO, CompraRecibidaDTO, ExistenciasDTO, MaterialDTO, MovimientoDTO, PanolDTO, ProveedorDTO, RefDTO, SolicitudCompraDTO,
    WebhookCreatedDTO, WebhookDTO,
} from './schemas';

// Acceso a datos de la API pública. Corre con el cliente service role (sin
// RLS), así que el aislamiento entre empresas depende de que TODA consulta
// nazca de `scoped()`, que fija `tenant_id` antes que cualquier otro filtro,
// y de que toda función de Postgres reciba el tenant de la llave.
// Los tests de aislamiento (`isolation.test.ts`) lo verifican endpoint por endpoint.

export type MaterialKind = 'materiales' | 'productos' | 'activos';

export interface ListParams {
    limit: number;
    cursor?: string;
    updated_since?: string;
}

export interface Page<T> {
    data: T[];
    next_cursor: string | null;
}

/** Resultado de una escritura: `created: false` = ya existía (misma external_ref). */
export interface WriteResult<T> {
    created: boolean;
    data: T;
}

function scoped(db: SupabaseClient, table: string, columns: string, tenantId: string) {
    if (!tenantId) throw new Error('scoped(): tenantId vacío');
    return db.from(table).select(columns).eq('tenant_id', tenantId);
}

// Comillas y barras romperían el valor entrecomillado del filtro de PostgREST.
function likeValue(q: string): string {
    return `"%${q.replace(/["\\]/g, '')}%"`;
}

type Query = ReturnType<typeof scoped>;

/** Qué filas de `materials` corresponden a cada recurso (ver mappers.ts). */
function applyKind(query: Query, kind: MaterialKind): Query {
    if (kind === 'activos') return query.in('usage_type', [...ACTIVO_USAGE_TYPES]);
    // Catálogo comprable: sólo lo propio. Los espejos de arriendo y lo
    // suministrado por el cliente no se compran.
    query = query.eq('ownership', 'propio');
    if (kind === 'productos') {
        const types = PRODUCTO_USAGE_TYPES.map(t => `"${t}"`).join(',');
        query = query.or(`usage_type.is.null,usage_type.in.(${types})`);
    }
    return query;
}

function applyEstado(query: Query, estado: ActivoEstado): Query {
    if (estado === 'de_baja') return query.or('status.eq."Para Baja",archived.is.true,deleted_at.not.is.null');
    // Los demás estados exigen que el activo siga vigente (no archivado ni eliminado).
    query = query.or('archived.is.null,archived.is.false').is('deleted_at', null);
    if (estado === 'operativo') return query.or('status.is.null,status.in.("Disponible","En Uso")');
    return query.eq('status', estado === 'en_mantencion' ? 'En Mantenimiento' : 'Extraviado');
}

async function runPage<R extends { id: string; updated_at: string }>(
    query: Query,
    params: ListParams,
): Promise<{ rows: R[]; next_cursor: string | null }> {
    if (params.updated_since) query = query.gte('updated_at', params.updated_since);
    if (params.cursor) query = query.or(afterCursorFilter(decodeCursor(params.cursor)));
    const { data, error } = await query
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(params.limit + 1);
    if (error) throw error;
    const { page, next_cursor } = paginate((data ?? []) as unknown as R[], params.limit);
    return { rows: page, next_cursor };
}

async function runOne<R>(query: Query, what: string): Promise<R> {
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    // Una fila de otra empresa responde igual que una inexistente: 404, nunca 403.
    if (!data) throw new ApiError('not_found', `${what} no encontrado.`);
    return data as unknown as R;
}

/** Las funciones de Postgres señalan errores de negocio como `api_error:<code>:<mensaje>`. */
function fromRpcError(error: { message?: string }): never {
    const m = /^api_error:([a-z_]+):([\s\S]*)$/.exec(error.message ?? '');
    if (m) throw new ApiError(m[1] as ApiErrorCode, m[2]);
    throw error;
}

// ── Materiales / Productos ──────────────────────────────────────────────────

export async function listMateriales(
    db: SupabaseClient, tenantId: string, kind: 'materiales' | 'productos',
    params: ListParams & { q?: string; categoria?: string },
): Promise<Page<MaterialDTO>> {
    let query = applyKind(scoped(db, 'materials', MATERIAL_API_COLUMNS, tenantId), kind);
    if (params.q) {
        const v = likeValue(params.q);
        query = query.or(`name.ilike.${v},internal_code.ilike.${v},serial_number.ilike.${v}`);
    }
    if (params.categoria) query = query.eq('category', params.categoria);
    const { rows, next_cursor } = await runPage<MaterialRow>(query, params);
    return { data: rows.map(toMaterialDTO), next_cursor };
}

export async function getMaterial(
    db: SupabaseClient, tenantId: string, kind: 'materiales' | 'productos', id: string,
): Promise<MaterialDTO> {
    const query = applyKind(scoped(db, 'materials', MATERIAL_API_COLUMNS, tenantId), kind).eq('id', id);
    return toMaterialDTO(await runOne<MaterialRow>(query, kind === 'productos' ? 'Producto' : 'Material'));
}

// ── Dónde está cada cosa (libro de stock por pañol × contrato) ─────────────

interface StockRow { material_id: string; warehouse_id: string | null; contract_id: string | null; qty: number | string }

async function namesById(db: SupabaseClient, tenantId: string, table: 'warehouses' | 'contracts', ids: string[]) {
    const map = new Map<string, RefDTO>();
    if (!ids.length) return map;
    const { data, error } = await scoped(db, table, 'id, name', tenantId).in('id', ids);
    if (error) throw error;
    for (const r of (data ?? []) as unknown as { id: string; name: string }[]) map.set(r.id, { id: r.id, nombre: r.name });
    return map;
}

async function stockRows(db: SupabaseClient, tenantId: string, materialIds: string[]): Promise<StockRow[]> {
    if (!materialIds.length) return [];
    const { data, error } = await scoped(db, 'material_stocks', 'material_id, warehouse_id, contract_id, qty', tenantId)
        .in('material_id', materialIds)
        .gt('qty', 0);
    if (error) throw error;
    return (data ?? []) as unknown as StockRow[];
}

/**
 * Pañol, contrato y responsable de cada activo de la página. Pañol y contrato
 * sólo se informan si las unidades están en UN solo lugar; repartidas en
 * varios, se consultan con `/materiales/{id}/existencias`.
 */
async function lugares(db: SupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, ActivoLugar>> {
    const out = new Map<string, ActivoLugar>();
    if (!ids.length) return out;

    const [stocks, holders] = await Promise.all([
        stockRows(db, tenantId, ids),
        db.rpc('api_asset_holders', { p_tenant_id: tenantId, p_ids: ids }),
    ]);
    if (holders.error) throw holders.error;

    const [panoles, contratos] = await Promise.all([
        namesById(db, tenantId, 'warehouses', [...new Set(stocks.map(s => s.warehouse_id).filter(Boolean) as string[])]),
        namesById(db, tenantId, 'contracts', [...new Set(stocks.map(s => s.contract_id).filter(Boolean) as string[])]),
    ]);

    const byMaterial = new Map<string, StockRow[]>();
    for (const s of stocks) byMaterial.set(s.material_id, [...(byMaterial.get(s.material_id) ?? []), s]);
    // Mientras está entregado, el desglose por contrato queda en cero: el contrato es el de la solicitud vigente.
    const holderBy = new Map<string, { name: string; contrato: RefDTO | null }>();
    for (const h of (holders.data ?? []) as { material_id: string; holder_name: string; contract_id?: string | null; contract_name?: string | null }[]) {
        holderBy.set(h.material_id, {
            name: h.holder_name,
            contrato: h.contract_id && h.contract_name ? { id: h.contract_id, nombre: h.contract_name } : null,
        });
    }

    for (const id of ids) {
        const rows = byMaterial.get(id) ?? [];
        const single = rows.length === 1 ? rows[0] : null;
        out.set(id, {
            panol: single?.warehouse_id ? panoles.get(single.warehouse_id) ?? null : null,
            contrato: (single?.contract_id ? contratos.get(single.contract_id) ?? null : null) ?? holderBy.get(id)?.contrato ?? null,
            responsable: holderBy.get(id)?.name ?? null,
        });
    }
    return out;
}

async function toActivos(db: SupabaseClient, tenantId: string, rows: MaterialRow[]): Promise<ActivoDTO[]> {
    const lugar = await lugares(db, tenantId, rows.map(r => r.id));
    return rows.map(r => toActivoDTO(r, lugar.get(r.id) ?? SIN_LUGAR));
}

export async function getExistencias(db: SupabaseClient, tenantId: string, materialId: string): Promise<ExistenciasDTO> {
    const mat = await runOne<{ id: string; stock: number | string | null }>(
        scoped(db, 'materials', 'id, stock', tenantId).eq('id', materialId), 'Material');
    const stocks = await stockRows(db, tenantId, [materialId]);
    const [panoles, contratos] = await Promise.all([
        namesById(db, tenantId, 'warehouses', [...new Set(stocks.map(s => s.warehouse_id).filter(Boolean) as string[])]),
        namesById(db, tenantId, 'contracts', [...new Set(stocks.map(s => s.contract_id).filter(Boolean) as string[])]),
    ]);
    return {
        material_id: mat.id,
        stock_actual: mat.stock === null ? null : Number(mat.stock),
        existencias: stocks.map(s => ({
            panol: s.warehouse_id ? panoles.get(s.warehouse_id) ?? null : null,
            contrato: s.contract_id ? contratos.get(s.contract_id) ?? null : null,
            cantidad: Number(s.qty),
        })),
    };
}

export async function listPanoles(db: SupabaseClient, tenantId: string): Promise<Page<PanolDTO>> {
    const { data, error } = await scoped(db, 'warehouses', 'id, name, location, status', tenantId).order('name');
    if (error) throw error;
    const rows = (data ?? []) as unknown as { id: string; name: string; location: string | null; status: string }[];

    const links = rows.length
        ? await scoped(db, 'warehouse_contracts', 'warehouse_id, contract_id', tenantId).in('warehouse_id', rows.map(r => r.id))
        : { data: [], error: null };
    if (links.error) throw links.error;
    const pairs = (links.data ?? []) as unknown as { warehouse_id: string; contract_id: string }[];
    const contratos = await namesById(db, tenantId, 'contracts', [...new Set(pairs.map(p => p.contract_id))]);

    return {
        data: rows.map(r => ({
            id: r.id,
            nombre: r.name,
            ubicacion: r.location?.trim() || null,
            activo: r.status === 'active',
            contratos: pairs.filter(p => p.warehouse_id === r.id).map(p => contratos.get(p.contract_id)).filter(Boolean) as RefDTO[],
        })),
        // Los pañoles de una empresa son pocos: una sola página.
        next_cursor: null,
    };
}

// ── Activos ─────────────────────────────────────────────────────────────────

export async function listActivos(
    db: SupabaseClient, tenantId: string,
    params: ListParams & { q?: string; estado?: ActivoEstado; material_id?: string; external_ref?: string },
): Promise<Page<ActivoDTO>> {
    let query = applyKind(scoped(db, 'materials', MATERIAL_API_COLUMNS, tenantId), 'activos');
    if (params.q) {
        const v = likeValue(params.q);
        query = query.or(`name.ilike.${v},internal_code.ilike.${v},serial_number.ilike.${v}`);
    }
    if (params.estado) query = applyEstado(query, params.estado);
    if (params.material_id) query = query.eq('catalog_material_id', params.material_id);
    if (params.external_ref) query = query.eq('external_ref', params.external_ref);
    const { rows, next_cursor } = await runPage<MaterialRow>(query, params);
    return { data: await toActivos(db, tenantId, rows), next_cursor };
}

export async function getActivo(db: SupabaseClient, tenantId: string, id: string): Promise<ActivoDTO> {
    const row = await runOne<MaterialRow>(applyKind(scoped(db, 'materials', MATERIAL_API_COLUMNS, tenantId), 'activos').eq('id', id), 'Activo');
    return (await toActivos(db, tenantId, [row]))[0];
}

/** Crea UNA unidad rastreable al recibirla (función api_create_asset: una transacción). */
export async function createActivo(
    db: SupabaseClient, tenantId: string, actor: string,
    body: {
        material_id: string; nombre?: string; proveedor_id?: string | null; valor_compra?: number | null;
        fecha_compra?: string; ubicacion?: string | null; panol_id?: string | null; external_ref: string;
    },
): Promise<WriteResult<ActivoDTO>> {
    const { data, error } = await db.rpc('api_create_asset', {
        p_tenant_id: tenantId,
        p_actor: actor,
        p_template_id: body.material_id,
        p_name: body.nombre ?? null,
        p_supplier_id: body.proveedor_id ?? null,
        p_unit_cost: body.valor_compra ?? null,
        p_acquired_on: body.fecha_compra ?? new Date().toISOString().slice(0, 10),
        p_location: body.ubicacion ?? null,
        p_warehouse_id: body.panol_id ?? null,
        p_external_ref: body.external_ref,
    });
    if (error) fromRpcError(error);
    const row = (data as { asset_id: string; created: boolean }[])[0];
    return { created: row.created, data: await getActivo(db, tenantId, row.asset_id) };
}

const ESTADO_A_STATUS: Record<'en_mantencion' | 'extraviado' | 'de_baja', string> = {
    en_mantencion: 'En Mantenimiento',
    extraviado: 'Extraviado',
    de_baja: 'Para Baja',
};

/** Cambia estado y/o ubicación. No toca stock: dar de baja es un estado, como en la app. */
export async function patchActivo(
    db: SupabaseClient, tenantId: string, id: string,
    body: { estado?: 'operativo' | 'en_mantencion' | 'extraviado' | 'de_baja'; ubicacion?: string | null },
): Promise<ActivoDTO> {
    const current = await runOne<MaterialRow>(
        applyKind(scoped(db, 'materials', MATERIAL_API_COLUMNS, tenantId), 'activos').eq('id', id), 'Activo');
    if (current.deleted_at) throw new ApiError('not_found', 'Activo no encontrado.');
    if (current.archived) throw new ApiError('conflict', 'El activo está archivado en Pagnol; se gestiona desde ahí.');

    const patch: Record<string, unknown> = {};
    if (body.estado) {
        // "Operativo" no le quita el préstamo a un activo que está en uso.
        patch.status = body.estado === 'operativo'
            ? (current.status === 'En Uso' ? 'En Uso' : 'Disponible')
            : ESTADO_A_STATUS[body.estado];
    }
    if (body.ubicacion !== undefined) patch.location = body.ubicacion?.trim() || null;

    const { data, error } = await db.from('materials').update(patch)
        .eq('tenant_id', tenantId).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new ApiError('not_found', 'Activo no encontrado.');
    return getActivo(db, tenantId, id);
}

// ── Compras esperadas ───────────────────────────────────────────────────────

const COMPRA_COLUMNS = 'id, external_ref, supplier_id, warehouse_id, estimated_date, contract_ref, canceled_at, created_at, updated_at';
const LINEA_COLUMNS = 'id, purchase_id, external_ref, material_id, expected_qty, unit_value, canceled_at, created_at';
const RECEPCION_COLUMNS = 'id, purchase_id, warehouse_id, guide_number, received_on, received_by, received_by_name, created_at';
// `*`: tolera que la columna `expected_qty` (migración 20261027010000) aún no exista.
const RECEPCION_LINEA_COLUMNS = '*';
// `*` también: tolera que la tabla de correcciones aún no exista (migración 20261028000000) en lecturas viejas.
const CORRECCION_COLUMNS = '*';

async function toCompras(db: SupabaseClient, tenantId: string, rows: CompraRow[]): Promise<CompraDTO[]> {
    if (!rows.length) return [];
    const { data: ls, error } = await scoped(db, 'expected_purchase_lines', LINEA_COLUMNS, tenantId)
        .in('purchase_id', rows.map(r => r.id))
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
    if (error) throw error;
    const lineas = (ls ?? []) as unknown as CompraLineaRow[];

    const matIds = [...new Set(lineas.map(l => l.material_id))];
    const mats = new Map<string, MaterialLite>();
    if (matIds.length) {
        const { data, error: e } = await scoped(db, 'materials', 'id, name, usage_type', tenantId).in('id', matIds);
        if (e) throw e;
        for (const m of (data ?? []) as unknown as MaterialLite[]) mats.set(m.id, m);
    }
    const supIds = [...new Set(rows.map(r => r.supplier_id).filter(Boolean) as string[])];
    const sups = new Map<string, RefDTO>();
    if (supIds.length) {
        const { data, error: e } = await scoped(db, 'suppliers', 'id, name', tenantId).in('id', supIds);
        if (e) throw e;
        for (const s of (data ?? []) as unknown as { id: string; name: string }[]) sups.set(s.id, { id: s.id, nombre: s.name });
    }
    const panoles = await namesById(db, tenantId, 'warehouses', [...new Set(rows.map(r => r.warehouse_id))]);

    // Lo recibido en Pagnol: hechos inmutables de los que sale la cantidad y el estado de cada línea.
    const { data: rs, error: rErr } = await scoped(db, 'expected_purchase_receipts', RECEPCION_COLUMNS, tenantId)
        .in('purchase_id', rows.map(r => r.id));
    if (rErr) throw rErr;
    const recepciones = (rs ?? []) as unknown as RecepcionRow[];
    let recepcionLineas: RecepcionLineaRow[] = [];
    let correcciones: RecepcionCorreccionRow[] = [];
    if (recepciones.length) {
        const { data: rls, error: lErr } = await scoped(db, 'expected_purchase_receipt_lines', RECEPCION_LINEA_COLUMNS, tenantId)
            .in('receipt_id', recepciones.map(r => r.id));
        if (lErr) throw lErr;
        recepcionLineas = (rls ?? []) as unknown as RecepcionLineaRow[];
        correcciones = await correccionesDe(db, tenantId, recepcionLineas.map(x => x.id));
    }

    return rows.map(r => toCompraDTO(r, lineas, {
        materiales: mats,
        proveedor: r.supplier_id ? sups.get(r.supplier_id) ?? null : null,
        panol: panoles.get(r.warehouse_id) ?? { id: r.warehouse_id, nombre: '' },
        recepciones,
        recepcionLineas,
        correcciones,
    }));
}

/** Correcciones de un conjunto de líneas de recepción. Si la tabla aún no existe (migración sin aplicar), no hay correcciones. */
async function correccionesDe(db: SupabaseClient, tenantId: string, receiptLineIds: string[]): Promise<RecepcionCorreccionRow[]> {
    const out: RecepcionCorreccionRow[] = [];
    for (let i = 0; i < receiptLineIds.length; i += BY_IDS_CHUNK) {
        const { data, error } = await scoped(db, 'expected_purchase_receipt_corrections', CORRECCION_COLUMNS, tenantId)
            .in('receipt_line_id', receiptLineIds.slice(i, i + BY_IDS_CHUNK));
        if (error) {
            if ((error as { code?: string }).code === 'PGRST205' || (error as { code?: string }).code === '42P01') return [];
            throw error;
        }
        out.push(...((data ?? []) as unknown as RecepcionCorreccionRow[]));
    }
    return out;
}

export async function listCompras(
    db: SupabaseClient, tenantId: string,
    params: ListParams & { external_ref?: string },
): Promise<Page<CompraDTO>> {
    let query = scoped(db, 'expected_purchases', COMPRA_COLUMNS, tenantId);
    if (params.external_ref) query = query.eq('external_ref', params.external_ref);
    const { rows, next_cursor } = await runPage<CompraRow>(query, params);
    return { data: await toCompras(db, tenantId, rows), next_cursor };
}

export async function getCompra(db: SupabaseClient, tenantId: string, id: string): Promise<CompraDTO> {
    const row = await runOne<CompraRow>(scoped(db, 'expected_purchases', COMPRA_COLUMNS, tenantId).eq('id', id), 'Compra esperada');
    return (await toCompras(db, tenantId, [row]))[0];
}

/** Anuncia una compra con sus líneas (función api_create_expected_purchase: una transacción). */
export async function createCompra(
    db: SupabaseClient, tenantId: string, actor: string,
    body: {
        external_ref: string; proveedor_id?: string | null; panol_id: string; fecha_estimada?: string | null;
        contrato_ref?: string | null; lineas: { external_ref: string; material_id: string; cantidad: number }[];
    },
): Promise<WriteResult<CompraDTO>> {
    const { data, error } = await db.rpc('api_create_expected_purchase', {
        p_tenant_id: tenantId,
        p_actor: actor,
        p_external_ref: body.external_ref,
        p_supplier_id: body.proveedor_id ?? null,
        p_warehouse_id: body.panol_id,
        p_date: body.fecha_estimada ?? null,
        p_contract_ref: body.contrato_ref ?? null,
        p_lines: body.lineas,
    });
    if (error) fromRpcError(error);
    const row = (data as { purchase_id: string; created: boolean }[])[0];
    return { created: row.created, data: await getCompra(db, tenantId, row.purchase_id) };
}

/** Corrige o cancela. Sólo viaja lo que cambia: un `null` explícito borra el valor. */
export async function patchCompra(
    db: SupabaseClient, tenantId: string, id: string,
    body: { fecha_estimada?: string | null; panol_id?: string; contrato_ref?: string | null; cancelar?: true; lineas?: { external_ref: string; cantidad?: number; cancelar?: true }[] },
): Promise<CompraDTO> {
    const { error } = await db.rpc('api_patch_expected_purchase', { p_tenant_id: tenantId, p_id: id, p_patch: body });
    if (error) fromRpcError(error);
    return getCompra(db, tenantId, id);
}

// ── Movimientos de stock (consumibles) ──────────────────────────────────────

/** Ingreso de stock de un consumible, o reverso de un ingreso (api_stock_entry: una transacción). */
export async function createMovimiento(
    db: SupabaseClient, tenantId: string, actor: string,
    body:
        | { tipo: 'ingreso'; material_id: string; cantidad: number; fecha?: string; panol_id?: string | null; external_ref: string }
        | { tipo: 'reverso'; external_ref: string },
): Promise<WriteResult<MovimientoDTO>> {
    const ingreso = body.tipo === 'ingreso' ? body : null;
    const { data, error } = await db.rpc('api_stock_entry', {
        p_tenant_id: tenantId,
        p_actor: actor,
        p_kind: body.tipo,
        p_material_id: ingreso?.material_id ?? null,
        p_qty: ingreso?.cantidad ?? null,
        p_moved_at: ingreso?.fecha ?? null,
        p_warehouse_id: ingreso?.panol_id ?? null,
        p_external_ref: body.external_ref,
    });
    if (error) fromRpcError(error);
    const row = (data as { movement_id: string; created: boolean; material_id: string; stock: number | string }[])[0];

    // La cantidad se lee del kardex: en una repetición idempotente no viene en el cuerpo.
    const mov = await runOne<{ quantity_change: number | string }>(
        scoped(db, 'stock_movements', 'quantity_change', tenantId).eq('id', row.movement_id), 'Movimiento');
    return {
        created: row.created,
        data: {
            id: row.movement_id,
            tipo: body.tipo,
            material_id: row.material_id,
            cantidad: Math.abs(Number(mov.quantity_change)),
            stock_actual: Number(row.stock),
            external_ref: body.external_ref,
        },
    };
}

// ── Proveedores ─────────────────────────────────────────────────────────────

export async function listProveedores(
    db: SupabaseClient, tenantId: string,
    params: ListParams & { q?: string; rut?: string },
): Promise<Page<ProveedorDTO>> {
    let query = scoped(db, 'suppliers', SUPPLIER_API_COLUMNS, tenantId);
    if (params.q) {
        const v = likeValue(params.q);
        query = query.or(`name.ilike.${v},rut.ilike.${v}`);
    }
    if (params.rut) {
        const variants = rutVariants(params.rut);
        if (!variants.length) throw new ApiError('validation_error', 'El parámetro `rut` no es un RUT válido.', { param: 'rut' });
        query = query.in('rut', variants);
    }
    const { rows, next_cursor } = await runPage<SupplierRow>(query, params);
    return { data: rows.map(toProveedorDTO), next_cursor };
}

export async function getProveedor(db: SupabaseClient, tenantId: string, id: string): Promise<ProveedorDTO> {
    return toProveedorDTO(await runOne<SupplierRow>(scoped(db, 'suppliers', SUPPLIER_API_COLUMNS, tenantId).eq('id', id), 'Proveedor'));
}

// ── Lecturas por lote (las usa el despachador de webhooks para armar eventos) ─

const BY_IDS_CHUNK = 100;

async function rowsByIds<R>(
    db: SupabaseClient, tenantId: string, table: string, columns: string, ids: string[],
    narrow: (q: Query) => Query = q => q,
): Promise<R[]> {
    const out: R[] = [];
    for (let i = 0; i < ids.length; i += BY_IDS_CHUNK) {
        const { data, error } = await narrow(scoped(db, table, columns, tenantId)).in('id', ids.slice(i, i + BY_IDS_CHUNK));
        if (error) throw error;
        out.push(...((data ?? []) as unknown as R[]));
    }
    return out;
}

/** Los que no existen en la empresa (o no pertenecen al recurso) simplemente no vienen. */
export async function materialesByIds(db: SupabaseClient, tenantId: string, kind: 'materiales' | 'productos', ids: string[]): Promise<MaterialDTO[]> {
    const rows = await rowsByIds<MaterialRow>(db, tenantId, 'materials', MATERIAL_API_COLUMNS, ids, q => applyKind(q, kind));
    return rows.map(toMaterialDTO);
}

/** `data` de `compra.recibida`, una por línea recibida (los ids son los de `expected_purchase_receipt_lines`). */
export async function comprasRecibidasByIds(db: SupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, CompraRecibidaDTO>> {
    const out = new Map<string, CompraRecibidaDTO>();
    if (!ids.length) return out;
    const mine = await rowsByIds<RecepcionLineaRow>(db, tenantId, 'expected_purchase_receipt_lines', RECEPCION_LINEA_COLUMNS, ids);
    if (!mine.length) return out;

    const lineIds = [...new Set(mine.map(m => m.line_id))];
    const lineas = await rowsByIds<CompraLineaRow>(db, tenantId, 'expected_purchase_lines', LINEA_COLUMNS, lineIds);
    // Para la acumulada hacen falta TODAS las recepciones de esas líneas, no sólo las del evento.
    const todas: RecepcionLineaRow[] = [];
    for (let i = 0; i < lineIds.length; i += BY_IDS_CHUNK) {
        const { data, error } = await scoped(db, 'expected_purchase_receipt_lines', RECEPCION_LINEA_COLUMNS, tenantId)
            .in('line_id', lineIds.slice(i, i + BY_IDS_CHUNK));
        if (error) throw error;
        todas.push(...((data ?? []) as unknown as RecepcionLineaRow[]));
    }
    const recepciones = await rowsByIds<RecepcionRow>(db, tenantId, 'expected_purchase_receipts', RECEPCION_COLUMNS, [...new Set(todas.map(t => t.receipt_id))]);
    const compras = await rowsByIds<CompraRow>(db, tenantId, 'expected_purchases', COMPRA_COLUMNS, [...new Set(lineas.map(l => l.purchase_id))]);
    const mats = await rowsByIds<{ id: string; name: string }>(db, tenantId, 'materials', 'id, name', [...new Set(lineas.map(l => l.material_id))]);
    const panoles = await namesById(db, tenantId, 'warehouses', [...new Set(recepciones.map(r => r.warehouse_id ?? '').filter(Boolean))]);

    const correcciones = await correccionesDe(db, tenantId, todas.map(t => t.id));
    const byId = <T extends { id: string }>(l: T[]) => new Map(l.map(x => [x.id, x]));
    const lineaBy = byId(lineas), recBy = byId(recepciones), compraBy = byId(compras), matBy = byId(mats);
    for (const m of mine) {
        const linea = lineaBy.get(m.line_id), recepcion = recBy.get(m.receipt_id);
        const compra = linea ? compraBy.get(linea.purchase_id) : undefined;
        const material = linea ? matBy.get(linea.material_id) : undefined;
        if (!linea || !recepcion || !compra || !material) continue;
        const wid = recepcion.warehouse_id ?? compra.warehouse_id;
        out.set(m.id, toCompraRecibidaDTO({
            compra, recepcion, recepcionLinea: m, linea, material,
            deLaLinea: todas.filter(t => t.line_id === m.line_id),
            correcciones,
            panol: panoles.get(wid) ?? { id: wid, nombre: '' },
        }));
    }
    return out;
}

/** `data` de `compra.recepcion_corregida`, una por corrección (los ids son los de `expected_purchase_receipt_corrections`). */
export async function comprasCorregidasByIds(db: SupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, CompraRecepcionCorregidaDTO>> {
    const out = new Map<string, CompraRecepcionCorregidaDTO>();
    if (!ids.length) return out;
    const mine = await rowsByIds<RecepcionCorreccionRow>(db, tenantId, 'expected_purchase_receipt_corrections', CORRECCION_COLUMNS, ids);
    if (!mine.length) return out;

    const receiptLines = await rowsByIds<RecepcionLineaRow>(db, tenantId, 'expected_purchase_receipt_lines', RECEPCION_LINEA_COLUMNS, [...new Set(mine.map(m => m.receipt_line_id))]);
    const lineIds = [...new Set(receiptLines.map(r => r.line_id))];
    const lineas = await rowsByIds<CompraLineaRow>(db, tenantId, 'expected_purchase_lines', LINEA_COLUMNS, lineIds);
    // Para la acumulada neta: todas las recepciones de esas líneas y todas las correcciones de ellas.
    const todas: RecepcionLineaRow[] = [];
    for (let i = 0; i < lineIds.length; i += BY_IDS_CHUNK) {
        const { data, error } = await scoped(db, 'expected_purchase_receipt_lines', RECEPCION_LINEA_COLUMNS, tenantId)
            .in('line_id', lineIds.slice(i, i + BY_IDS_CHUNK));
        if (error) throw error;
        todas.push(...((data ?? []) as unknown as RecepcionLineaRow[]));
    }
    const correcciones = await correccionesDe(db, tenantId, todas.map(t => t.id));
    const recepciones = await rowsByIds<RecepcionRow>(db, tenantId, 'expected_purchase_receipts', RECEPCION_COLUMNS, [...new Set(receiptLines.map(r => r.receipt_id))]);
    const compras = await rowsByIds<CompraRow>(db, tenantId, 'expected_purchases', COMPRA_COLUMNS, [...new Set(lineas.map(l => l.purchase_id))]);
    const mats = await rowsByIds<{ id: string; name: string }>(db, tenantId, 'materials', 'id, name', [...new Set(lineas.map(l => l.material_id))]);
    const panoles = await namesById(db, tenantId, 'warehouses', [...new Set(recepciones.map(r => r.warehouse_id ?? '').filter(Boolean))]);

    const byId = <T extends { id: string }>(l: T[]) => new Map(l.map(x => [x.id, x]));
    const rlBy = byId(receiptLines), lineaBy = byId(lineas), recBy = byId(recepciones), compraBy = byId(compras), matBy = byId(mats);
    for (const c of mine) {
        const rl = rlBy.get(c.receipt_line_id);
        const linea = rl ? lineaBy.get(rl.line_id) : undefined;
        const recepcion = rl ? recBy.get(rl.receipt_id) : undefined;
        const compra = linea ? compraBy.get(linea.purchase_id) : undefined;
        const material = linea ? matBy.get(linea.material_id) : undefined;
        if (!rl || !linea || !recepcion || !compra || !material) continue;
        const wid = recepcion.warehouse_id ?? compra.warehouse_id;
        out.set(c.id, toCompraRecepcionCorregidaDTO({
            compra, recepcion, correccion: c, linea, material,
            deLaLinea: todas.filter(t => t.line_id === rl.line_id),
            correcciones,
            panol: panoles.get(wid) ?? { id: wid, nombre: '' },
        }));
    }
    return out;
}

const SOLICITUD_COLUMNS = 'id, batch_id, internal_code, material_name, item_description, quantity, unit, category, request_type, justification, supervisor_id, requester_name, contract_id, contract_name, area, urgency, urgency_reason, needed_by, status, rejection_reason, adc_authorized_at, adc_authorized_by, ops_reviewed_by, ops_reviewed_by_name, created_at';

/**
 * `data` de los eventos `solicitud_compra.*`. El id del evento es el de la solicitud: el `batch_id` de
 * sus líneas, o el id de la fila si va sola. Se arma con el estado de AHORA (como el resto de recursos).
 */
export async function solicitudesCompraByIds(db: SupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, SolicitudCompraDTO>> {
    const out = new Map<string, SolicitudCompraDTO>();
    const rows: SolicitudRow[] = [];
    for (let i = 0; i < ids.length; i += BY_IDS_CHUNK) {
        const list = ids.slice(i, i + BY_IDS_CHUNK).join(',');
        const { data, error } = await scoped(db, 'purchase_requests', SOLICITUD_COLUMNS, tenantId)
            .or(`id.in.(${list}),batch_id.in.(${list})`)
            .neq('request_target', 'client')
            .is('rental_request_id', null);
        if (error) throw error;
        rows.push(...((data ?? []) as unknown as SolicitudRow[]));
    }
    if (!rows.length) return out;

    const userIds = [...new Set(rows.flatMap(r => [r.adc_authorized_by, r.ops_reviewed_by, r.supervisor_id]).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    for (let i = 0; i < userIds.length; i += BY_IDS_CHUNK) {
        const { data, error } = await scoped(db, 'profiles', 'id, name', tenantId).in('id', userIds.slice(i, i + BY_IDS_CHUNK));
        if (error) throw error;
        for (const p of (data ?? []) as unknown as { id: string; name: string | null }[]) names.set(p.id, p.name ?? '');
    }
    for (const id of ids) {
        const mine = rows.filter(r => (r.batch_id ?? r.id) === id);
        if (mine.length) out.set(id, toSolicitudCompraDTO(id, mine, names));
    }
    return out;
}

export async function activosByIds(db: SupabaseClient, tenantId: string, ids: string[]): Promise<ActivoDTO[]> {
    const rows = await rowsByIds<MaterialRow>(db, tenantId, 'materials', MATERIAL_API_COLUMNS, ids, q => applyKind(q, 'activos'));
    return toActivos(db, tenantId, rows);
}

export async function proveedoresByIds(db: SupabaseClient, tenantId: string, ids: string[]): Promise<ProveedorDTO[]> {
    return (await rowsByIds<SupplierRow>(db, tenantId, 'suppliers', SUPPLIER_API_COLUMNS, ids)).map(toProveedorDTO);
}

// ── Webhooks (suscripciones) ────────────────────────────────────────────────

export const MAX_WEBHOOKS_PER_TENANT = 10;

interface WebhookRow {
    id: string; tenant_id: string; url: string; events: string[]; description: string | null;
    active: boolean; created_at: string;
}
const WEBHOOK_COLUMNS = 'id, tenant_id, url, events, description, active, created_at';

function toWebhookDTO(r: WebhookRow): WebhookDTO {
    return {
        id: r.id,
        url: r.url,
        events: r.events as WebhookDTO['events'],
        descripcion: r.description,
        activo: r.active,
        organization_id: r.tenant_id,
        created_at: new Date(r.created_at).toISOString(),
    };
}

/** Las suscripciones de una empresa son pocas: una sola página. El secreto nunca sale en un listado. */
export async function listWebhooks(db: SupabaseClient, tenantId: string): Promise<Page<WebhookDTO>> {
    const { data, error } = await scoped(db, 'webhook_subscriptions', WEBHOOK_COLUMNS, tenantId).order('created_at', { ascending: true });
    if (error) throw error;
    return { data: ((data ?? []) as unknown as WebhookRow[]).map(toWebhookDTO), next_cursor: null };
}

/** Registra un webhook y devuelve su secreto, que no vuelve a mostrarse. */
export async function createWebhook(
    db: SupabaseClient, tenantId: string, apiKeyId: string,
    body: { url: string; events: WebhookDTO['events']; descripcion?: string | null },
): Promise<WebhookCreatedDTO> {
    const { data: existing, error: listErr } = await scoped(db, 'webhook_subscriptions', 'id, url', tenantId);
    if (listErr) throw listErr;
    const rows = (existing ?? []) as unknown as { id: string; url: string }[];
    const dup = rows.find(r => r.url === body.url);
    if (dup) throw new ApiError('conflict', 'Ya hay un webhook registrado con esa URL.', { webhook_id: dup.id });
    if (rows.length >= MAX_WEBHOOKS_PER_TENANT) {
        throw new ApiError('conflict', `Se alcanzó el máximo de ${MAX_WEBHOOKS_PER_TENANT} webhooks. Elimina alguno con DELETE /webhooks/{id}.`);
    }

    const row: WebhookRow & { secret: string; api_key_id: string } = {
        id: randomUUID(),
        tenant_id: tenantId,
        api_key_id: apiKeyId,
        url: body.url,
        secret: generateWebhookSecret(),
        events: body.events,
        description: body.descripcion ?? null,
        active: true,
        created_at: new Date().toISOString(),
    };
    const { error } = await db.from('webhook_subscriptions').insert(row);
    if (error) {
        // Otra petición registró la misma URL entre la lectura y la escritura.
        if ((error as { code?: string }).code === '23505') throw new ApiError('conflict', 'Ya hay un webhook registrado con esa URL.');
        throw error;
    }
    return { ...toWebhookDTO(row), secret: row.secret };
}

/** A quién se le puede entregar hoy (suscripciones activas) y qué eventos escucha cada una. */
export async function activeWebhookTargets(db: SupabaseClient, tenantId: string): Promise<{ id: string; events: string[] }[]> {
    const { data, error } = await scoped(db, 'webhook_subscriptions', 'id, events', tenantId).eq('active', true);
    if (error) throw error;
    return (data ?? []) as unknown as { id: string; events: string[] }[];
}

/** Cambia url / eventos / descripción / pausa. El secreto de firma NO cambia: esa es la razón de que exista. */
export async function patchWebhook(
    db: SupabaseClient, tenantId: string, id: string,
    body: { url?: string; events?: WebhookDTO['events']; descripcion?: string | null; activo?: boolean },
): Promise<WebhookDTO> {
    const current = await runOne<WebhookRow>(scoped(db, 'webhook_subscriptions', WEBHOOK_COLUMNS, tenantId).eq('id', id), 'Webhook');
    if (body.url !== undefined && body.url !== current.url) {
        const { data: same, error: e } = await scoped(db, 'webhook_subscriptions', 'id', tenantId).eq('url', body.url);
        if (e) throw e;
        if ((same ?? []).length) throw new ApiError('conflict', 'Ya hay un webhook registrado con esa URL.');
    }
    const patch: Record<string, unknown> = {};
    if (body.url !== undefined) patch.url = body.url;
    if (body.events !== undefined) patch.events = body.events;
    if (body.descripcion !== undefined) patch.description = body.descripcion;
    if (body.activo !== undefined) patch.active = body.activo;

    const { data, error } = await db.from('webhook_subscriptions').update(patch)
        .eq('tenant_id', tenantId).eq('id', id).select(WEBHOOK_COLUMNS);
    if (error) {
        if ((error as { code?: string }).code === '23505') throw new ApiError('conflict', 'Ya hay un webhook registrado con esa URL.');
        throw error;
    }
    if (!data?.length) throw new ApiError('not_found', 'Webhook no encontrado.');
    return toWebhookDTO((data as unknown as WebhookRow[])[0]);
}

export async function deleteWebhook(db: SupabaseClient, tenantId: string, id: string): Promise<void> {
    const { data, error } = await db.from('webhook_subscriptions').delete()
        .eq('tenant_id', tenantId).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new ApiError('not_found', 'Webhook no encontrado.');
}
