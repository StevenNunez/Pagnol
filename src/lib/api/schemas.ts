import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { WEBHOOK_EVENTS } from './webhooks/events';
import { webhookUrlProblem } from './webhooks/url-guard';

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
        contrato: RefSchema.nullable().openapi({
            description: 'Contrato al que está asignado. Mientras el activo está entregado, el contrato de la solicitud que lo entregó. `null` = en poder de la empresa (stock central).',
        }),
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

export const COMPRA_LINEA_ESTADOS = ['esperada', 'parcial', 'recibida', 'cancelada'] as const;

export const CompraLineaSchema = z
    .object({
        id: uuid,
        external_ref: z.string().openapi({ description: 'BASE de la línea en el sistema que compra; de ella salen las referencias de lo que se crea al recibir.' }),
        material: z.object({ id: uuid, nombre: z.string(), rastreable: z.boolean() }),
        cantidad_esperada: z.number(),
        cantidad_recibida: z.number().openapi({ description: 'Lo que el pañolero ya recibió en Pagnol.' }),
        valor_unitario: z.number().nullable().openapi({ description: 'Valor NETO por unidad, en CLP, que anunció el sistema que compra; se copia al activo como valor de compra al recibirlo. Sin valor, el activo queda sin valor de compra.' }),
        estado: z.enum(COMPRA_LINEA_ESTADOS).openapi({ description: 'Derivado de lo recibido: `esperada`, `parcial`, `recibida` o `cancelada`.' }),
    })
    .openapi('CompraLinea');

export const CreadoSchema = z.object({
    tipo: z.enum(['activo', 'movimiento']),
    id: uuid,
    external_ref: z.string().openapi({ description: 'La referencia con la que quedó registrado: `<base de la línea>:unidad:<n>` (equipos) o `<base>:recepcion:<k>` (consumibles).' }),
}).openapi('Creado');

export const CompraRecepcionSchema = z
    .object({
        id: uuid,
        guia_despacho: z.string(),
        fecha_recepcion: z.string().openapi({ description: 'YYYY-MM-DD.' }),
        recibido_por: RefSchema,
        lineas: z.array(z.object({
            linea_external_ref: z.string(),
            cantidad: z.number(),
            cantidad_corregida: z.number().openapi({ description: 'Lo que después se quitó de esta recepción (corrección del pañolero). La recepción original no cambia.' }),
            creados: z.array(CreadoSchema),
        })),
    })
    .openapi('CompraRecepcion');

export const CompraCorreccionSchema = z
    .object({
        id: uuid,
        recepcion_id: uuid,
        guia_despacho: z.string(),
        linea_external_ref: z.string(),
        cantidad_quitada: z.number(),
        motivo: z.string(),
        corregido_por: RefSchema,
        fecha: isoDateTime,
        revertidos: z.array(CreadoSchema).openapi({ description: 'Qué se revirtió en Pagnol: los equipos dados de baja o el ajuste de stock.' }),
    })
    .openapi('CompraCorreccion');

export const CompraSchema = z
    .object({
        id: uuid,
        external_ref: z.string().openapi({ description: 'La OC del sistema que compra. Única por empresa.' }),
        estado: z.enum(['abierta', 'cerrada', 'cancelada']).openapi({
            description: '`abierta` mientras alguna línea espera algo; `cerrada` cuando todo lo vigente se recibió; `cancelada` si se canceló entera o todas sus líneas.',
        }),
        proveedor: RefSchema.nullable(),
        panol: RefSchema.openapi({ description: 'Pañol de destino: donde el pañolero recibe.' }),
        fecha_estimada: z.string().nullable().openapi({ description: 'YYYY-MM-DD.' }),
        contrato_ref: z.string().nullable().openapi({ description: 'Referencia de contrato del sistema que compra (texto libre; no es un contrato de Pagnol).' }),
        lineas: z.array(CompraLineaSchema),
        recepciones: z.array(CompraRecepcionSchema).openapi({ description: 'Lo que el pañolero fue recibiendo, en orden. Cada una es un hecho que no se edita.' }),
        correcciones: z.array(CompraCorreccionSchema).openapi({ description: 'Lo que el pañolero quitó después de una recepción porque no venía. `cantidad_recibida` ya lo descuenta.' }),
        created_at: isoDateTime,
        updated_at: isoDateTime,
    })
    .openapi('Compra');

