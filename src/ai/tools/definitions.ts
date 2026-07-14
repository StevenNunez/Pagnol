import 'server-only';
import { z } from 'genkit';
import { mappers } from '@/modules/data/mappers';
import { hasPermission, type AuthContext } from '@/modules/core/lib/api-auth';
import type { Permission } from '@/modules/core/lib/permissions';
import type { getSupabaseAdmin } from '@/modules/core/lib/supabase';

/**
 * Lógica de negocio de las herramientas de datos de Pagnol AI, independiente
 * del transporte (Genkit tool-calling interno, o MCP externo). Un solo lugar
 * de verdad: cada tool real es UN objeto acá, y ambos wrappers
 * (`genkit-tools.ts`, la ruta `/api/mcp`) solo traducen protocolo.
 *
 * Regla de seguridad: cada handler SIEMPRE filtra por `tenant_id` server-side
 * (el admin client bypasea RLS) — nunca confiar en el modelo/cliente externo
 * para acotar el tenant.
 */

export type Admin = ReturnType<typeof getSupabaseAdmin>;

export interface ToolCtx {
    tenantId: string;
    admin: Admin;
    isSuperAdmin: boolean;
    grantedPermissions: string[];
    role: string;
}

function hasAny(ctx: ToolCtx, perms: Permission[]): boolean {
    const authCtx: AuthContext = {
        userId: '', role: ctx.role, tenantId: ctx.tenantId, isSuperAdmin: ctx.isSuperAdmin,
        grantedPermissions: ctx.grantedPermissions, admin: ctx.admin,
    };
    return perms.some(p => hasPermission(authCtx, p));
}

export class ToolAccessDeniedError extends Error {
    constructor(msg = 'No tienes permiso para consultar esta información.') { super(msg); }
}

export interface ToolDef<I = any, O = any> {
    name: string;
    description: string;
    zodInput: z.ZodTypeAny;
    /** JSON Schema equivalente a zodInput, para el `tools/list` de MCP. */
    jsonSchema: Record<string, any>;
    requiredPermissions?: Permission[];
    handler: (input: I, ctx: ToolCtx) => Promise<O>;
}

const LIMIT = (max: number, def: number) => z.number().int().min(1).max(max).optional().default(def);

// ─────────────────────────────────────────────────────────────────────────
// 1. Materiales / stock crítico
// ─────────────────────────────────────────────────────────────────────────
const buscarMateriales: ToolDef = {
    name: 'buscarMateriales',
    description: 'Busca materiales/activos del pañol por nombre o categoría. Usa soloStockCritico=true para listar solo los que están bajo su umbral mínimo de stock.',
    zodInput: z.object({
        query: z.string().optional().describe('Texto a buscar en el nombre del material'),
        categoria: z.string().optional(),
        soloStockCritico: z.boolean().optional().default(false),
        limite: LIMIT(50, 20),
    }),
    jsonSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Texto a buscar en el nombre del material' },
            categoria: { type: 'string' },
            soloStockCritico: { type: 'boolean', default: false },
            limite: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
    },
    requiredPermissions: ['module_pagnol:view'],
    handler: async (input, ctx) => {
        let q = ctx.admin.from('materials').select('*').eq('tenant_id', ctx.tenantId).eq('archived', false);
        if (input.query) q = q.ilike('name', `%${input.query}%`);
        if (input.categoria) q = q.eq('category', input.categoria);
        const { data, error } = await q.limit(400);
        if (error) throw new Error(`Error consultando materiales: ${error.message}`);
        let items = (data ?? []).map(mappers.materials);
        if (input.soloStockCritico) {
            items = items.filter(m => m.stock <= (m.minStock ?? 10));
        }
        items.sort((a, b) => a.stock - b.stock);
        return items.slice(0, input.limite).map(m => ({
            name: m.name, stock: m.stock, minStock: m.minStock ?? null, unit: m.unit,
            category: m.category, ownership: m.ownership ?? 'propio', status: m.status ?? null,
            estadoStock: m.stock <= (m.minStock ?? 10) ? 'CRITICO' : 'OK',
        }));
    },
};

