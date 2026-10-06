// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { activoEstado, materialCodigo, rutVariants, toActivoDTO, toMaterialDTO, toProveedorDTO, type MaterialRow } from './mappers';
import { afterCursorFilter, decodeCursor, encodeCursor, paginate } from './pagination';
import { ActivoSchema, MaterialSchema, ProveedorSchema } from './schemas';
import { getOpenApiDocument } from './openapi';
import { ApiError } from './errors';

const row = (over: Partial<MaterialRow> = {}): MaterialRow => ({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Taladro Bosch',
    internal_code: 'VALAR-ACT-0042',
    serial_number: 'SN-1',
    description: null,
    category: 'Herramientas',
    unit: 'Unidad',
    stock: '1',
    min_stock: null,
    archived: false,
    deleted_at: null,
    usage_type: 'Herramienta Menor',
    ownership: 'propio',
    supplier_id: null,
    status: 'Disponible',
    location: ' ',
    unit_cost: 125000,
    acquisition_date: '2026-03-01',
    catalog_material_id: null,
    external_ref: null,
    updated_at: '2026-06-28T17:01:09.320138+00:00',
    ...over,
});

describe('mappers', () => {
    it('el código sigue el mismo orden que la etiqueta QR', () => {
        expect(materialCodigo(row())).toBe('VALAR-ACT-0042');
        expect(materialCodigo(row({ internal_code: '  ' }))).toBe('SN-1');
        expect(materialCodigo(row({ internal_code: null, serial_number: null }))).toBe(row().id);
    });

    it('material: numeric en string pasa a número, vacíos a null, archivado = inactivo', () => {
        const dto = toMaterialDTO(row({ archived: true }));
        expect(dto.stock_actual).toBe(1);
        expect(dto.stock_minimo).toBeNull();
        expect(dto.activo).toBe(false);
        expect(dto.rastreable).toBe(true);
        expect(dto.tipo_uso).toBe('Herramienta Menor');
        expect(toMaterialDTO(row({ usage_type: 'Consumible' })).rastreable).toBe(false);
        expect(toMaterialDTO(row({ usage_type: null })).rastreable).toBe(false);
        expect(dto.updated_at).toBe('2026-06-28T17:01:09.320Z');
        expect(MaterialSchema.parse(dto)).toEqual(dto);
    });

    it('estado del activo', () => {
        expect(activoEstado(row({ status: 'En Uso' }))).toBe('operativo');
        expect(activoEstado(row({ status: null }))).toBe('operativo');
        expect(activoEstado(row({ status: 'En Mantenimiento' }))).toBe('en_mantencion');
        expect(activoEstado(row({ status: 'Para Baja' }))).toBe('de_baja');
        expect(activoEstado(row({ status: 'Extraviado' }))).toBe('extraviado');
        // Archivado o eliminado manda sobre el estado operativo.
        expect(activoEstado(row({ status: 'Disponible', deleted_at: '2026-07-01T00:00:00Z' }))).toBe('de_baja');
        expect(activoEstado(row({ status: 'En Mantenimiento', archived: true }))).toBe('de_baja');
    });

    it('activo: campos reservados en null y valida contra el schema', () => {
        const dto = toActivoDTO(row());
        expect(dto).toMatchObject({ material_id: null, panol: null, contrato: null, responsable: null, external_ref: null, ubicacion: null, valor_compra: 125000, fecha_compra: '2026-03-01' });
        const conLugar = toActivoDTO(row({ catalog_material_id: '33333333-3333-4333-8333-333333333333', external_ref: 'valar:x' }),
            { panol: { id: '44444444-4444-4444-8444-444444444444', nombre: 'Pañol Norte' }, contrato: null, responsable: 'Juan Pérez' });
        expect(conLugar).toMatchObject({ material_id: '33333333-3333-4333-8333-333333333333', external_ref: 'valar:x', responsable: 'Juan Pérez' });
        expect(ActivoSchema.parse(conLugar)).toEqual(conLugar);
        expect(ActivoSchema.parse(dto)).toEqual(dto);
    });

    it('proveedor: eliminado = inactivo; RUT nulo permitido', () => {
        const dto = toProveedorDTO({
            id: '22222222-2222-4222-8222-222222222222', rut: null, name: 'Ferretería Sur',
            email: '', phone: '+56 9 1234 5678', deleted_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00+00:00',
        });
        expect(dto).toMatchObject({ rut: null, razon_social: 'Ferretería Sur', nombre_fantasia: null, email: null, activo: false });
        expect(ProveedorSchema.parse(dto)).toEqual(dto);
    });

    it('variantes de RUT', () => {
        expect(rutVariants('76.111.222-3')).toEqual(['76.111.222-3', '76111222-3', '761112223']);
        expect(rutVariants('761112223')).toContain('76.111.222-3');
        expect(rutVariants('12.345.678-k')).toEqual(expect.arrayContaining(['12.345.678-K', '12.345.678-k']));
        expect(rutVariants('hola')).toEqual([]);
    });
});