/** `data` del evento `compra.recepcion_corregida`: se quitó cantidad de una recepción ya informada. */
export const CompraRecepcionCorregidaSchema = z
    .object({
        compra_id: uuid,
        compra_external_ref: z.string(),
        recepcion_id: uuid,
        guia_despacho: z.string(),
        correccion_id: uuid,
        motivo: z.string(),
        corregido_por: RefSchema,
        fecha_correccion: isoDateTime,
        panol: RefSchema,
        linea: z.object({
            id: uuid,
            external_ref: z.string(),
            material: z.object({ id: uuid, nombre: z.string() }),
            cantidad_esperada: z.number(),
            cantidad_quitada: z.number().openapi({ description: 'Lo que se quitó en ESTA corrección.' }),
            cantidad_recibida_acumulada: z.number().openapi({ description: 'Lo recibido NETO después de la corrección.' }),
            estado: z.enum(COMPRA_LINEA_ESTADOS),
            revertidos: z.array(CreadoSchema),
        }),
    })
    .openapi('CompraRecepcionCorregida');

/** `data` de los eventos `solicitud_compra.*`: una solicitud de compra hecha en Pagnol (todas sus líneas). */
export const SOLICITUD_COMPRA_ESTADOS = ['pendiente', 'aprobada', 'rechazada'] as const;
export const SolicitudCompraSchema = z
    .object({
        id: uuid.openapi({ description: 'Identificador de la solicitud (el del lote, o el de su única fila).' }),
        codigo: z.string().nullable().openapi({ description: 'Código legible (ej. `PRQ-0042`).' }),
        estado: z.enum(SOLICITUD_COMPRA_ESTADOS).openapi({
            description: '`pendiente` mientras falta revisión/autorización; `aprobada` cuando ya pasaron todas las que la empresa tenga configuradas; `rechazada` si no quedó ninguna línea viva.',
        }),
        solicitante: RefSchema.nullable(),
        contrato: RefSchema.nullable().openapi({ description: 'El contrato al que se carga el gasto (su centro de costo en el sistema que compra).' }),
        area: z.string().nullable(),
        motivo: z.string().nullable().openapi({ description: 'Justificación escrita por quien pide.' }),
        prioridad: z.enum(['normal', 'urgente']),
        motivo_urgencia: z.string().nullable(),
        necesaria_para: z.string().nullable().openapi({ description: 'YYYY-MM-DD.' }),
        origen: z.literal('manual'),
        lineas: z.array(z.object({
            id: uuid,
            descripcion: z.string().openapi({ description: 'Lo que se pide, en palabras de quien lo pide: no está atado al catálogo.' }),
            categoria: z.string().nullable(),
            tipo: z.enum(['producto', 'servicio']),
            cantidad: z.number(),
            unidad: z.string().nullable(),
            estado: z.enum(['pendiente', 'autorizada', 'rechazada']).openapi({
                description: 'Una solicitud aprobada lista sólo las líneas `autorizada`; las `rechazada` van aparte para que no se compren.',
            }),
        })),
        revisada_por: RefSchema.nullable().openapi({ description: 'Quien la revisó por Operaciones.' }),
        autorizada_por: RefSchema.nullable().openapi({ description: 'Quien la autorizó (ADC o administración).' }),
        motivo_rechazo: z.string().nullable(),
        created_at: isoDateTime,
    })
    .openapi('SolicitudCompra');

