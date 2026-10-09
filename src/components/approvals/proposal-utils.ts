import type { ApprovalProposal, ApprovalSignature, PurchaseOrder } from '@/modules/core/lib/data';
import { deriveProposalState, type ProposalState } from '@/modules/data/mutations/approvalMath';

export interface ProposalView {
    proposal: ApprovalProposal;
    state: ProposalState;
    signatures: ApprovalSignature[];
    /** OC emitida con esta propuesta (no anulada), si ya se emitió. */
    orderId: string | null;
}

/**
 * Propuestas de un origen (una RFQ o un lote), la más reciente primero, con su
 * estado derivado de las firmas y la OC que salió de ella.
 */
export function proposalsForSource(
    proposals: readonly ApprovalProposal[] | null | undefined,
    signatures: readonly ApprovalSignature[] | null | undefined,
    orders: readonly PurchaseOrder[] | null | undefined,
    match: (p: ApprovalProposal) => boolean,
): ProposalView[] {
    const sigs = (signatures || []) as ApprovalSignature[];
    const liveOrderByProposal = new Map<string, string>();
    for (const o of orders || []) {
        if (o.approvalProposalId && o.status !== 'cancelled') liveOrderByProposal.set(o.approvalProposalId, o.id);
    }
    return (proposals || [])
        .filter(match)
        .map(p => ({
            proposal: p,
            state: deriveProposalState(p, sigs),
            signatures: sigs.filter(s => s.proposalId === p.id),
            orderId: liveOrderByProposal.get(p.id) ?? null,
        }))
        .sort((a, b) => b.proposal.createdAt.localeCompare(a.proposal.createdAt));
}

/** La propuesta que manda ahora: pendiente o firmada (las rechazadas/retiradas quedan como historia). */
export function currentProposal(views: ProposalView[]): ProposalView | null {
    return views.find(v => v.state === 'pending' || v.state === 'approved') ?? null;
}

export const STATE_META: Record<ProposalState, { label: string; cls: string }> = {
    pending: { label: 'Esperando firma', cls: 'badge-warning' },
    approved: { label: 'Firmada', cls: 'badge-success' },
    rejected: { label: 'Rechazada', cls: 'bg-destructive/10 text-destructive' },
    withdrawn: { label: 'Retirada', cls: 'bg-muted text-muted-foreground' },
};

export const clp = (n: number) => `$${Math.round(n || 0).toLocaleString('es-CL')}`;