// ─────────────────────────────────────────────────────────────────────────
// 2. Desglose de stock por contrato/pañol (ledger)
// ─────────────────────────────────────────────────────────────────────────
const stockPorContrato: ToolDef = {
    name: 'stockPorContrato',
    description: 'Muestra en qué contratos y pañoles está distribuido el stock de un material (el ledger por contrato/pañol), no solo el total.',
    zodInput: z.object({ materialQuery: z.string().describe('Nombre o parte del nombre del material') }),
    jsonSchema: { type: 'object', properties: { materialQuery: { type: 'string' } }, required: ['materialQuery'] },
    requiredPermissions: ['module_pagnol:view'],
    handler: async (input, ctx) => {
        const { data: mats, error: matErr } = await ctx.admin
            .from('materials').select('id, name, stock, unit').eq('tenant_id', ctx.tenantId)
            .ilike('name', `%${input.materialQuery}%`).limit(5);
        if (matErr) throw new Error(`Error buscando material: ${matErr.message}`);
        if (!mats?.length) return { encontrado: false, mensaje: 'No se encontró ningún material con ese nombre.' };

        const [{ data: contracts }, { data: warehouses }] = await Promise.all([
            ctx.admin.from('contracts').select('id, name').eq('tenant_id', ctx.tenantId),
            ctx.admin.from('warehouses').select('id, name').eq('tenant_id', ctx.tenantId),
        ]);
        const contractName = (id: string | null) => id ? (contracts?.find(c => c.id === id)?.name ?? 'Contrato desconocido') : 'Sin asignar (ni contrato ni área interna)';
        const warehouseName = (id: string | null) => id ? (warehouses?.find(w => w.id === id)?.name ?? 'Pañol desconocido') : 'Sin pañol asignado';

        const results = [];
        for (const m of mats) {
            const { data: stocks } = await ctx.admin
                .from('material_stocks').select('*').eq('tenant_id', ctx.tenantId).eq('material_id', m.id);
            const breakdown = (stocks ?? []).map(mappers.material_stocks)
                .filter(s => s.qty > 0)
                .map(s => ({ contrato: contractName(s.contractId), panol: warehouseName(s.warehouseId), cantidad: s.qty }));
            results.push({ material: m.name, unidad: m.unit, stockTotal: Number(m.stock), desglose: breakdown });
        }
        return { encontrado: true, resultados: results };
    },
};