export const CompraRecibidaSchema = z
    .object({
        compra_id: uuid,
        compra_external_ref: z.string(),
        recepcion_id: uuid,
        guia_despacho: z.string(),
        fecha_recepcion: z.string().openapi({ description: 'YYYY-MM-DD.' }),
        recibido_por: RefSchema,
        panol: RefSchema,
        linea: z.object({
            id: uuid,
            external_ref: z.string(),
            material: z.object({ id: uuid, nombre: z.string() }),
            cantidad_esperada: z.number(),
            cantidad_recibida_ahora: z.number().openapi({ description: 'Lo recibido en ESTA recepción.' }),
            cantidad_recibida_acumulada: z.number().openapi({ description: 'Lo recibido hasta aquí, contando esta recepción.' }),
            estado: z.enum(COMPRA_LINEA_ESTADOS),
            creados: z.array(CreadoSchema),
        }),
    })
    .openapi('CompraRecibida');

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

export const CreateCompraBodySchema = z
    .object({
        external_ref: externalRef.openapi({ description: 'La OC del sistema que compra. Repetirla devuelve la compra ya anunciada (200) sin modificarla; para corregirla, `PATCH`.' }),
        proveedor_id: uuid.nullable().optional(),
        panol_id: uuid.openapi({ description: 'Pañol de destino (ver `/panoles`).' }),
        fecha_estimada: isoDate.nullable().optional(),
        contrato_ref: z.string().trim().max(200).nullable().optional().openapi({ description: 'Referencia de contrato del sistema que compra (texto libre).' }),
        lineas: z.array(z.object({
            external_ref: externalRef.openapi({ description: 'BASE de la línea; única por empresa.' }),
            material_id: uuid.openapi({ description: 'Ítem del catálogo (no una unidad ya creada).' }),
            cantidad: z.number().positive(),
            valor_unitario: z.number().nonnegative().nullable().optional().openapi({ description: 'Valor NETO por unidad, en CLP. Si viene, Pagnol lo copia al activo como valor de compra al recibirlo; si no, el activo queda sin valor. No genera gasto en Pagnol.' }),
        }).strict()).min(1).max(200),
    })
    .strict()
    .openapi('CreateCompra');

export const PatchCompraBodySchema = z
    .object({
        fecha_estimada: isoDate.nullable().optional(),
        panol_id: uuid.optional(),
        contrato_ref: z.string().trim().max(200).nullable().optional(),
        cancelar: z.literal(true).optional().openapi({ description: 'Cancela la compra entera (y todas sus líneas).' }),
        lineas: z.array(z.object({
            external_ref: externalRef,
            cantidad: z.number().positive().optional(),
            cancelar: z.literal(true).optional(),
        }).strict().refine(l => l.cantidad !== undefined || l.cancelar !== undefined, { message: 'Indica `cantidad` o `cancelar`.' })).min(1).max(200).optional(),
    })
    .strict()
    .refine(b => Object.keys(b).length > 0, { message: 'No hay nada que cambiar.' })
    .openapi('PatchCompra');

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

// ── Webhooks ────────────────────────────────────────────────────────────────
export const WebhookEventTypeSchema = z.enum(WEBHOOK_EVENTS);

export const CreateWebhookBodySchema = z
    .object({
        url: z.string().trim().superRefine((u, ctx) => {
            const problem = webhookUrlProblem(u);
            if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
        }).openapi({
            description: 'Dónde recibir los eventos: https público, puerto 443. Se usa tal cual, con su barra final si la lleva.',
            example: 'https://plataforma.grupovalar.cl/api/webhooks/pagnol/',
        }),
        events: z.array(WebhookEventTypeSchema).min(1).max(WEBHOOK_EVENTS.length)
            .refine(list => new Set(list).size === list.length, { message: 'Hay eventos repetidos.' })
            .openapi({ description: 'Eventos a recibir.' }),
        descripcion: z.string().trim().min(1).max(200).nullable().optional(),
    })
    .strict()
    .openapi('CreateWebhook');

