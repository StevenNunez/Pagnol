import type { SolicitudCompraDTO } from './schemas';

// Solicitudes de compra de Pagnol → DTO de los eventos `solicitud_compra.*`.
// Una solicitud es el grupo `batch_id` (o la fila sola): cada fila es una línea.
// Nada de esto toca la base: se prueba solo (solicitudes.test.ts).

export interface SolicitudRow {
    id: string;
    batch_id: string | null;
    internal_code: string | null;
    material_name: string | null;
    item_description: string | null;
    quantity: number | string;
    unit: string | null;
    category: string | null;
    request_type: string | null;
    justification: string | null;
    supervisor_id: string | null;
    requester_name: string | null;
    contract_id: string | null;
    contract_name: string | null;
    area: string | null;
    urgency: string | null;
    urgency_reason: string | null;
    needed_by: string | null;
    status: string;
    rejection_reason: string | null;
    adc_authorized_at: string | null;
    adc_authorized_by: string | null;
    ops_reviewed_by: string | null;
    ops_reviewed_by_name: string | null;
    created_at: string;
}

type Estado = SolicitudCompraDTO['estado'];
type LineaEstado = SolicitudCompraDTO['lineas'][number]['estado'];

export function lineaSolicitudEstado(r: Pick<SolicitudRow, 'status' | 'adc_authorized_at'>): LineaEstado {
    if (r.status === 'rejected') return 'rechazada';
    return r.adc_authorized_at ? 'autorizada' : 'pendiente';
}

/** Rechazada si no queda línea viva; aprobada si las vivas están todas autorizadas; pendiente en otro caso. */
export function solicitudEstado(lineas: readonly { estado: LineaEstado }[]): Estado {
    const vivas = lineas.filter(l => l.estado !== 'rechazada');
    if (vivas.length === 0) return 'rechazada';
    return vivas.every(l => l.estado === 'autorizada') ? 'aprobada' : 'pendiente';
}

const byCreated = (a: SolicitudRow, b: SolicitudRow) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** `names`: nombre por id de usuario, para quien autorizó (la fila sólo guarda su id). */
export function toSolicitudCompraDTO(resourceId: string, rows: readonly SolicitudRow[], names: ReadonlyMap<string, string>): SolicitudCompraDTO {
    const sorted = [...rows].sort(byCreated);
    const first = sorted[0];
    const lineas = sorted.map(r => {
        const desc = [r.material_name, r.item_description].map(x => x?.trim()).filter(Boolean);
        return {
            id: r.id,
            // Si la descripción repite el nombre, no se escribe dos veces.
            descripcion: desc.length === 2 && desc[0] === desc[1] ? desc[0]! : desc.join(' — '),
            categoria: r.category || null,
            tipo: r.request_type === 'servicio' ? 'servicio' as const : 'producto' as const,
            cantidad: Number(r.quantity),
            unidad: r.unit || null,
            estado: lineaSolicitudEstado(r),
        };
    });
    const estado = solicitudEstado(lineas);
    const rechazadas = sorted.filter(r => r.status === 'rejected');
    const autorizada = sorted.find(r => r.adc_authorized_by);
    const revisada = sorted.find(r => r.ops_reviewed_by);
    return {
        id: resourceId,
        codigo: first.internal_code || null,
        estado,
        solicitante: first.supervisor_id ? { id: first.supervisor_id, nombre: first.requester_name ?? names.get(first.supervisor_id) ?? '' } : null,
        contrato: first.contract_id ? { id: first.contract_id, nombre: first.contract_name ?? '' } : null,
        area: first.area || null,
        motivo: first.justification || null,
        prioridad: first.urgency === 'alta' ? 'urgente' : 'normal',
        motivo_urgencia: first.urgency_reason || null,
        necesaria_para: first.needed_by ? String(first.needed_by).slice(0, 10) : null,
        origen: 'manual',
        lineas,
        revisada_por: revisada ? { id: revisada.ops_reviewed_by!, nombre: revisada.ops_reviewed_by_name ?? names.get(revisada.ops_reviewed_by!) ?? '' } : null,
        autorizada_por: autorizada ? { id: autorizada.adc_authorized_by!, nombre: names.get(autorizada.adc_authorized_by!) ?? '' } : null,
        motivo_rechazo: estado === 'rechazada' ? (rechazadas.find(r => r.rejection_reason)?.rejection_reason ?? null) : null,
        created_at: new Date(first.created_at).toISOString(),
    };
}
