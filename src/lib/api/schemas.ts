import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

// DTOs públicos de la API v1. Son el contrato con los sistemas integrados:
// dentro de v1 sólo se AGREGAN campos; quitar o renombrar exige v2.
extendZodWithOpenApi(z);

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });

export const MaterialSchema = z
    .object({
        id: uuid,
        codigo: z.string().openapi({ description: 'Código interno; si no tiene, el N° de serie; si tampoco, el id. Es el mismo valor que lleva la etiqueta QR.' }),
        nombre: z.string(),
        descripcion: z.string().nullable(),
        categoria: z.string().nullable(),
        unidad_medida: z.string().openapi({ description: 'Unidad tal como se registró en el catálogo (texto libre).' }),
        stock_actual: z.number().nullable().openapi({ description: 'Total de la empresa, sumando todos los contratos y pañoles.' }),
        stock_minimo: z.number().nullable(),
        activo: z.boolean().openapi({ description: '`false` si el material fue archivado o eliminado.' }),
        updated_at: isoDateTime,
    })
    .openapi('Material');

export const ProveedorSchema = z
    .object({
        id: uuid,
        rut: z.string().nullable(),
        razon_social: z.string(),
        nombre_fantasia: z.string().nullable(),
        email: z.string().nullable(),
        telefono: z.string().nullable(),
        activo: z.boolean().openapi({ description: '`false` si el proveedor fue eliminado.' }),
        updated_at: isoDateTime,
    })
    .openapi('Proveedor');

export const ACTIVO_ESTADOS = ['operativo', 'en_mantencion', 'de_baja', 'extraviado'] as const;
export type ActivoEstado = (typeof ACTIVO_ESTADOS)[number];

export const ActivoSchema = z
    .object({
        id: uuid,
        codigo: z.string().openapi({ description: 'El valor que lleva la etiqueta QR del activo.' }),
        nombre: z.string(),
        material_id: uuid.nullable().openapi({ description: 'Reservado. Siempre `null` en esta versión.' }),
        proveedor_id: uuid.nullable(),
        estado: z.enum(ACTIVO_ESTADOS),
        ubicacion: z.string().nullable(),
        responsable: z.string().nullable().openapi({ description: 'Reservado. Siempre `null` en esta versión.' }),
        valor_compra: z.number().nullable(),
        fecha_compra: z.string().nullable().openapi({ description: 'Fecha (YYYY-MM-DD).' }),
        external_ref: z.string().nullable().openapi({ description: 'Referencia al sistema que originó el activo. Siempre `null` en esta versión.' }),
        updated_at: isoDateTime,
    })
    .openapi('Activo');

export type MaterialDTO = z.infer<typeof MaterialSchema>;
export type ProveedorDTO = z.infer<typeof ProveedorSchema>;
export type ActivoDTO = z.infer<typeof ActivoSchema>;

export const ErrorSchema = z
    .object({
        error: z.object({
            code: z.enum([
                'validation_error', 'unauthorized', 'forbidden', 'not_found',
                'conflict', 'idempotency_conflict', 'rate_limited', 'internal_error',
            ]),
            message: z.string(),
            details: z.record(z.unknown()).optional(),
        }),
    })
    .openapi('Error');

export function listSchema<T extends z.ZodTypeAny>(item: T, name: string) {
    return z
        .object({
            data: z.array(item),
            next_cursor: z.string().nullable().openapi({ description: '`null` cuando no hay más páginas.' }),
        })
        .openapi(name);
}

// ── Parámetros de consulta ──────────────────────────────────────────────────
const limit = z.coerce.number().int().min(1).max(100).default(50)
    .openapi({ description: 'Tamaño de página (máximo 100).' });
const cursor = z.string().optional().openapi({ description: 'Valor de `next_cursor` de la página anterior.' });
const updatedSince = isoDateTime.optional()
    .openapi({ description: 'Sólo registros modificados desde esta fecha (ISO 8601), inclusive.' });
const q = z.string().trim().min(1).max(100).optional().openapi({ description: 'Búsqueda por nombre o código.' });

export const MaterialesQuerySchema = z.object({
    q,
    categoria: z.string().trim().min(1).max(100).optional(),
    updated_since: updatedSince,
    limit,
    cursor,
});

export const ProveedoresQuerySchema = z.object({
    q: z.string().trim().min(1).max(100).optional().openapi({ description: 'Búsqueda por razón social o RUT.' }),
    rut: z.string().trim().min(1).max(20).optional().openapi({ description: 'RUT exacto; se aceptan con o sin puntos.' }),
    updated_since: updatedSince,
    limit,
    cursor,
});

export const ActivosQuerySchema = z.object({
    q,
    estado: z.enum(ACTIVO_ESTADOS).optional(),
    material_id: uuid.optional(),
    updated_since: updatedSince,
    limit,
    cursor,
});

export const IdParamSchema = z.object({ id: uuid });