export const PatchWebhookBodySchema = z
    .object({
        url: z.string().trim().superRefine((u, ctx) => {
            const problem = webhookUrlProblem(u);
            if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
        }).optional(),
        events: z.array(WebhookEventTypeSchema).min(1).max(WEBHOOK_EVENTS.length)
            .refine(list => new Set(list).size === list.length, { message: 'Hay eventos repetidos.' })
            .optional().openapi({ description: 'Reemplaza la lista de eventos. El secreto de firma NO cambia.' }),
        descripcion: z.string().trim().min(1).max(200).nullable().optional(),
        activo: z.boolean().optional().openapi({ description: '`false` pausa las entregas sin borrar la suscripción.' }),
    })
    .strict()
    .refine(b => Object.keys(b).length > 0, { message: 'No hay nada que cambiar.' })
    .openapi('PatchWebhook');

const webhookFields = {
    id: uuid,
    url: z.string(),
    events: z.array(WebhookEventTypeSchema),
    descripcion: z.string().nullable(),
    activo: z.boolean(),
    organization_id: uuid.openapi({ description: 'La empresa dueña de la API key. Es el `organization_id` que traen todos los eventos.' }),
    created_at: isoDateTime,
};

export const WebhookSchema = z.object(webhookFields).openapi('Webhook');

export const WebhookCreatedSchema = z
    .object({
        ...webhookFields,
        secret: z.string().openapi({
            description: 'Secreto de firma (`whsec_…`). Se entrega SOLO al crear el webhook (y en una repetición idempotente dentro de 24 h); ' +
                'guárdalo en el servidor (p. ej. `PAGNOL_WEBHOOK_SECRET`). Si se pierde, se elimina el webhook y se crea otro.',
        }),
    })
    .openapi('WebhookCreated');

/** Sobre de todo evento: `data` es el mismo DTO que devuelve la API para ese recurso. */
export const WebhookEventSchema = z
    .object({
        id: z.string().openapi({ description: 'Id del evento (`evt_…`). Es el mismo valor del header `webhook-id`: úsalo para deduplicar.', example: 'evt_0b7d0e1c9f7a4a3c9e3c1d2f4a5b6c7d' }),
        type: WebhookEventTypeSchema,
        created_at: isoDateTime,
        organization_id: uuid,
        data: z.record(z.unknown()).openapi({
            description: '`material.*` → Material · `proveedor.*` → Proveedor · `activo.*` → Activo · ' +
                '`stock.bajo_minimo` → Material con `stock_actual`/`stock_minimo` del instante en que cruzó el mínimo, más `existencias` (stock por pañol y contrato).',
        }),
    })
    .openapi('WebhookEvent');

export type MaterialDTO = z.infer<typeof MaterialSchema>;
export type WebhookDTO = z.infer<typeof WebhookSchema>;
export type WebhookCreatedDTO = z.infer<typeof WebhookCreatedSchema>;
export type ProveedorDTO = z.infer<typeof ProveedorSchema>;
export type ActivoDTO = z.infer<typeof ActivoSchema>;
export type PanolDTO = z.infer<typeof PanolSchema>;
export type ExistenciasDTO = z.infer<typeof ExistenciasSchema>;
export type MovimientoDTO = z.infer<typeof MovimientoSchema>;
export type RefDTO = z.infer<typeof RefSchema>;
export type CompraDTO = z.infer<typeof CompraSchema>;
export type CompraLineaDTO = z.infer<typeof CompraLineaSchema>;
export type CompraRecepcionDTO = z.infer<typeof CompraRecepcionSchema>;
export type CompraRecibidaDTO = z.infer<typeof CompraRecibidaSchema>;
export type CompraRecepcionCorregidaDTO = z.infer<typeof CompraRecepcionCorregidaSchema>;
export type SolicitudCompraDTO = z.infer<typeof SolicitudCompraSchema>;

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

export const ComprasQuerySchema = z.object({
    external_ref: z.string().trim().min(1).max(200).optional().openapi({ description: 'Busca la compra anunciada con esta referencia (la OC).' }),
    updated_since: updatedSince,
    limit,
    cursor,
});

export const IdParamSchema = z.object({ id: uuid });