// ─────────────────────────────────────────────────────────────────────────
// 3. Kardex (movimientos de stock)
// ─────────────────────────────────────────────────────────────────────────
const kardexMaterial: ToolDef = {
    name: 'kardexMaterial',
    description: 'Historial de movimientos de stock (entradas/salidas/kardex) de un material en los últimos días.',
    zodInput: z.object({
        materialQuery: z.string().describe('Nombre o parte del nombre del material'),
        diasAtras: z.number().int().min(1).max(365).optional().default(30),
        limite: LIMIT(100, 20),
    }),
    jsonSchema: {
        type: 'object',
        properties: {
            materialQuery: { type: 'string' },
            diasAtras: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
            limite: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        required: ['materialQuery'],
    },
    requiredPermissions: ['module_pagnol:view'],
    handler: async (input, ctx) => {
        const cutoff = new Date(Date.now() - input.diasAtras * 86400000).toISOString();
        const { data, error } = await ctx.admin
            .from('stock_movements').select('*').eq('tenant_id', ctx.tenantId)
            .ilike('material_name', `%${input.materialQuery}%`)
            .gte('date', cutoff).order('date', { ascending: false }).limit(input.limite);
        if (error) throw new Error(`Error consultando kardex: ${error.message}`);
        return (data ?? []).map(mappers.stock_movements).map(m => ({
            fecha: m.date, material: m.materialName, tipo: m.type, cambio: m.quantityChange,
            stockResultante: m.newStock, motivo: m.justification, contrato: m.contractName, usuario: m.userName,
        }));
    },
};

// ─────────────────────────────────────────────────────────────────────────
// 4. Solicitudes de material pendientes
// ─────────────────────────────────────────────────────────────────────────
const solicitudesMaterialPendientes: ToolDef = {
    name: 'solicitudesMaterialPendientes',
    description: 'Lista solicitudes internas de material (pañol), opcionalmente filtradas por estado.',
    zodInput: z.object({
        estado: z.string().optional().describe("Ej: 'pending', 'approved', 'rejected', 'delivered'. Omitir para todas."),
        limite: LIMIT(50, 20),
    }),
    jsonSchema: { type: 'object', properties: { estado: { type: 'string' }, limite: { type: 'integer', minimum: 1, maximum: 50, default: 20 } } },
    requiredPermissions: ['module_pagnol:view', 'module_purchasing:view', 'module_abastecimiento:view'],
    handler: async (input, ctx) => {
        let q = ctx.admin.from('material_requests').select('*').eq('tenant_id', ctx.tenantId);
        if (input.estado) q = q.eq('status', input.estado);
        const { data, error } = await q.order('created_at', { ascending: false }).limit(input.limite);
        if (error) throw new Error(`Error consultando solicitudes: ${error.message}`);
        const reqs = (data ?? []).map(mappers.material_requests);

        const materialIds = [...new Set(reqs.flatMap(r => (r.items ?? []).map((it: any) => it.materialId)))].filter(Boolean);
        const { data: mats } = materialIds.length
            ? await ctx.admin.from('materials').select('id, name').in('id', materialIds)
            : { data: [] as { id: string; name: string }[] };
        const nameOf = (id: string) => mats?.find(m => m.id === id)?.name ?? 'Material desconocido';

        return reqs.map(r => ({
            codigo: r.internalCode ?? r.id, estado: r.status, area: r.area, contrato: r.contractName,
            solicitante: r.userName, fecha: r.createdAt,
            items: (r.items ?? []).map((it: any) => ({ material: nameOf(it.materialId), cantidad: it.quantity })),
        }));
    },
};

// ─────────────────────────────────────────────────────────────────────────
// 5. Solicitudes de compra pendientes
// ─────────────────────────────────────────────────────────────────────────
const solicitudesCompraPendientes: ToolDef = {
    name: 'solicitudesCompraPendientes',
    description: 'Lista solicitudes de compra (materiales que no hay en pañol y deben comprarse), opcionalmente filtradas por estado.',
    zodInput: z.object({
        estado: z.string().optional().describe("Ej: 'pending', 'approved', 'ordered', 'received'. Omitir para todas."),
        limite: LIMIT(50, 20),
    }),
    jsonSchema: { type: 'object', properties: { estado: { type: 'string' }, limite: { type: 'integer', minimum: 1, maximum: 50, default: 20 } } },
    requiredPermissions: ['module_purchasing:view', 'module_abastecimiento:view'],
    handler: async (input, ctx) => {
        let q = ctx.admin.from('purchase_requests').select('*').eq('tenant_id', ctx.tenantId);
        if (input.estado) q = q.eq('status', input.estado);
        const { data, error } = await q.order('created_at', { ascending: false }).limit(input.limite);
        if (error) throw new Error(`Error consultando solicitudes de compra: ${error.message}`);
        return (data ?? []).map(mappers.purchase_requests).map(pr => ({
            codigo: pr.internalCode ?? pr.id, estado: pr.status, material: pr.materialName,
            cantidad: pr.quantity, unidad: pr.unit, area: pr.area, contrato: pr.contractName,
            destino: pr.requestTarget === 'client' ? `Cliente (${pr.clientName ?? 's/n'})` : 'Proveedor', fecha: pr.createdAt,
        }));
    },
};

// ─────────────────────────────────────────────────────────────────────────
// 6. Órdenes de Trabajo
// ─────────────────────────────────────────────────────────────────────────
const ordenesDeTrabajo: ToolDef = {
    name: 'ordenesDeTrabajo',
    description: 'Lista Órdenes de Trabajo (OT), opcionalmente filtradas por estado, contrato o supervisor.',
    zodInput: z.object({
        estado: z.string().optional().describe("Ej: 'draft', 'in_review', 'approved'. Omitir para todas."),
        supervisorNombre: z.string().optional(),
        limite: LIMIT(50, 20),
    }),
    jsonSchema: {
        type: 'object',
        properties: { estado: { type: 'string' }, supervisorNombre: { type: 'string' }, limite: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
    },
    requiredPermissions: ['module_work_reports:view'],
    handler: async (input, ctx) => {
        let q = ctx.admin.from('work_orders').select('*').eq('tenant_id', ctx.tenantId);
        if (input.estado) q = q.eq('status', input.estado);
        if (input.supervisorNombre) q = q.ilike('supervisor_name', `%${input.supervisorNombre}%`);
        const { data, error } = await q.order('work_date', { ascending: false }).limit(input.limite);
        if (error) throw new Error(`Error consultando OT: ${error.message}`);
        return (data ?? []).map(mappers.work_orders).map(o => ({
            otNumero: o.otNumber, estado: o.status, cliente: o.client, area: o.area, fecha: o.workDate,
            supervisor: o.supervisorName, avanceEjecutado: o.executedPercent, avancePlanificado: o.plannedPercent,
            descripcion: o.description,
        }));
    },
};

// ─────────────────────────────────────────────────────────────────────────
// 7. Mantenimientos próximos / activos
// ─────────────────────────────────────────────────────────────────────────
const mantenimientosProximos: ToolDef = {
    name: 'mantenimientosProximos',
    description: 'Lista órdenes de mantenimiento de activos (preventivo/correctivo), abiertas o programadas para los próximos días.',
    zodInput: z.object({
        diasAdelante: z.number().int().min(1).max(90).optional().default(7),
        soloAbiertas: z.boolean().optional().default(true),
        limite: LIMIT(50, 20),
    }),
    jsonSchema: {
        type: 'object',
        properties: {
            diasAdelante: { type: 'integer', minimum: 1, maximum: 90, default: 7 },
            soloAbiertas: { type: 'boolean', default: true },
            limite: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
    },
    requiredPermissions: ['module_pagnol:view'],
    handler: async (input, ctx) => {
        let q = ctx.admin.from('maintenance_orders').select('*').eq('tenant_id', ctx.tenantId);
        if (input.soloAbiertas) q = q.in('status', ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS']);
        const { data, error } = await q.order('scheduled_date', { ascending: true, nullsFirst: false }).limit(200);
        if (error) throw new Error(`Error consultando mantenimientos: ${error.message}`);
        const cutoff = Date.now() + input.diasAdelante * 86400000;
        let items = (data ?? []).map(mappers.maintenance_orders);
        items = items.filter(m => !m.scheduledDate || new Date(m.scheduledDate).getTime() <= cutoff);
        return items.slice(0, input.limite).map(m => ({
            codigo: m.internalCode ?? m.id, activo: m.materialName, tipo: m.type, estado: m.status,
            prioridad: m.priority, fechaProgramada: m.scheduledDate, descripcion: m.description,
        }));
    },
};

// ─────────────────────────────────────────────────────────────────────────
// 8. Resumen de asistencia
// ─────────────────────────────────────────────────────────────────────────
const resumenAsistencia: ToolDef = {
    name: 'resumenAsistencia',
    description: 'Resumen de marcaciones de asistencia (entradas/salidas) de una fecha específica (por defecto hoy).',
    zodInput: z.object({ fecha: z.string().optional().describe('YYYY-MM-DD, por defecto hoy') }),
    jsonSchema: { type: 'object', properties: { fecha: { type: 'string', description: 'YYYY-MM-DD' } } },
    requiredPermissions: ['module_attendance:view'],
    handler: async (input, ctx) => {
        const fecha = input.fecha || new Date().toISOString().slice(0, 10);
        const { data, error } = await ctx.admin
            .from('attendance_logs').select('*').eq('tenant_id', ctx.tenantId).eq('date', fecha);
        if (error) throw new Error(`Error consultando asistencia: ${error.message}`);
        const logs = (data ?? []).map(mappers.attendance_logs);
        const entradas = logs.filter(l => l.type === 'in').length;
        const salidas = logs.filter(l => l.type === 'out').length;
        const personas = new Set(logs.map(l => l.userId)).size;
        return { fecha, personasConMarcacion: personas, totalEntradas: entradas, totalSalidas: salidas };
    },
};

// ─────────────────────────────────────────────────────────────────────────
// 9. Arriendos activos / pagos próximos
// ─────────────────────────────────────────────────────────────────────────
const arriendosActivos: ToolDef = {
    name: 'arriendosActivos',
    description: 'Lista contratos de arriendo activos y sus próximos pagos pendientes.',
    zodInput: z.object({ limite: LIMIT(30, 15) }),
    jsonSchema: { type: 'object', properties: { limite: { type: 'integer', minimum: 1, maximum: 30, default: 15 } } },
    requiredPermissions: ['module_rentals:view'],
    handler: async (input, ctx) => {
        const { data: contractsData, error } = await ctx.admin
            .from('rental_contracts').select('*').eq('tenant_id', ctx.tenantId).eq('status', 'active')
            .limit(input.limite);
        if (error) throw new Error(`Error consultando arriendos: ${error.message}`);
        const contracts = (contractsData ?? []).map(mappers.rental_contracts);
        const ids = contracts.map(c => c.id);
        const { data: paymentsData } = ids.length
            ? await ctx.admin.from('rental_payments').select('*').eq('tenant_id', ctx.tenantId).in('contract_id', ids).eq('status', 'pending').order('due_date', { ascending: true })
            : { data: [] as any[] };
        const payments = (paymentsData ?? []).map(mappers.rental_payments);
        return contracts.map(c => ({
            titulo: c.title, direccion: c.direction, montoMensual: c.amount, moneda: c.currency,
            proximosPagos: payments.filter(p => p.contractId === c.id).slice(0, 3).map(p => ({ vence: p.dueDate, monto: p.amount })),
        }));
    },
};

// ─────────────────────────────────────────────────────────────────────────
// 10. Pagos a proveedores pendientes (sensible → gated)
// ─────────────────────────────────────────────────────────────────────────
const pagosPendientes: ToolDef = {
    name: 'pagosPendientes',
    description: 'Lista facturas/pagos a proveedores pendientes o vencidos. Requiere permiso de Pagos.',
    zodInput: z.object({
        soloVencidos: z.boolean().optional().default(false),
        limite: LIMIT(50, 20),
    }),
    jsonSchema: {
        type: 'object',
        properties: { soloVencidos: { type: 'boolean', default: false }, limite: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
    },
    requiredPermissions: ['module_payments:view'],
    handler: async (input, ctx) => {
        let q = ctx.admin.from('supplier_payments').select('*').eq('tenant_id', ctx.tenantId).neq('status', 'paid');
        const { data, error } = await q.order('due_date', { ascending: true }).limit(200);
        if (error) throw new Error(`Error consultando pagos: ${error.message}`);
        const now = Date.now();
        let items = (data ?? []).map(mappers.supplier_payments);
        if (input.soloVencidos) items = items.filter(p => new Date(p.dueDate).getTime() < now);
        return items.slice(0, input.limite).map(p => ({
            factura: p.invoiceNumber, monto: p.amount, vence: p.dueDate, estado: p.status,
            vencida: new Date(p.dueDate).getTime() < now, obra: p.work,
        }));
    },
};

// ─────────────────────────────────────────────────────────────────────────
// 11. Buscar personal
// ─────────────────────────────────────────────────────────────────────────
const buscarPersonal: ToolDef = {
    name: 'buscarPersonal',
    description: 'Busca trabajadores/usuarios del tenant por nombre o rol. Nunca devuelve datos biométricos, KYC ni sueldos.',
    zodInput: z.object({ query: z.string().optional(), rol: z.string().optional(), limite: LIMIT(30, 15) }),
    jsonSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, rol: { type: 'string' }, limite: { type: 'integer', minimum: 1, maximum: 30, default: 15 } },
    },
    handler: async (input, ctx) => {
        let q = ctx.admin.from('profiles').select('id, name, role, rut').eq('tenant_id', ctx.tenantId).is('deleted_at', null);
        if (input.query) q = q.ilike('name', `%${input.query}%`);
        if (input.rol) q = q.eq('role', input.rol);
        const { data, error } = await q.limit(input.limite);
        if (error) throw new Error(`Error consultando personal: ${error.message}`);
        return (data ?? []).map(p => ({ nombre: p.name, rol: p.role }));
    },
};

export const pagnolTools: ToolDef[] = [
    buscarMateriales, stockPorContrato, kardexMaterial, solicitudesMaterialPendientes,
    solicitudesCompraPendientes, ordenesDeTrabajo, mantenimientosProximos, resumenAsistencia,
    arriendosActivos, pagosPendientes, buscarPersonal,
];

/** Ejecuta un tool por nombre validando input + permiso. Usado por MCP y por el wrapper Genkit. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolCtx): Promise<any> {
    const def = pagnolTools.find(t => t.name === name);
    if (!def) throw new Error(`Herramienta desconocida: ${name}`);
    if (def.requiredPermissions && !hasAny(ctx, def.requiredPermissions)) {
        throw new ToolAccessDeniedError();
    }
    const input = def.zodInput.parse(rawInput ?? {});
    return def.handler(input, ctx);
}
