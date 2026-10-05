import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import {
    ActivoSchema, ActivosQuerySchema, ErrorSchema, IdParamSchema, MaterialSchema, MaterialesQuerySchema,
    ProveedorSchema, ProveedoresQuerySchema, listSchema,
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

    return new OpenApiGeneratorV31(registry.definitions).generateDocument({
        openapi: '3.1.0',
        info: {
            title: 'Pagnol API',
            version: '1.0.0',
            description:
                'API pública de Pagnol: catálogo de materiales, productos, proveedores y activos de la empresa dueña de la API key. ' +
                'Campos en snake_case, fechas ISO 8601 UTC. Dentro de v1 sólo hay cambios aditivos.',
        },
        servers: [{ url: 'https://www.pagnol.cl/api/v1' }],
    });
}

let cached: ReturnType<typeof buildDocument> | null = null;

export function getOpenApiDocument() {
    return (cached ??= buildDocument());
}
