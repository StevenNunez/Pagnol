import { supabase } from '@/modules/core/lib/supabase';
import type { MutationContext as Context } from './context';

/**
 * Revisión posterior de retiros (tabla `withdrawal_reviews`, append-only).
 *
 * El supervisor marca cada línea de un retiro ya entregado como autorizada o
 * no autorizada (con motivo). No hay UPDATE ni DELETE: lo no autorizado se
 * resuelve después con hechos nuevos (etapa 3), nunca reescribiendo esto.
 */

export interface ReviewLine {
    materialId: string;
    materialName: string;
    quantity: number;
    decision: 'authorized' | 'unauthorized';
    reason?: string | null;
}

export async function reviewWithdrawal(
    params: { requestId: string; lines: ReviewLine[] },
    { user, tenantId, can }: Context,
): Promise<void> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!can('material_requests:review_withdrawals')) {
        throw new Error('No tienes permiso para revisar retiros.');
    }
    if (params.lines.length === 0) throw new Error('No hay líneas que revisar.');

    for (const l of params.lines) {
        if (l.decision === 'unauthorized' && !l.reason?.trim()) {
            throw new Error(`Indica por qué "${l.materialName}" no corresponde.`);
        }
    }

    // La RLS también lo exige; acá es para devolver un mensaje entendible.
    const { data: req, error: reqErr } = await supabase
        .from('material_requests')
        .select('id, supervisor_id, requires_review')
        .eq('id', params.requestId)
        .single();
    if (reqErr || !req) throw new Error('No se encontró el retiro.');
    if (!req.requires_review) throw new Error('Este retiro no salió con revisión posterior.');
    if (req.supervisor_id === user.id) throw new Error('No puedes revisar tu propio retiro.');

    const rows = params.lines.map(l => ({
        tenant_id: tenantId,
        request_id: params.requestId,
        material_id: l.materialId,
        material_name: l.materialName,
        quantity: l.quantity,
        decision: l.decision,
        reason: l.decision === 'unauthorized' ? l.reason!.trim() : (l.reason?.trim() || null),
        reviewer_id: user.id,
        reviewer_name: user.name,
    }));

    // `.select()` como guarda: un INSERT que la RLS rechaza en silencio no
    // debe pasar por revisión hecha.
    const { data, error } = await supabase.from('withdrawal_reviews').insert(rows).select('id');
    if (error) {
        if (error.code === '23505') {
            throw new Error('Alguien ya revisó una de estas líneas. Recarga para ver lo que quedó pendiente.');
        }
        throw error;
    }
    if (!data || data.length !== rows.length) {
        throw new Error('La revisión no se guardó completa (permiso denegado). Recarga e intenta de nuevo.');
    }
}

/**
 * Cierra con una justificación una línea marcada "no corresponde" (etapa 3).
 * Para lo que no va a volver al pañol: típicamente un consumible ya gastado.
 * Lo devuelto se cierra solo (se deriva de las devoluciones); esto no.
 */
export async function justifyWithdrawalObservation(
    params: { reviewId: string; note: string },
    { user, tenantId, can }: Context,
): Promise<void> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!can('material_requests:resolve_observations')) {
        throw new Error('No tienes permiso para cerrar observaciones de retiros.');
    }
    const note = params.note.trim();
    if (!note) throw new Error('Escribe la justificación.');

    const { data, error } = await supabase.from('withdrawal_review_resolutions').insert({
        tenant_id: tenantId,
        review_id: params.reviewId,
        note,
        resolved_by: user.id,
        resolved_by_name: user.name,
    }).select('id');
    if (error) {
        if (error.code === '23505') throw new Error('Esta observación ya fue cerrada.');
        throw error;
    }
    if (!data || data.length === 0) {
        throw new Error('No se guardó (permiso denegado). Recarga e intenta de nuevo.');
    }
}
