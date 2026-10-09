/**
 * RFC-006 F1 — Revisión del Jefe de Operaciones.
 *
 * Lo que pide terreno (compras a proveedor y arriendos) pasa primero por el
 * Jefe de Operaciones: corrige cantidades o la descripción, saca líneas que no
 * corresponden y aprueba o rechaza. Recién después llega al ADC.
 *
 * La revisión queda con autor y hora (Art. 5). Si quien revisa además puede
 * autorizar como ADC (administración, director de faena), la revisión también
 * levanta el gate del ADC: no tiene sentido pedirle dos clics a la misma persona.
 */
import { supabase } from '@/modules/core/lib/supabase';
import { notifyAuthorizers } from '@/modules/core/lib/notify-authorizers';
import { needsOpsReview } from '@/modules/core/lib/ops-review';
import type { MutationContext as Context } from './context';

/** Mínimo para un motivo de rechazo: que diga algo, no "no". */
export const OPS_REJECT_REASON_MIN = 5;

export interface PurchaseReviewLine {
    id: string;
    /** Cantidad corregida. Si no cambia, se omite. */
    quantity?: number;
    /** Descripción corregida (el "qué exactamente"). */
    itemDescription?: string | null;
    /** Sacar esta línea del pedido (las demás siguen). */
    remove?: boolean;
}

/**
 * Revisa un pedido de compra (todas sus líneas juntas: mismo `batch_id`).
 * `decision='reject'` rechaza el pedido entero; `'approve'` aprueba las líneas
 * que quedan y rechaza las marcadas con `remove`.
 */
export async function reviewPurchaseRequests(
    input: { lines: PurchaseReviewLine[]; decision: 'approve' | 'reject'; note?: string },
    { user, tenantId, can }: Context,
): Promise<{ approved: number; rejected: number }> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!can('purchase_requests:review_operations')) {
        throw new Error('No tienes permiso para revisar requerimientos.');
    }
    const ids = input.lines.map(l => l.id);
    if (ids.length === 0) throw new Error('El pedido no tiene líneas.');

    const note = input.note?.trim() || null;
    const removing = input.lines.filter(l => l.remove);
    if ((input.decision === 'reject' || removing.length > 0) && (note?.length || 0) < OPS_REJECT_REASON_MIN) {
        throw new Error(`Explica por qué (mínimo ${OPS_REJECT_REASON_MIN} caracteres): el supervisor lo va a ver.`);
    }
    if (input.decision === 'approve' && removing.length === input.lines.length) {
        throw new Error('Sacaste todas las líneas: mejor rechaza el pedido.');
    }

    const { data: rows, error: fetchErr } = await supabase
        .from('purchase_requests')
        .select('id, status, quantity, original_quantity, item_description, request_target, rental_request_id, ops_reviewed_at, adc_authorized_at, internal_code')
        .in('id', ids)
        .eq('tenant_id', tenantId);
    if (fetchErr) throw fetchErr;
    if (!rows || rows.length !== ids.length) throw new Error('El pedido cambió mientras lo revisabas. Recarga la página.');

    for (const r of rows) {
        if (r.status !== 'pending' || r.ops_reviewed_at || r.adc_authorized_at) {
            throw new Error(`${r.internal_code || 'Una línea'} ya fue revisada por otra persona. Recarga la página.`);
        }
        if (!needsOpsReview({ requestTarget: r.request_target, rentalRequestId: r.rental_request_id })) {
            throw new Error(`${r.internal_code || 'Una línea'} no pasa por revisión de operaciones.`);
        }
    }

    const now = new Date().toISOString();
    const reviewed = { ops_reviewed_at: now, ops_reviewed_by: user.id, ops_reviewed_by_name: user.name, ops_review_note: note };
    // Quien revisa y además autoriza (admin, director) deja el pedido listo para Abastecimiento.
    const alsoAuthorize = can('purchase_requests:authorize');
    const rejectReason = `Revisión del Jefe de Operaciones: ${note}`;
    const byId = new Map(rows.map(r => [r.id, r]));

    let approved = 0;
    let rejected = 0;
    for (const line of input.lines) {
        const row = byId.get(line.id)!;
        const reject = input.decision === 'reject' || !!line.remove;
        const payload: Record<string, any> = { ...reviewed };
        if (reject) {
            payload.status = 'rejected';
            payload.rejection_date = now;
            payload.rejection_reason = rejectReason;
        } else {
            const qty = line.quantity !== undefined ? Number(line.quantity) : row.quantity;
            if (!Number.isFinite(qty) || qty <= 0) throw new Error('Las cantidades tienen que ser mayores que cero.');
            if (qty !== row.quantity) {
                payload.quantity = qty;
                // La cantidad que pidió terreno se conserva una sola vez: es la referencia.
                if (row.original_quantity == null) payload.original_quantity = row.quantity;
            }
            if (line.itemDescription !== undefined && (line.itemDescription || null) !== (row.item_description || null)) {
                payload.item_description = line.itemDescription || null;
            }
            if (alsoAuthorize) {
                payload.adc_authorized_at = now;
                payload.adc_authorized_by = user.id;
            }
        }
        // `.select()`: un UPDATE que la RLS no deja pasar devuelve 0 filas sin error.
        const { data: updated, error } = await supabase
            .from('purchase_requests')
            .update(payload)
            .eq('id', line.id)
            .eq('tenant_id', tenantId)
            .is('ops_reviewed_at', null)
            .select('id');
        if (error) throw error;
        if (!updated || updated.length === 0) throw new Error('No se pudo guardar la revisión (¿otra persona la revisó recién?). Recarga la página.');
        if (reject) rejected++; else approved++;
    }

    if (approved > 0 && !alsoAuthorize) {
        notifyAuthorizers('purchase', { tenantId, code: rows[0].internal_code || undefined, requesterName: user.name });
    }
    return { approved, rejected };
}

