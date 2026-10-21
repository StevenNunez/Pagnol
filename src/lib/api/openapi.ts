import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z as zod } from 'zod';
import {
    ActivoSchema, ActivosQuerySchema, CreateActivoBodySchema, CreateMovimientoBodySchema, ErrorSchema, ExistenciasSchema,
    IdParamSchema, MaterialSchema, MaterialesQuerySchema, MovimientoSchema, PanolSchema, PatchActivoBodySchema,
    ProveedorSchema, ProveedoresQuerySchema, listSchema,
    CompraRecepcionCorregidaSchema, CompraRecibidaSchema, SolicitudCompraSchema, CompraSchema, ComprasQuerySchema, CreateCompraBodySchema, PatchCompraBodySchema, PatchWebhookBodySchema,
    CreateWebhookBodySchema, WebhookCreatedSchema, WebhookEventSchema, WebhookSchema,
} from './schemas';
import type { ApiScope } from './scopes';
import type { z } from 'zod';

// Contrato OpenAPI 3.1 de la API v1, generado desde los mismos schemas Zod
// que usan los endpoints: el documento no puede desalinearse del código.

const errorResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: ErrorSchema } },
});

const commonErrors = {
    400: errorResponse('Parámetros inválidos (`validation_error`).'),
    401: errorResponse('Falta la API key, es inválida o está revocada (`unauthorized`).'),
    403: errorResponse('La API key no tiene el scope requerido (`forbidden`).'),
    429: {
        ...errorResponse('Límite de peticiones superado (`rate_limited`).'),
        headers: { 'Retry-After': { description: 'Segundos a esperar antes de reintentar.', schema: { type: 'integer' as const } } },
    },
    500: errorResponse('Error interno (`internal_error`).'),
};

const json = (schema: z.ZodTypeAny, description: string) => ({ description, content: { 'application/json': { schema } } });

const IdempotencyHeader = zod.object({
    'Idempotency-Key': zod.string().uuid().openapi({
        description: 'Obligatorio en toda escritura. Repetir la misma llave con el mismo cuerpo (24 h) devuelve la respuesta original sin volver a ejecutar; con otro cuerpo → 409 `idempotency_conflict`.',
    }),
});

const writeErrors = {
    ...commonErrors,
    404: errorResponse('El material, pañol, proveedor o activo no existe en la empresa de la API key (`not_found`).'),
    409: errorResponse('`idempotency_conflict` (misma llave, otro cuerpo) o `conflict` (external_ref ya usada para otra cosa, petición en curso, o reverso imposible).'),
};

interface Resource {
    path: string;
    /** operationId del listado y del detalle (nombres estables para los clientes generados). */
    ops: [list: string, get: string];
    tag: string;
    scope: ApiScope;
    item: z.ZodTypeAny;
    listName: string;
    query: z.AnyZodObject;
    listSummary: string;
    detailSummary: string;
}

const RESOURCES: Resource[] = [
    {
        path: '/materiales', ops: ['listMateriales', 'getMaterial'], tag: 'Materiales', scope: 'materiales:read', item: MaterialSchema,
        listName: 'MaterialList', query: MaterialesQuerySchema,
        listSummary: 'Catálogo completo de materiales propios de la empresa (incluye consumibles y activos).',
        detailSummary: 'Un material del catálogo.',
    },
    {
        path: '/productos', ops: ['listProductos', 'getProducto'], tag: 'Productos', scope: 'productos:read', item: MaterialSchema,
        listName: 'ProductoList', query: MaterialesQuerySchema,
        listSummary: 'Productos: consumibles y repuestos, lo que se compra por cantidad.',
        detailSummary: 'Un producto.',
    },
    {
        path: '/proveedores', ops: ['listProveedores', 'getProveedor'], tag: 'Proveedores', scope: 'proveedores:read', item: ProveedorSchema,
        listName: 'ProveedorList', query: ProveedoresQuerySchema,
        listSummary: 'Proveedores de la empresa (los eliminados vienen con `activo: false`).',
        detailSummary: 'Un proveedor.',
    },
    {
        path: '/activos', ops: ['listActivos', 'getActivo'], tag: 'Activos', scope: 'activos:read', item: ActivoSchema,
        listName: 'ActivoList', query: ActivosQuerySchema,
        listSummary: 'Activos con identidad propia (equipos, herramientas, TI, reutilizables).',
        detailSummary: 'Un activo.',
    },
];

