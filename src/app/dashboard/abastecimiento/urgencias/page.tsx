"use client";

import { PageShell } from "@/components/page-shell";
import { UrgentPurchasesReport } from "@/components/approvals/urgent-purchases-report";

// RFC-006 F3 — Compras que se emitieron antes de la firma, con su motivo y cómo terminó.
export default function UrgenciasPage() {
    return (
        <PageShell
            title="Compras urgentes"
            description="Compras emitidas antes de la firma: el motivo, quién la pidió y si la firma se ratificó o se rechazó."
        >
            <UrgentPurchasesReport />
        </PageShell>
    );
}
