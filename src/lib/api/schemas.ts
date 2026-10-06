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
        rastreable: z.boolean().openapi({
            description: '`true`: cada unidad es un activo con su propio código y QR; al recibirlo se crea con `POST /activos`, una llamada por unidad. ' +
                '`false`: se controla por cantidad; al recibirlo se ingresa con `POST /movimientos`.',
        }),
        tipo_uso: z.string().nullable().openapi({ description: 'Tipo de uso tal como está en Pagnol (ej. "Herramienta Menor", "Consumible").' }),
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

export const RefSchema = z.object({ id: uuid, nombre: z.string() }).openapi('Ref');

export const ActivoSchema = z
    .object({
        id: uuid,
        codigo: z.string().openapi({ description: 'El valor que lleva la etiqueta QR del activo.' }),
        nombre: z.string(),
        material_id: uuid.nullable().openapi({
            description: 'Ítem del catálogo desde el que se creó esta unidad (`POST /activos`). `null` en los activos cargados directamente en Pagnol.',
        }),
        proveedor_id: uuid.nullable(),
        estado: z.enum(ACTIVO_ESTADOS),
        ubicacion: z.string().nullable().openapi({ description: 'Ubicación descriptiva (texto libre).' }),
        panol: RefSchema.nullable().openapi({
            description: 'Pañol donde está. `null` si está prestado, sin pañol asignado, o repartido en varios lugares (ver `/materiales/{id}/existencias`).',
        }),
        contrato: RefSchema.nullable().openapi({ description: 'Contrato al que está asignado. `null` = stock central de la empresa.' }),
        responsable: z.string().nullable().openapi({ description: 'Quién lo tiene en su poder (última entrega sin devolución). `null` si está en el pañol.' }),
        valor_compra: z.number().nullable(),
        fecha_compra: z.string().nullable().openapi({ description: 'Fecha (YYYY-MM-DD).' }),
        external_ref: z.string().nullable().openapi({ description: 'Referencia del sistema que originó el activo (ej. `valar:recepcion:…:unidad:2`).' }),
        updated_at: isoDateTime,
    })
    .openapi('Activo');

export const PanolSchema = z
    .object({
        id: uuid,
        nombre: z.string(),
        ubicacion: z.string().nullable(),
        activo: z.boolean().openapi({ description: '`false` si el pañol está inactivo (no recibe ingresos).' }),
        contratos: z.array(RefSchema).openapi({ description: 'Contratos que atiende el pañol.' }),
    })
    .openapi('Panol');

export const ExistenciasSchema = z
    .object({
        material_id: uuid,
        stock_actual: z.number().nullable(),
        existencias: z.array(z.object({
            panol: RefSchema.nullable().openapi({ description: '`null` = sin pañol asignado.' }),
            contrato: RefSchema.nullable().openapi({ description: '`null` = stock central de la empresa.' }),
            cantidad: z.number(),
        })),
    })
    .openapi('Existencias');

export const MovimientoSchema = z
    .object({
        id: uuid,
        tipo: z.enum(['ingreso', 'reverso']),
        material_id: uuid,
        cantidad: z.number().openapi({ description: 'Unidades ingresadas (o revertidas), siempre positivo.' }),
        stock_actual: z.number().openapi({ description: 'Stock total del material después del movimiento.' }),
        external_ref: z.string().openapi({ description: 'En un reverso, la referencia del ingreso revertido.' }),
    })
    .openapi('Movimiento');

// ── Cuerpos de escritura ────────────────────────────────────────────────────
const externalRef = z.string().trim().min(1).max(200)
    .openapi({ description: 'Referencia única del sistema que origina la operación. Repetirla devuelve lo ya creado, nunca duplica.' });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');

export const CreateActivoBodySchema = z
    .object({
        material_id: uuid.openapi({ description: 'Ítem rastreable del catálogo (`rastreable: true` en `/materiales`). La unidad copia sus datos.' }),
        nombre: z.string().trim().min(1).max(200).optional().openapi({ description: 'Por defecto, el nombre del ítem del catálogo.' }),
        proveedor_id: uuid.nullable().optional(),
        valor_compra: z.number().nonnegative().nullable().optional(),
        fecha_compra: isoDate.optional().openapi({ description: 'Fecha de recepción (YYYY-MM-DD). Por defecto, hoy.' }),
        ubicacion: z.string().trim().max(200).nullable().optional(),
        panol_id: uuid.nullable().optional().openapi({ description: 'Pañol donde queda (ver `/panoles`). Sin él, queda sin pañol asignado.' }),
        external_ref: externalRef,
    })
    .strict()
    .openapi('CreateActivo');

export const ACTIVO_ESTADOS_EDITABLES = ['operativo', 'en_mantencion', 'extraviado', 'de_baja'] as const;

export const PatchActivoBodySchema = z
    .object({
        estado: z.enum(ACTIVO_ESTADOS_EDITABLES).optional(),
        ubicacion: z.string().trim().max(200).nullable().optional(),
    })
    .strict()
    .refine(b => b.estado !== undefined || b.ubicacion !== undefined, { message: 'Indica `estado` o `ubicacion`.' })
    .openapi('PatchActivo');

export const CreateMovimientoBodySchema = z
    .discriminatedUnion('tipo', [
        z.object({
            tipo: z.literal('ingreso'),
            material_id: uuid.openapi({ description: 'Material NO rastreable (`rastreable: false`).' }),
            cantidad: z.number().positive(),
            fecha: z.string().datetime({ offset: true }).or(isoDate).optional()
                .openapi({ description: 'Fecha de la recepción (ISO 8601 o YYYY-MM-DD). Por defecto, ahora.' }),
            panol_id: uuid.nullable().optional().openapi({ description: 'Pañol donde entra (ver `/panoles`). Sin él, entra sin pañol asignado.' }),
            external_ref: externalRef,
        }).strict(),
        z.object({
            tipo: z.literal('reverso'),
            external_ref: externalRef.openapi({ description: 'La `external_ref` del ingreso que se revierte.' }),
        }).strict(),
    ])
    .openapi('CreateMovimiento');

export type MaterialDTO = z.infer<typeof MaterialSchema>;
export type ProveedorDTO = z.infer<typeof ProveedorSchema>;
export type ActivoDTO = z.infer<typeof ActivoSchema>;
export type PanolDTO = z.infer<typeof PanolSchema>;
export type ExistenciasDTO = z.infer<typeof ExistenciasSchema>;
export type MovimientoDTO = z.infer<typeof MovimientoSchema>;
export type RefDTO = z.infer<typeof RefSchema>;

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
    material_id: uuid.optional().openapi({ description: 'Unidades creadas desde este ítem del catálogo.' }),
    external_ref: z.string().trim().min(1).max(200).optional().openapi({ description: 'Busca la unidad creada con esta referencia.' }),
    updated_since: updatedSince,
    limit,
    cursor,
});

export const IdParamSchema = z.object({ id: uuid });
