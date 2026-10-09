/**
 * RFC-006 F2 — Propuesta de compra y firma por monto, ANTES de la OC.
 *
 * Abastecimiento arma la propuesta (proveedor + precios); la base decide quién
 * firma (trigger `approval_proposals_before_insert`) y sólo deja firmar a quien
 * corresponde. Con la propuesta firmada se emite UNA OC por lo firmado: lo
 * impone el trigger `purchase_orders_require_approval` en los tres caminos.
 */
import { supabase } from '@/modules/core/lib/supabase';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { notifyAuthorizers } from '@/modules/core/lib/notify-authorizers';
import { authHeaders } from '@/modules/core/lib/auth-header';
import { mappers } from '../mappers';
import { resolveSigners, deriveProposalState, canEmitWith, URGENT_REASON_MIN } from './approvalMath';
import type { ApprovalProposal, ApprovalProposalItem, ApprovalSignature, ApprovalSlot } from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

/** Push a personas puntuales. Fire-and-forget: un aviso que falla no rompe la firma. */
function pushTo(tenantId: string, userIds: string[], payload: { title: string; body: string; url: string; tag: string }) {
    if (userIds.length === 0) return;
    void (async () => {
        try {
            await fetch('/api/push/send', {
                method: 'POST',
                headers: await authHeaders(),
                body: JSON.stringify({ tenantId, targetUserIds: userIds, payload }),
            });
        } catch { /* silenciar: es sólo un aviso */ }
    })();
}

/** Los errores del trigger llegan como texto de Postgres: se muestran tal cual (están escritos para la persona). */
function friendly(error: any): Error {
    return new Error(error?.message || 'No se pudo guardar.');
}

export interface PurchaseProposalInput {
    /** RFC-006 F4: 'rental' = arriendo (se firma el valor mensual). Por defecto, compra. */
    kind?: 'purchase' | 'rental';
    sourceType: 'rfq' | 'lot' | 'rental_rfq';
    /** id de la RFQ o del lote. */
    sourceId?: string | null;
    /** RFQ: id de la oferta elegida. */
    quoteId?: string | null;
    /** Lote: pedidos que entran en la compra. En una RFQ los toma la base de la RFQ. */
    requestIds?: string[];
    supplierId?: string | null;
    supplierName?: string | null;
    items: ApprovalProposalItem[];
    /** Neto que se espera (vista previa). En una RFQ la base lo toma de la oferta. */
    netTotal: number;
    escalate?: boolean;
    escalationReason?: string;
    comparison?: ApprovalProposal['comparison'];
    /** RFC-006 F3: comprar ya y firmar después (sólo Abastecimiento, con motivo). */
    urgent?: boolean;
    urgencyReason?: string;
}

export async function createPurchaseProposal(input: PurchaseProposalInput, { user, tenantId, can }: Context): Promise<ApprovalProposal> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!can('finance:manage_purchase_orders')) throw new Error('No tienes permiso para proponer compras.');
    if (input.escalate && (input.escalationReason?.trim().length || 0) < 5) {
        throw new Error('Para mandarla al Gerente explica por qué (mínimo 5 caracteres).');
    }
    if (input.urgent && (input.urgencyReason?.trim().length || 0) < URGENT_REASON_MIN) {
        throw new Error(`Una compra urgente necesita el motivo (mínimo ${URGENT_REASON_MIN} caracteres).`);
    }

    const code = await nextInternalCode(tenantId, 'PC');
    // Vista previa: la base recalcula todo esto en el trigger y es la que manda.
    const preview = resolveSigners({ net: input.netTotal, contracts: [], escalate: input.escalate });

    const { data, error } = await supabase
        .from('approval_proposals')
        .insert({
            tenant_id: tenantId,
            internal_code: code,
            kind: input.kind || 'purchase',
            source_type: input.sourceType,
            source_id: input.sourceId || null,
            quote_id: input.quoteId || null,
            request_ids: input.requestIds || [],
            supplier_id: input.supplierId || null,
            supplier_name: input.supplierName || null,
            items: input.items,
            net_total: Math.max(1, Math.round(input.netTotal)),
            vat_rate: 0.19,
            gross_total: preview.gross || 1,
            tier: preview.tier,
            escalated: !!input.escalate,
            escalation_reason: input.escalate ? input.escalationReason!.trim() : null,
            required_signers: [],
            comparison: input.comparison ?? null,
            urgent: !!input.urgent,
            urgency_reason: input.urgent ? input.urgencyReason!.trim() : null,
            created_by: user.id,
            created_by_name: user.name,
        })
        .select()
        .single();
    if (error) throw friendly(error);
    const proposal = mappers.approval_proposals(data);

    // Aviso a quien tiene que firmar.
    const what = proposal.kind === 'rental' ? 'Arriendo' : 'Compra';
    const body = proposal.urgent
        ? `URGENTE: ${proposal.supplierName || what} por ${clp(proposal.grossTotal)} con IVA (${proposal.internalCode}). Se compra ya; tu firma queda pendiente.`
        : `${proposal.supplierName || what} por ${clp(proposal.grossTotal)} con IVA${proposal.kind === 'rental' ? ' al mes' : ''} (${proposal.internalCode}). Revísala y firma.`;
    const adcIds = proposal.requiredSigners.filter((s): s is Extract<ApprovalSlot, { kind: 'adc' }> => s.kind === 'adc').map(s => s.userId);
    pushTo(tenantId, [...new Set(adcIds)], { title: proposal.urgent ? `${what} urgente` : `${what} por firmar`, body, url: '/dashboard/authorizations', tag: `proposal-${proposal.id}` });
    if (proposal.requiredSigners.some(s => s.kind === 'gerente')) {
        notifyAuthorizers('proposal_gerente', { tenantId, code: proposal.internalCode || undefined, requesterName: user.name });
    }
    return proposal;
}

