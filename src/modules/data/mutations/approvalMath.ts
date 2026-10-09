/**
 * RFC-006 — Quién firma una propuesta (compra, arriendo o retiro).
 *
 * Funciones puras: se prueban sin Supabase (approvalMath.test.ts). Es la parte
 * del flujo que más importa que no se equivoque, porque decide si una compra de
 * $2 millones la firma el ADC o el Gerente General.
 *
 * Reglas (decisión de Steven, 2026-10-07/08):
 *  - El monto se mide CON IVA. Las cotizaciones se ingresan netas y aquí se suma.
 *  - Total con IVA ≤ tramo del ADC → firma el ADC de CADA contrato involucrado.
 *  - Sobre el tramo → firma SÓLO el Gerente General.
 *  - Abastecimiento puede subir una propuesta al Gerente (escalar); nunca bajarla.
 *  - Un contrato sin ADC asignado bloquea la propuesta: nunca se cae a "cualquier ADC".
 */
import type { ApprovalSettings, ApprovalProposal, ApprovalSignature, ApprovalSlot } from '@/modules/core/lib/data';

/** Valores de fábrica = los de Valar. */
export const DEFAULT_APPROVAL_SETTINGS: ApprovalSettings = {
    adcMaxGross: 500_000,
    vatRate: 0.19,
};

/** Completa lo que falte con los valores de fábrica y descarta valores inválidos. */
export function resolveApprovalSettings(raw?: Partial<ApprovalSettings> | null): ApprovalSettings {
    const adc = Number(raw?.adcMaxGross);
    const vat = Number(raw?.vatRate);
    return {
        adcMaxGross: Number.isFinite(adc) && adc >= 0 ? Math.round(adc) : DEFAULT_APPROVAL_SETTINGS.adcMaxGross,
        vatRate: Number.isFinite(vat) && vat >= 0 && vat < 1 ? vat : DEFAULT_APPROVAL_SETTINGS.vatRate,
        ...(raw?.enforced !== undefined ? { enforced: !!raw.enforced } : {}),
    };
}

/** Total con IVA desde un neto (CLP en enteros). */
export function grossFromNet(net: number, vatRate: number): number {
    if (!Number.isFinite(net) || net <= 0) return 0;
    return Math.round(net * (1 + vatRate));
}

export type ApprovalTier = 'adc' | 'gerente';

export interface ContractRef {
    id: string;
    name?: string | null;
    adcUserId?: string | null;
}

export type RequiredSigner =
    | { kind: 'adc'; contractId: string; contractName: string; userId: string }
    | { kind: 'gerente' };

export interface SignerResolution {
    net: number;
    gross: number;
    tier: ApprovalTier;
    /** true si el monto ya pedía al ADC pero Abastecimiento la subió al Gerente. */
    escalated: boolean;
    signers: RequiredSigner[];
    /** Contratos sin ADC asignado. Si hay alguno, la propuesta NO puede enviarse a firma. */
    contractsWithoutAdc: { id: string; name: string }[];
    /** true cuando la propuesta tiene todo lo necesario para pedir las firmas. */
    ready: boolean;
}

export function resolveSigners(input: {
    net: number;
    settings?: Partial<ApprovalSettings> | null;
    /** Contratos de los pedidos que junta la propuesta (se deduplican por id). */
    contracts: ContractRef[];
    escalate?: boolean;
}): SignerResolution {
    const settings = resolveApprovalSettings(input.settings);
    const net = Number.isFinite(input.net) && input.net > 0 ? Math.round(input.net) : 0;
    const gross = grossFromNet(net, settings.vatRate);
    const byAmount: ApprovalTier = gross > settings.adcMaxGross ? 'gerente' : 'adc';
    // Escalar sólo sube: si el monto ya pide al Gerente, no hay nada que subir.
    const escalated = byAmount === 'adc' && !!input.escalate;
    const tier: ApprovalTier = escalated ? 'gerente' : byAmount;

    if (tier === 'gerente') {
        return { net, gross, tier, escalated, signers: [{ kind: 'gerente' }], contractsWithoutAdc: [], ready: true };
    }

    const unique = new Map<string, ContractRef>();
    for (const c of input.contracts) if (c?.id && !unique.has(c.id)) unique.set(c.id, c);

    const signers: RequiredSigner[] = [];
    const contractsWithoutAdc: { id: string; name: string }[] = [];
    for (const c of unique.values()) {
        const name = c.name || 'Contrato';
        if (c.adcUserId) signers.push({ kind: 'adc', contractId: c.id, contractName: name, userId: c.adcUserId });
        else contractsWithoutAdc.push({ id: c.id, name });
    }

    // Sin contrato no hay ADC a quién pedirle la firma: también bloquea.
    const ready = unique.size > 0 && contractsWithoutAdc.length === 0;
    return { net, gross, tier, escalated, signers, contractsWithoutAdc, ready };
}

