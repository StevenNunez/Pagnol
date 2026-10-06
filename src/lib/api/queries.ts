import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type ApiErrorCode } from './errors';
import { afterCursorFilter, decodeCursor, paginate } from './pagination';
import {
    ACTIVO_USAGE_TYPES, MATERIAL_API_COLUMNS, PRODUCTO_USAGE_TYPES, SIN_LUGAR, SUPPLIER_API_COLUMNS,
    rutVariants, toActivoDTO, toMaterialDTO, toProveedorDTO,
    type ActivoLugar, type MaterialRow, type SupplierRow,
} from './mappers';
import type {
    ActivoDTO, ActivoEstado, ExistenciasDTO, MaterialDTO, MovimientoDTO, PanolDTO, ProveedorDTO, RefDTO,
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
    const holderBy = new Map<string, string>();
    for (const h of (holders.data ?? []) as { material_id: string; holder_name: string }[]) holderBy.set(h.material_id, h.holder_name);

    for (const id of ids) {
        const rows = byMaterial.get(id) ?? [];
        const single = rows.length === 1 ? rows[0] : null;
        out.set(id, {
            panol: single?.warehouse_id ? panoles.get(single.warehouse_id) ?? null : null,
            contrato: single?.contract_id ? contratos.get(single.contract_id) ?? null : null,
            responsable: holderBy.get(id) ?? null,
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