describe('paginación', () => {
    it('el cursor conserva los microsegundos', () => {
        const c = { u: '2026-06-28T17:01:09.320138+00:00', id: '11111111-1111-4111-8111-111111111111' };
        expect(decodeCursor(encodeCursor(c))).toEqual(c);
        expect(afterCursorFilter(c)).toBe(
            'updated_at.gt."2026-06-28T17:01:09.320138+00:00",and(updated_at.eq."2026-06-28T17:01:09.320138+00:00",id.gt.11111111-1111-4111-8111-111111111111)',
        );
    });

    it('rechaza un cursor manipulado (termina dentro de un filtro de PostgREST)', () => {
        const evil = Buffer.from(JSON.stringify({ u: '2026-01-01",tenant_id.neq.x', id: 'x' })).toString('base64url');
        expect(() => decodeCursor(evil)).toThrow(ApiError);
        expect(() => decodeCursor('no-es-base64-json')).toThrow(ApiError);
    });

    it('pide limit+1 y corta: next_cursor sólo si sobró una fila', () => {
        const rows = [1, 2, 3].map(i => ({ id: `0000000${i}-0000-4000-8000-000000000000`, updated_at: `2026-01-0${i}T00:00:00+00:00` }));
        expect(paginate(rows, 3)).toEqual({ page: rows, next_cursor: null });
        const { page, next_cursor } = paginate(rows, 2);
        expect(page).toHaveLength(2);
        expect(decodeCursor(next_cursor!)).toEqual({ u: rows[1].updated_at, id: rows[1].id });
    });
});

describe('openapi', () => {
    it('genera un documento 3.1 con todas las rutas y la seguridad bearer', () => {
        const doc = getOpenApiDocument() as any;
        expect(doc.openapi).toBe('3.1.0');
        const paths = Object.keys(doc.paths).sort();
        expect(paths).toEqual([
            '/activos', '/activos/{id}', '/materiales', '/materiales/{id}', '/materiales/{id}/existencias',
            '/movimientos', '/panoles', '/productos', '/productos/{id}', '/proveedores', '/proveedores/{id}',
        ]);
        for (const p of paths) for (const op of Object.values(doc.paths[p]) as any[]) expect(op.security).toEqual([{ apiKey: [] }]);
        // Toda escritura documenta el Idempotency-Key obligatorio.
        for (const op of [doc.paths['/activos'].post, doc.paths['/activos/{id}'].patch, doc.paths['/movimientos'].post]) {
            expect(op.parameters).toContainEqual(expect.objectContaining({ in: 'header', name: 'Idempotency-Key', required: true }));
        }
        expect(doc.components.securitySchemes.apiKey).toMatchObject({ type: 'http', scheme: 'bearer' });
        expect(Object.keys(doc.components.schemas)).toEqual(expect.arrayContaining(['Material', 'Proveedor', 'Activo', 'Panol', 'Existencias', 'Movimiento', 'Error']));
    });
});