// ── F2: estado de una propuesta, derivado de sus firmas ──────────────────────
// Espejo de `approval_proposal_state()` (migración 20261010000000). Si cambias
// una de las dos, cambia la otra: la base decide si una OC puede nacer, y esta
// función decide lo que ve la pantalla.


export type ProposalState = 'pending' | 'approved' | 'rejected' | 'withdrawn';

const slotKey = (s: { kind?: string; slotKind?: string; contractId?: string | null }) =>
    `${s.kind ?? s.slotKind}:${(s.kind ?? s.slotKind) === 'gerente' ? '' : (s.contractId ?? '')}`;

export function deriveProposalState(
    proposal: Pick<ApprovalProposal, 'id' | 'withdrawnAt' | 'requiredSigners'>,
    signatures: readonly Pick<ApprovalSignature, 'proposalId' | 'slotKind' | 'contractId' | 'decision'>[],
): ProposalState {
    if (proposal.withdrawnAt) return 'withdrawn';
    const mine = signatures.filter(s => s.proposalId === proposal.id);
    if (mine.some(s => s.decision === 'rejected')) return 'rejected';
    const signed = new Set(mine.filter(s => s.decision === 'approved').map(s => slotKey(s)));
    if (proposal.requiredSigners.length > 0 && proposal.requiredSigners.every(slot => signed.has(slotKey(slot)))) {
        return 'approved';
    }
    return 'pending';
}

/** Puestos de firma que todavía no se firman. */
export function pendingSlots(
    proposal: Pick<ApprovalProposal, 'id' | 'requiredSigners'>,
    signatures: readonly Pick<ApprovalSignature, 'proposalId' | 'slotKind' | 'contractId'>[],
): ApprovalSlot[] {
    const done = new Set(signatures.filter(s => s.proposalId === proposal.id).map(s => slotKey(s)));
    return proposal.requiredSigners.filter(slot => !done.has(slotKey(slot)));
}

/**
 * ¿Puede esta persona firmar este puesto? Misma regla que el trigger
 * `approval_signatures_before_insert`: el ADC asignado al contrato o el Gerente
 * General; administración puede firmar cualquiera (control total de su empresa).
 */
export function canSignSlot(user: { id: string; role: string } | null | undefined, slot: ApprovalSlot): boolean {
    if (!user) return false;
    if (user.role === 'administrador' || user.role === 'soporte-pagnol' || user.role === 'super-admin') return true;
    if (slot.kind === 'gerente') return user.role === 'gerente-general';
    return slot.userId === user.id;
}

// ── F3: urgencias ─────────────────────────────────────────────────────────────

/** Mínimo para el motivo de una compra urgente (también lo exige la base). */
export const URGENT_REASON_MIN = 10;

/** Quién puede marcar una compra como urgente (mismo criterio que la base). */
export const URGENT_ROLES = ['abastecimiento', 'administrador', 'soporte-pagnol', 'super-admin'];

/**
 * ¿Se puede emitir la OC con esta propuesta? Firmada, o urgente con la firma
 * todavía pendiente (comprar ya, firmar después). Misma regla que el trigger
 * `purchase_orders_require_approval`.
 */
export function canEmitWith(state: ProposalState, urgent: boolean): boolean {
    return state === 'approved' || (urgent && state === 'pending');
}

// ── F4: arriendos ─────────────────────────────────────────────────────────────

const CYCLE_TO_MONTH: Record<string, number> = { monthly: 1, biweekly: 2, weekly: 4, daily: 30 };

/**
 * Valor MENSUAL neto de una oferta de arriendo: es lo que se firma (decisión de
 * Steven). Precio por período × períodos en un mes; pago único = el precio
 * completo; si el arriendo dura menos de un mes, el total estimado.
 * Espejo de `public.rental_monthly_net()` (migración 20261012000000).
 */
export function rentalMonthlyNet(pricePerPeriod: number, billingCycle?: string | null, totalEstimate?: number | null): number {
    const price = Number(pricePerPeriod) || 0;
    const cycle = billingCycle || 'monthly';
    if (cycle === 'one_time') return Math.round(price);
    const monthly = price * (CYCLE_TO_MONTH[cycle] ?? 1);
    const total = Number(totalEstimate) || 0;
    return Math.round(total > 0 ? Math.min(monthly, total) : monthly);
}

// ── F5: retiros del pañol ─────────────────────────────────────────────────────

/**
 * Valor NETO de un retiro: Σ cantidad × costo registrado del material.
 * Espejo de `public.withdrawal_value_net()` (migración 20261013000000).
 */
export function withdrawalValueNet(
    items: readonly { materialId: string; quantity: number }[] | null | undefined,
    unitCostById: ReadonlyMap<string, number | null | undefined>,
): number {
    let sum = 0;
    for (const it of items || []) sum += (Number(it.quantity) || 0) * (Number(unitCostById.get(it.materialId)) || 0);
    return Math.round(sum);
}
