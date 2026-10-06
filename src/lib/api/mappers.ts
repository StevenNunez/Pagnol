import type { ActivoDTO, ActivoEstado, MaterialDTO, ProveedorDTO, RefDTO } from './schemas';

// Fila de Postgres → DTO público. Funciones puras: se testean sin Supabase.
//
// En Pagnol no hay tablas separadas de productos y activos: todo el inventario
// vive en `materials`, y `usage_type` dice qué es cada fila. La API lo parte así:
//   /activos    → los que tienen identidad propia y se rastrean (ACTIVO_USAGE_TYPES)
//   /productos  → consumibles y repuestos (se compran por cantidad; también los sin tipo)
//   /materiales → el catálogo completo

// Debe coincidir con public.api_is_trackable() (migración 20261006000000).
export const ACTIVO_USAGE_TYPES = ['Activo Fijo', 'IT Controlado', 'Herramienta Menor', 'Reutilizable Controlado'] as const;

export function isRastreable(usageType: string | null | undefined): boolean {
    return (ACTIVO_USAGE_TYPES as readonly string[]).includes(usageType ?? '');
}
export const PRODUCTO_USAGE_TYPES = ['Consumible', 'Repuesto Crítico'] as const;

/** Columnas de `materials` que leen los endpoints (nunca `*`: el DTO no debe depender de columnas nuevas). */
export const MATERIAL_API_COLUMNS =
    'id, name, internal_code, serial_number, description, category, unit, stock, min_stock, archived, deleted_at, ' +
    'usage_type, ownership, supplier_id, status, location, unit_cost, acquisition_date, catalog_material_id, external_ref, updated_at';

export const SUPPLIER_API_COLUMNS = 'id, rut, name, email, phone, deleted_at, updated_at';

export interface MaterialRow {
    id: string;
    name: string;
    internal_code: string | null;
    serial_number: string | null;
    description: string | null;
    category: string | null;
    unit: string | null;
    stock: number | string | null;
    min_stock: number | string | null;
    archived: boolean | null;
    deleted_at: string | null;
    usage_type: string | null;
    ownership: string | null;
    supplier_id: string | null;
    status: string | null;
    location: string | null;
    unit_cost: number | string | null;
    acquisition_date: string | null;
    catalog_material_id: string | null;
    external_ref: string | null;
    updated_at: string;
}

export interface SupplierRow {
    id: string;
    rut: string | null;
    name: string;
    email: string | null;
    phone: string | null;
    deleted_at: string | null;
    updated_at: string;
}

/** Texto vacío o sólo espacios cuenta como ausente. */
function text(v: string | null | undefined): string | null {
    const t = v?.trim();
    return t ? t : null;
}

/** `numeric` llega como string desde PostgREST cuando no cabe en un double; se normaliza a número. */
function num(v: number | string | null | undefined): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

function iso(ts: string): string {
    return new Date(ts).toISOString();
}

/** Mismo criterio que la etiqueta QR (`pagnol/hardware/label-printing`). */
export function materialCodigo(row: Pick<MaterialRow, 'id' | 'internal_code' | 'serial_number'>): string {
    return text(row.internal_code) ?? text(row.serial_number) ?? row.id;
}

function isVigente(row: Pick<MaterialRow, 'archived' | 'deleted_at'>): boolean {
    return !row.archived && !row.deleted_at;
}

export function toMaterialDTO(row: MaterialRow): MaterialDTO {
    return {
        id: row.id,
        codigo: materialCodigo(row),
        nombre: row.name,
        descripcion: text(row.description),
        categoria: text(row.category),
        unidad_medida: text(row.unit) ?? 'Unidad',
        stock_actual: num(row.stock),
        stock_minimo: num(row.min_stock),
        activo: isVigente(row),
        rastreable: isRastreable(row.usage_type),
        tipo_uso: text(row.usage_type),
        updated_at: iso(row.updated_at),
    };
}

export function activoEstado(row: Pick<MaterialRow, 'status' | 'archived' | 'deleted_at'>): ActivoEstado {
    if (!isVigente(row)) return 'de_baja';
    switch (row.status) {
        case 'En Mantenimiento': return 'en_mantencion';
        case 'Para Baja': return 'de_baja';
        case 'Extraviado': return 'extraviado';
        default: return 'operativo'; // 'Disponible', 'En Uso' o sin estado
    }
}

/** Dónde está un activo: lo calcula queries.ts desde el libro de stock y las entregas. */
export interface ActivoLugar {
    panol: RefDTO | null;
    contrato: RefDTO | null;
    responsable: string | null;
}

export const SIN_LUGAR: ActivoLugar = { panol: null, contrato: null, responsable: null };

export function toActivoDTO(row: MaterialRow, lugar: ActivoLugar = SIN_LUGAR): ActivoDTO {
    return {
        id: row.id,
        codigo: materialCodigo(row),
        nombre: row.name,
        material_id: row.catalog_material_id ?? null,
        proveedor_id: row.supplier_id ?? null,
        estado: activoEstado(row),
        ubicacion: text(row.location),
        panol: lugar.panol,
        contrato: lugar.contrato,
        responsable: lugar.responsable,
        valor_compra: num(row.unit_cost),
        fecha_compra: row.acquisition_date ? row.acquisition_date.slice(0, 10) : null,
        external_ref: text(row.external_ref),
        updated_at: iso(row.updated_at),
    };
}

export function toProveedorDTO(row: SupplierRow): ProveedorDTO {
    return {
        id: row.id,
        rut: text(row.rut),
        razon_social: row.name,
        nombre_fantasia: null,
        email: text(row.email),
        telefono: text(row.phone),
        activo: !row.deleted_at,
        updated_at: iso(row.updated_at),
    };
}

/**
 * Variantes con que puede estar guardado un RUT ("76.111.222-3", "76111222-3",
 * "761112223"), para buscar por igualdad sin depender del formato del dato.
 */
export function rutVariants(input: string): string[] {
    const clean = input.replace(/[.\s-]/g, '').toUpperCase();
    if (!/^\d{1,9}[0-9K]$/.test(clean)) return [];
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1);
    const dotted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const variants = new Set([`${dotted}-${dv}`, `${body}-${dv}`, clean]);
    if (dv === 'K') for (const v of [...variants]) variants.add(v.replace(/K$/, 'k'));
    return [...variants];
}