/**
 * Revisa una solicitud de arriendo. Puede corregir la cantidad de cada equipo
 * (por posición en `items`); rechazar exige motivo.
 */
export async function reviewRentalRequest(
    input: { id: string; decision: 'approve' | 'reject'; quantities?: number[]; note?: string },
    { user, tenantId, can }: Context,
): Promise<void> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!can('rentals:review_operations')) {
        throw new Error('No tienes permiso para revisar solicitudes de arriendo.');
    }
    const note = input.note?.trim() || null;
    if (input.decision === 'reject' && (note?.length || 0) < OPS_REJECT_REASON_MIN) {
        throw new Error(`Explica por qué (mínimo ${OPS_REJECT_REASON_MIN} caracteres): el supervisor lo va a ver.`);
    }

    const { data: row, error: fetchErr } = await supabase
        .from('rental_requests')
        .select('id, status, items, ops_reviewed_at, adc_authorized_at, internal_code')
        .eq('id', input.id)
        .eq('tenant_id', tenantId)
        .single();
    if (fetchErr || !row) throw new Error('La solicitud de arriendo no existe.');
    if (row.status !== 'pending' || row.ops_reviewed_at || row.adc_authorized_at) {
        throw new Error('Esta solicitud ya fue revisada por otra persona. Recarga la página.');
    }

    const now = new Date().toISOString();
    const payload: Record<string, any> = {
        ops_reviewed_at: now, ops_reviewed_by: user.id, ops_reviewed_by_name: user.name, ops_review_note: note,
    };
    if (input.decision === 'reject') {
        payload.status = 'rejected';
        payload.rejection_date = now;
        payload.rejection_reason = `Revisión del Jefe de Operaciones: ${note}`;
        payload.approver_id = user.id;
        payload.approver_name = user.name;
    } else {
        if (input.quantities) {
            const items = Array.isArray(row.items) ? row.items : [];
            if (input.quantities.length !== items.length) throw new Error('La solicitud cambió mientras la revisabas. Recarga la página.');
            if (input.quantities.some(q => !Number.isFinite(q) || q <= 0)) throw new Error('Las cantidades tienen que ser mayores que cero.');
            const changed = items.some((it: any, i: number) => Number(it.quantity) !== input.quantities![i]);
            if (changed) {
                // La cantidad pedida por terreno se conserva en el ítem como referencia.
                payload.items = items.map((it: any, i: number) => ({
                    ...it,
                    quantity: input.quantities![i],
                    ...(Number(it.quantity) !== input.quantities![i] && it.originalQuantity == null ? { originalQuantity: Number(it.quantity) } : {}),
                }));
                payload.quantity = input.quantities[0]; // columna legacy espejo del primer ítem
            }
        }
        if (can('rentals:authorize')) {
            payload.adc_authorized_at = now;
            payload.adc_authorized_by = user.id;
        }
    }

    const { data: updated, error } = await supabase
        .from('rental_requests')
        .update(payload)
        .eq('id', input.id)
        .eq('tenant_id', tenantId)
        .is('ops_reviewed_at', null)
        .select('id');
    if (error) throw error;
    if (!updated || updated.length === 0) throw new Error('No se pudo guardar la revisión (¿otra persona la revisó recién?). Recarga la página.');

    if (input.decision === 'approve' && !payload.adc_authorized_at) {
        notifyAuthorizers('rental', { tenantId, code: row.internal_code || undefined, requesterName: user.name });
    }
}
