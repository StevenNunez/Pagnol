"use client";

import { useMemo } from "react";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import type { ContractWorker, MaterialRequest, ReturnRequest, WithdrawalReview, WithdrawalReviewResolution } from "@/modules/core/lib/data";
import {
    canReviewRequest, indexReviews, summarizeReview, resolveObservations,
    type RequestReviewSummary, type ObservationState,
} from "@/modules/data/mutations/withdrawalReviewMath";

export interface ReviewableWithdrawal {
    req: MaterialRequest;
    summary: RequestReviewSummary;
    facts: WithdrawalReview[];
}

/** Una línea marcada "no corresponde", con en qué quedó. */
export interface WithdrawalObservation {
    fact: WithdrawalReview;
    req: MaterialRequest;
    state: ObservationState;
    resolution?: WithdrawalReviewResolution;
}

/**
 * Retiros entregados con revisión posterior que ESTE usuario puede revisar
 * (los de sus contratos; todos si ve todos los contratos; nunca los propios),
 * con el estado de su revisión derivado de los hechos.
 */
export function useReviewableWithdrawals() {
    const { requests, withdrawalReviews, withdrawalReviewResolutions, returnRequests, contractWorkers, can } = useAppState();
    const { user } = useAuth();
    const canReview = can("material_requests:review_withdrawals");
    const seesAllContracts = can("material_requests:select_any_contract");

    return useMemo(() => {
        const empty = {
            canReview,
            all: [] as ReviewableWithdrawal[], pending: [] as ReviewableWithdrawal[], reviewed: [] as ReviewableWithdrawal[],
            observations: [] as WithdrawalObservation[], openObservations: 0,
        };
        if (!user || !canReview) return empty;

        const myContractIds = new Set(
            ((contractWorkers || []) as ContractWorker[]).filter(cw => cw.userId === user.id).map(cw => cw.contractId)
        );
        const byRequest = indexReviews((withdrawalReviews || []) as WithdrawalReview[]);
        const reviewer = { id: user.id, seesAllContracts, contractIds: myContractIds };

        const all: ReviewableWithdrawal[] = [];
        for (const req of (requests || []) as MaterialRequest[]) {
            if (!req.requiresReview) continue;
            const items = Array.isArray(req.items) ? req.items : [];
            const reviewable = { ...req, items };
            if (!canReviewRequest(reviewable, reviewer)) continue;
            const facts = byRequest.get(req.id) || [];
            all.push({ req, facts, summary: summarizeReview(reviewable, facts) });
        }
        all.sort((a, b) => new Date(b.req.createdAt as any).getTime() - new Date(a.req.createdAt as any).getTime());

        // ── Observaciones: líneas "no corresponde" y si ya volvieron o se justificaron.
        const resolutionByReview = new Map(
            ((withdrawalReviewResolutions || []) as WithdrawalReviewResolution[]).map(r => [r.reviewId, r])
        );
        const flagged = all.flatMap(w => w.facts.filter(f => f.decision === "unauthorized").map(fact => ({ fact, req: w.req })));
        const states = resolveObservations(
            flagged.map(({ fact, req }) => ({
                reviewId: fact.id, requestId: req.id, workerId: req.supervisorId,
                materialId: fact.materialId, quantity: fact.quantity, withdrawnAt: new Date(req.createdAt as any),
            })),
            ((returnRequests || []) as ReturnRequest[]).map(r => ({
                id: r.id, internalCode: r.internalCode, workerId: r.supervisorId, materialId: r.materialId,
                quantity: Number(r.quantity) || 0, status: r.status,
                at: new Date((r.completionDate || r.createdAt) as any),
            })),
            new Set(resolutionByReview.keys()),
        );
        const observations: WithdrawalObservation[] = flagged
            .map(({ fact, req }) => ({ fact, req, state: states.get(fact.id)!, resolution: resolutionByReview.get(fact.id) }))
            // Abiertas primero (las más antiguas arriba); después lo cerrado, lo más reciente arriba.
            .sort((a, b) => {
                const ao = a.state.status === "open", bo = b.state.status === "open";
                if (ao !== bo) return ao ? -1 : 1;
                const at = new Date(a.req.createdAt as any).getTime(), bt = new Date(b.req.createdAt as any).getTime();
                return ao ? at - bt : bt - at;
            });

        return {
            canReview,
            observations,
            openObservations: observations.filter(o => o.state.status === "open").length,
            all,
            // Los más antiguos primero: es lo que lleva más tiempo esperando.
            pending: all.filter(w => w.summary.state !== "reviewed").reverse(),
            reviewed: all.filter(w => w.summary.state === "reviewed"),
        };
    }, [requests, withdrawalReviews, withdrawalReviewResolutions, returnRequests, contractWorkers, user, canReview, seesAllContracts]);
}