export async function signProposal(
    input: { proposalId: string; slot: ApprovalSlot; decision: 'approved' | 'rejected'; note?: string },
    { user, tenantId }: Context,
): Promise<void> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    const note = input.note?.trim() || null;
    if (input.decision === 'rejected' && (note?.length || 0) < 5) {
        throw new Error('Explica por qué la rechazas (mínimo 5 caracteres): Abastecimiento lo va a leer.');
    }
    const { error } = await supabase.from('approval_signatures').insert({
        tenant_id: tenantId,
        proposal_id: input.proposalId,
        slot_kind: input.slot.kind,
        contract_id: input.slot.kind === 'adc' ? input.slot.contractId : null,
        signer_id: user.id, // el trigger lo fija igual a quien está conectado
        signer_name: user.name,
        decision: input.decision,
        note,
    });
    if (error) throw friendly(error);

    // ¿Quedó firmada o rechazada? Se avisa a quien la propuso.
    const [{ data: p }, { data: sigs }] = await Promise.all([
        supabase.from('approval_proposals').select('*').eq('id', input.proposalId).single(),
        supabase.from('approval_signatures').select('*').eq('proposal_id', input.proposalId),
    ]);
    if (!p) return;
    const proposal = mappers.approval_proposals(p);
    const state = deriveProposalState(proposal, (sigs || []).map(mappers.approval_signatures));
    if (state === 'approved') {
        pushTo(tenantId, [proposal.createdById], {
            title: 'Compra firmada',
            body: `${proposal.internalCode} (${proposal.supplierName || ''}) está firmada: ya puedes emitir la OC.`,
            url: proposal.sourceType === 'rfq' ? `/dashboard/abastecimiento/comparador?rfq=${proposal.sourceId}` : '/dashboard/abastecimiento/ordenes',
            tag: `proposal-${proposal.id}`,
        });
    } else if (state === 'rejected') {
        pushTo(tenantId, [proposal.createdById], {
            title: 'Compra rechazada',
            body: `${proposal.internalCode}: ${note || 'rechazada'}`,
            url: proposal.sourceType === 'rfq' ? `/dashboard/abastecimiento/comparador?rfq=${proposal.sourceId}` : '/dashboard/abastecimiento/ordenes',
            tag: `proposal-${proposal.id}`,
        });
    }
}

export async function withdrawProposal(proposalId: string, reason: string, { user, tenantId, can }: Context): Promise<void> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!can('finance:manage_purchase_orders')) throw new Error('No tienes permiso para retirar propuestas.');
    if ((reason?.trim().length || 0) < 5) throw new Error('Explica por qué la retiras (mínimo 5 caracteres).');
    const { data, error } = await supabase
        .from('approval_proposals')
        .update({ withdrawn_at: new Date().toISOString(), withdrawn_by: user.id, withdrawn_reason: reason.trim() })
        .eq('id', proposalId)
        .eq('tenant_id', tenantId)
        .select('id');
    if (error) throw friendly(error);
    if (!data || data.length === 0) throw new Error('No se pudo retirar la propuesta. Recarga la página.');
}

/**
 * Carga una propuesta y verifica que esté firmada, para usarla al emitir la OC.
 * La base lo vuelve a verificar en el trigger; esto es para dar un mensaje claro
 * antes de intentar.
 */
export async function loadSignedProposal(proposalId: string, tenantId: string): Promise<ApprovalProposal> {
    const [{ data: p, error }, { data: sigs }] = await Promise.all([
        supabase.from('approval_proposals').select('*').eq('id', proposalId).eq('tenant_id', tenantId).single(),
        supabase.from('approval_signatures').select('*').eq('proposal_id', proposalId),
    ]);
    if (error || !p) throw new Error('La propuesta de compra no existe.');
    const proposal = mappers.approval_proposals(p);
    const state = deriveProposalState(proposal, (sigs || []).map(mappers.approval_signatures) as ApprovalSignature[]);
    // Urgente: se puede emitir con la firma pendiente (comprar ya, firmar después).
    if (!canEmitWith(state, proposal.urgent)) {
        throw new Error(state === 'pending'
            ? `${proposal.internalCode} todavía no está firmada.`
            : `${proposal.internalCode} está ${state === 'rejected' ? 'rechazada' : 'retirada'}: no sirve para emitir la OC.`);
    }
    return proposal;
}
