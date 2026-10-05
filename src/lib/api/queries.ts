import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './errors';
import { afterCursorFilter, decodeCursor, paginate } from './pagination';
import {
    ACTIVO_USAGE_TYPES, MATERIAL_API_COLUMNS, PRODUCTO_USAGE_TYPES, SUPPLIER_API_COLUMNS,
    rutVariants, toActivoDTO, toMaterialDTO, toProveedorDTO,
    type MaterialRow, type SupplierRow,
} from './mappers';
import type { ActivoDTO, ActivoEstado, MaterialDTO, ProveedorDTO } from './schemas';

// Acceso a datos de la API pública. Corre con el cliente service role (sin
// RLS), así que el aislamiento entre empresas depende de que TODA consulta
// nazca de `scoped()`, que fija `tenant_id` antes que cualquier otro filtro.
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

async function runPage<R extends { id: string; updated_at: string }, T>(
    query: Query,
    params: ListParams,
    map: (row: R) => T,
): Promise<Page<T>> {
    if (params.updated_since) query = query.gte('updated_at', params.updated_since);
    if (params.cursor) query = query.or(afterCursorFilter(decodeCursor(params.cursor)));
    const { data, error } = await query
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(params.limit + 1);
    if (error) throw error;
    const { page, next_cursor } = paginate((data ?? []) as unknown as R[], params.limit);
    return { data: page.map(map), next_cursor };
}

async function runOne<R, T>(query: Query, map: (row: R) => T, what: string): Promise<T> {
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    // Una fila de otra empresa responde igual que una inexistente: 404, nunca 403.
    if (!data) throw new ApiError('not_found', `${what} no encontrado.`);
    return map(data as unknown as R);
}

// ── Materiales / Productos ──────────────────────────────────────────────────

export function listMateriales(
    db: SupabaseClient, tenantId: string, kind: 'materiales' | 'productos',
    params: ListParams & { q?: string; categoria?: string },
): Promise<Page<MaterialDTO>> {
    let query = applyKind(scoped(db, 'materials', MATERIAL_API_COLUMNS, tenantId), kind);
    if (params.q) {
        const v = likeValue(params.q);
        query = query.or(`name.ilike.${v},internal_code.ilike.${v},serial_number.ilike.${v}`);
    }
    if (params.categoria) query = query.eq('category', params.categoria);
    return runPage<MaterialRow, MaterialDTO>(query, params, toMaterialDTO);
}

export function getMaterial(
    db: SupabaseClient, tenantId: string, kind: 'materiales' | 'productos', id: string,
): Promise<MaterialDTO> {
    const query = applyKind(scoped(db, 'materials', MATERIAL_API_COLUMNS, tenantId), kind).eq('id', id);
    return runOne<MaterialRow, MaterialDTO>(query, toMaterialDTO, kind === 'productos' ? 'Producto' : 'Material');
}

// ── Activos ─────────────────────────────────────────────────────────────────

export async function listActivos(
    db: SupabaseClient, tenantId: string,
    params: ListParams & { q?: string; estado?: ActivoEstado; material_id?: string },
): Promise<Page<ActivoDTO>> {
    // Pagnol aún no relaciona un activo con un ítem de catálogo distinto de sí
    // mismo (`material_id` es siempre null), así que filtrar por él no calza nada.
    if (params.material_id) return { data: [], next_cursor: null };

    let query = applyKind(scoped(db, 'materials', MATERIAL_API_COLUMNS, tenantId), 'activos');
    if (params.q) {
        const v = likeValue(params.q);
        query = query.or(`name.ilike.${v},internal_code.ilike.${v},serial_number.ilike.${v}`);
    }
    if (params.estado) query = applyEstado(query, params.estado);
    return runPage<MaterialRow, ActivoDTO>(query, params, toActivoDTO);
}

export function getActivo(db: SupabaseClient, tenantId: string, id: string): Promise<ActivoDTO> {
    const query = applyKind(scoped(db, 'materials', MATERIAL_API_COLUMNS, tenantId), 'activos').eq('id', id);
    return runOne<MaterialRow, ActivoDTO>(query, toActivoDTO, 'Activo');
}

// ── Proveedores ─────────────────────────────────────────────────────────────

export function listProveedores(
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
    return runPage<SupplierRow, ProveedorDTO>(query, params, toProveedorDTO);
}

export function getProveedor(db: SupabaseClient, tenantId: string, id: string): Promise<ProveedorDTO> {
    const query = scoped(db, 'suppliers', SUPPLIER_API_COLUMNS, tenantId).eq('id', id);
    return runOne<SupplierRow, ProveedorDTO>(query, toProveedorDTO, 'Proveedor');
}