function buildDocument() {
    const registry = new OpenAPIRegistry();
    registry.registerComponent('securitySchemes', 'apiKey', {
        type: 'http',
        scheme: 'bearer',
        description: 'API key de la empresa: `Authorization: Bearer pk_live_...` (o `pk_test_...`).',
    });

    for (const r of RESOURCES) {
        registry.registerPath({
            method: 'get',
            path: r.path,
            operationId: r.ops[0],
            tags: [r.tag],
            summary: r.listSummary,
            description: `Requiere el scope \`${r.scope}\`. Orden por \`updated_at\` ascendente; paginación por cursor.`,
            security: [{ apiKey: [] }],
            request: { query: r.query },
            responses: {
                200: { description: 'Página de resultados.', content: { 'application/json': { schema: listSchema(r.item, r.listName) } } },
                ...commonErrors,
            },
        });
        registry.registerPath({
            method: 'get',
            path: `${r.path}/{id}`,
            operationId: r.ops[1],
            tags: [r.tag],
            summary: r.detailSummary,
            description: `Requiere el scope \`${r.scope}\`.`,
            security: [{ apiKey: [] }],
            request: { params: IdParamSchema },
            responses: {
                200: { description: 'El recurso.', content: { 'application/json': { schema: r.item } } },
                404: errorResponse('No existe en la empresa de la API key (`not_found`).'),
                ...commonErrors,
            },
        });
    }

    // ── Dónde está cada cosa ────────────────────────────────────────────────
    registry.registerPath({
        method: 'get', path: '/panoles', operationId: 'listPanoles', tags: ['Pañoles'],
        summary: 'Pañoles (bodegas) de la empresa, con los contratos que atienden.',
        description: 'Requiere `activos:read`, `materiales:read` o `productos:read`. Una sola página.',
        security: [{ apiKey: [] }],
        responses: { 200: json(listSchema(PanolSchema, 'PanolList'), 'Pañoles.'), ...commonErrors },
    });
    registry.registerPath({
        method: 'get', path: '/materiales/{id}/existencias', operationId: 'getExistencias', tags: ['Materiales'],
        summary: 'Cuánto hay de un material (o activo) en cada pañol y contrato.',
        description: 'Requiere `materiales:read`, `productos:read` o `activos:read`.',
        security: [{ apiKey: [] }],
        request: { params: IdParamSchema },
        responses: { 200: json(ExistenciasSchema, 'Existencias.'), 404: errorResponse('No existe en la empresa (`not_found`).'), ...commonErrors },
    });

    // ── Escritura: lo que llega se registra en Pagnol ───────────────────────
    registry.registerPath({
        method: 'post', path: '/activos', operationId: 'createActivo', tags: ['Activos'],
        summary: 'Crea UNA unidad rastreable al recibirla (una llamada por unidad).',
        description: 'Requiere `activos:write`. Copia los datos del ítem del catálogo, le asigna código y QR propios, y la deja en el pañol indicado. ' +
            'No genera gasto en Pagnol: el gasto vive en el sistema que compró. Repetir la misma `external_ref` devuelve el activo ya creado (200).',
        security: [{ apiKey: [] }],
        request: { headers: IdempotencyHeader, body: { content: { 'application/json': { schema: CreateActivoBodySchema } } } },
        responses: { 201: json(ActivoSchema, 'Activo creado.'), 200: json(ActivoSchema, 'Ya existía un activo con esa `external_ref`.'), ...writeErrors },
    });
    registry.registerPath({
        method: 'patch', path: '/activos/{id}', operationId: 'patchActivo', tags: ['Activos'],
        summary: 'Cambia el estado y/o la ubicación de un activo.',
        description: 'Requiere `activos:write`. `de_baja` lo marca para baja (no borra nada). Un activo archivado en Pagnol responde 409.',
        security: [{ apiKey: [] }],
        request: { params: IdParamSchema, headers: IdempotencyHeader, body: { content: { 'application/json': { schema: PatchActivoBodySchema } } } },
        responses: { 200: json(ActivoSchema, 'Activo actualizado.'), ...writeErrors },
    });
    registry.registerPath({
        method: 'post', path: '/movimientos', operationId: 'createMovimiento', tags: ['Movimientos'],
        summary: 'Ingresa stock de un consumible al recibirlo, o revierte un ingreso.',
        description: 'Requiere `stock:write`. Sólo materiales NO rastreables. Un reverso es un movimiento nuevo que descuenta lo ingresado (nunca se borra el original); ' +
            'si esas unidades ya se entregaron o movieron, responde 409 y se ajusta en Pagnol. No genera gasto en Pagnol.',
        security: [{ apiKey: [] }],
        request: { headers: IdempotencyHeader, body: { content: { 'application/json': { schema: CreateMovimientoBodySchema } } } },
        responses: { 201: json(MovimientoSchema, 'Movimiento registrado.'), 200: json(MovimientoSchema, 'Ya existía con esa `external_ref`.'), ...writeErrors },
    });

    // ── Compras esperadas: lo que el sistema que compra anuncia y viene en camino ─
    registry.registerPath({
        method: 'get', path: '/compras-esperadas', operationId: 'listCompras', tags: ['Compras esperadas'],
        summary: 'Compras anunciadas a Pagnol, con el estado de cada línea.',
        description: 'Requiere `compras:read`. Orden por `updated_at` ascendente; paginación por cursor. El estado de cada línea se deriva de lo recibido en Pagnol.',
        security: [{ apiKey: [] }],
        request: { query: ComprasQuerySchema },
        responses: { 200: json(listSchema(CompraSchema, 'CompraList'), 'Página de compras.'), ...commonErrors },
    });
    registry.registerPath({
        method: 'get', path: '/compras-esperadas/{id}', operationId: 'getCompra', tags: ['Compras esperadas'],
        summary: 'Una compra esperada.',
        description: 'Requiere `compras:read`.',
        security: [{ apiKey: [] }],
        request: { params: IdParamSchema },
        responses: { 200: json(CompraSchema, 'La compra.'), 404: errorResponse('No existe en la empresa (`not_found`).'), ...commonErrors },
    });
    registry.registerPath({
        method: 'post', path: '/compras-esperadas', operationId: 'createCompra', tags: ['Compras esperadas'],
        summary: 'Anuncia una compra que viene en camino.',
        description: 'Requiere `compras:write`. Sólo para empresas cuya recepción es en Pagnol (si no, 409). No es una orden de compra de Pagnol y no genera gasto. ' +
            'Repetir la `external_ref` devuelve la compra ya anunciada (200) sin modificarla. Se anuncia cuando la OC se envía al proveedor. ' +
            'Lo que el pañolero reciba en Pagnol se informa con el evento `compra.recibida` y queda en `recepciones`.',
        security: [{ apiKey: [] }],
        request: { headers: IdempotencyHeader, body: { content: { 'application/json': { schema: CreateCompraBodySchema } } } },
        responses: { 201: json(CompraSchema, 'Compra anunciada.'), 200: json(CompraSchema, 'Ya existía con esa `external_ref`.'), ...writeErrors },
    });
    registry.registerPath({
        method: 'patch', path: '/compras-esperadas/{id}', operationId: 'patchCompra', tags: ['Compras esperadas'],
        summary: 'Corrige o cancela una compra esperada.',
        description: 'Requiere `compras:write`. Corrige fecha, pañol, contrato o cantidades, o cancela la compra o líneas sueltas. ' +
            'Con recepciones, una línea nunca puede quedar por debajo de lo ya recibido y el pañol no se cambia (409). ' +
            'Una compra cancelada no se modifica (409); cancelar conserva lo ya recibido.',
        security: [{ apiKey: [] }],
        request: { params: IdParamSchema, headers: IdempotencyHeader, body: { content: { 'application/json': { schema: PatchCompraBodySchema } } } },
        responses: { 200: json(CompraSchema, 'Compra actualizada.'), ...writeErrors },
    });

    // ── Webhooks: Pagnol avisa cuando algo cambia ───────────────────────────
    registry.register('WebhookEvent', WebhookEventSchema);
    // `data` del evento `compra.recibida` (una línea recibida en una recepción).
    registry.register('CompraRecibida', CompraRecibidaSchema);
    // `data` del evento `compra.recepcion_corregida` (se quitó cantidad de una recepción ya informada).
    registry.register('CompraRecepcionCorregida', CompraRecepcionCorregidaSchema);
    // `data` de los eventos `solicitud_compra.creada|aprobada|rechazada` (una solicitud, todas sus líneas).
    registry.register('SolicitudCompra', SolicitudCompraSchema);
    registry.registerPath({
        method: 'get', path: '/webhooks', operationId: 'listWebhooks', tags: ['Webhooks'],
        summary: 'Webhooks registrados por la empresa.',
        description: 'Requiere `webhooks:manage`. Una sola página. El secreto de firma no se vuelve a mostrar.',
        security: [{ apiKey: [] }],
        responses: { 200: json(listSchema(WebhookSchema, 'WebhookList'), 'Webhooks.'), ...commonErrors },
    });
    registry.registerPath({
        method: 'post', path: '/webhooks', operationId: 'createWebhook', tags: ['Webhooks'],
        summary: 'Registra una URL para recibir eventos.',
        description: 'Requiere `webhooks:manage`. Devuelve el `secret` de firma UNA vez. Cada evento llega como `POST` con el sobre `WebhookEvent`, ' +
            'firmado según Standard Webhooks (headers `webhook-id`, `webhook-timestamp`, `webhook-signature`; verifica con la librería `standardwebhooks` y este `secret`). ' +
            'Responde `2xx` en menos de 10 s; ante cualquier otra respuesta (las redirecciones no se siguen), error o silencio Pagnol reintenta ' +
            'a ≈ 1 min, 5 min, 30 min, 2 h, 6 h y 24 h, y luego cada 24 h hasta cumplir 7 días. Es posible recibir un evento más de una vez: deduplica por `webhook-id`. ' +
            'Varios cambios seguidos al mismo recurso pueden llegar como un solo evento con su estado más reciente. ' +
            'Una URL por empresa; máximo 10 webhooks.',
        security: [{ apiKey: [] }],
        request: { headers: IdempotencyHeader, body: { content: { 'application/json': { schema: CreateWebhookBodySchema } } } },
        responses: {
            201: json(WebhookCreatedSchema, 'Webhook registrado, con su `secret`.'),
            ...commonErrors,
            409: errorResponse('`idempotency_conflict`, o `conflict` si la URL ya está registrada o se alcanzó el máximo.'),
        },
    });
    registry.registerPath({
        method: 'patch', path: '/webhooks/{id}', operationId: 'patchWebhook', tags: ['Webhooks'],
        summary: 'Cambia los eventos, la URL, la descripción o pausa un webhook.',
        description: 'Requiere `webhooks:manage`. El secreto de firma NO cambia: sirve para sumar eventos nuevos sin recrear la suscripción. ' +
            '`activo: false` pausa las entregas sin borrarla.',
        security: [{ apiKey: [] }],
        request: { params: IdParamSchema, headers: IdempotencyHeader, body: { content: { 'application/json': { schema: PatchWebhookBodySchema } } } },
        responses: { 200: json(WebhookSchema, 'Webhook actualizado.'), ...writeErrors },
    });
    registry.registerPath({
        method: 'delete', path: '/webhooks/{id}', operationId: 'deleteWebhook', tags: ['Webhooks'],
        summary: 'Elimina un webhook.',
        description: 'Requiere `webhooks:manage`. Deja de enviarse a esa URL de inmediato, incluidos los reintentos pendientes.',
        security: [{ apiKey: [] }],
        request: { params: IdParamSchema },
        responses: { 204: { description: 'Eliminado.' }, 404: errorResponse('No existe en la empresa (`not_found`).'), ...commonErrors },
    });

    return new OpenApiGeneratorV31(registry.definitions).generateDocument({
        openapi: '3.1.0',
        info: {
            title: 'Pagnol API',
            version: '1.0.0',
            description:
                'API pública de Pagnol: catálogo de materiales, productos, proveedores, activos y pañoles de la empresa dueña de la API key, ' +
                'y registro de lo que llega (activos y stock). ' +
                'Campos en snake_case, fechas ISO 8601 UTC. Dentro de v1 sólo hay cambios aditivos.',
        },
        servers: [{ url: 'https://www.pagnol.cl/api/v1' }],
    });
}

let cached: ReturnType<typeof buildDocument> | null = null;

export function getOpenApiDocument() {
    return (cached ??= buildDocument());
}
