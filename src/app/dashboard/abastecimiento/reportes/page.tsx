"use client";

import React, { useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PageShell } from "@/components/page-shell";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/modules/core/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { PurchaseOrder, QuoteRequest } from "@/modules/core/lib/data";
import {
    FileDown, ShoppingCart, FileText, PackageCheck, TrendingDown, DollarSign, Building2, Target,
} from "lucide-react";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fmtDate = (d?: string | Date) => (d ? new Date(d).toLocaleDateString("es-CL") : "—");

type Period = "month" | "year" | "all";

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{children}</p>;
}

// Ahorro de una RFQ adjudicada: oferta ganadora vs. la más cara recibida.
function rfqSaving(rfq: QuoteRequest): { winner: number; baseline: number; saving: number } | null {
    if (rfq.status !== "awarded" || !rfq.awardedQuoteId) return null;
    const winner = rfq.responses.find((r) => r.id === rfq.awardedQuoteId);
    if (!winner) return null;
    const totals = rfq.responses.map((r) => r.totalPrice || 0).filter((n) => n > 0);
    if (totals.length < 2) return { winner: winner.totalPrice || 0, baseline: winner.totalPrice || 0, saving: 0 };
    const baseline = Math.max(...totals);
    return { winner: winner.totalPrice || 0, baseline, saving: baseline - (winner.totalPrice || 0) };
}

const inPeriod = (d: Date | string | undefined, period: Period) => {
    if (period === "all") return true;
    if (!d) return false;
    const date = new Date(d);
    const now = new Date();
    if (period === "year") return date.getFullYear() === now.getFullYear();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
};

export default function ReportesPage() {
    const { purchaseRequests, purchaseOrders, quoteRequests, supplierPayments, goodsReceipts, costCenters } = useAppState();
    const { toast } = useToast();
    const [period, setPeriod] = useState<Period>("month");

    const periodLabel = period === "month" ? "Este mes" : period === "year" ? "Este año" : "Histórico";

    const data = useMemo(() => {
        const prs = purchaseRequests || [];
        const pos = (purchaseOrders || []).filter((po) => inPeriod(po.createdAt, period));
        const activePos = pos.filter((po) => po.status !== "cancelled");
        const rfqs = (quoteRequests || []).filter((r) => inPeriod(r.createdAt, period));
        const pays = (supplierPayments || []).filter((p) => inPeriod(p.issueDate, period));
        const receipts = (goodsReceipts || []).filter((r) => inPeriod(r.receivedAt, period));

        const committed = activePos.reduce((a, po) => a + (po.totalAmount || 0), 0);
        const received = activePos.filter((po) => po.status === "completed").reduce((a, po) => a + (po.totalAmount || 0), 0);

        const savings = rfqs.map(rfqSaving).filter(Boolean) as { winner: number; baseline: number; saving: number }[];
        const totalSaving = savings.reduce((a, s) => a + s.saving, 0);

        const paid = pays.filter((p) => p.status === "paid").reduce((a, p) => a + (p.amount || 0), 0);
        const pendingPay = pays.filter((p) => p.status !== "paid").reduce((a, p) => a + (p.amount || 0), 0);

        // Top proveedores por monto de OC.
        const bySupplier = new Map<string, { name: string; amount: number; orders: number }>();
        for (const po of activePos) {
            const key = po.supplierId || po.supplierName || "—";
            const cur = bySupplier.get(key) || { name: po.supplierName || "Sin proveedor", amount: 0, orders: 0 };
            cur.amount += po.totalAmount || 0;
            cur.orders += 1;
            bySupplier.set(key, cur);
        }
        const topSuppliers = Array.from(bySupplier.values()).sort((a, b) => b.amount - a.amount).slice(0, 8);

        return {
            pendingRequests: prs.filter((pr) => pr.status === "pending").length,
            approvedRequests: prs.filter((pr) => pr.status === "approved").length,
            activeOrders: activePos.filter((po) => ["generated", "sent", "issued"].includes(po.status)).length,
            completedOrders: activePos.filter((po) => po.status === "completed").length,
            committed, received,
            awardedRfqs: rfqs.filter((r) => r.status === "awarded").length,
            totalSaving,
            paid, pendingPay,
            receipts: receipts.length,
            topSuppliers,
            rfqsAwarded: rfqs.filter((r) => r.status === "awarded"),
        };
    }, [purchaseRequests, purchaseOrders, quoteRequests, supplierPayments, goodsReceipts, period]);

    const ccRollup = useMemo(() => {
        return (costCenters || []).map((cc) => {
            const committed = (purchaseOrders || [])
                .filter((po) => po.costCenterId === cc.id && po.status !== "cancelled")
                .reduce((a, po) => a + (po.totalAmount || 0), 0);
            const received = (purchaseOrders || [])
                .filter((po) => po.costCenterId === cc.id && po.status === "completed")
                .reduce((a, po) => a + (po.totalAmount || 0), 0);
            return { cc, committed, received };
        });
    }, [costCenters, purchaseOrders]);

    const exportPDF = () => {
        try {
            const doc = new jsPDF();
            const W = doc.internal.pageSize.getWidth();
            doc.setFontSize(16);
            doc.text("Reporte de Abastecimiento", W / 2, 18, { align: "center" });
            doc.setFontSize(10);
            doc.setTextColor(120);
            doc.text(`Período: ${periodLabel} · Generado ${fmtDate(new Date())}`, W / 2, 25, { align: "center" });
            doc.setTextColor(0);

            autoTable(doc, {
                startY: 32,
                head: [["Indicador", "Valor"]],
                body: [
                    ["Solicitudes pendientes", String(data.pendingRequests)],
                    ["Órdenes activas", String(data.activeOrders)],
                    ["Órdenes completadas", String(data.completedOrders)],
                    ["Monto comprometido (OC)", CLP.format(data.committed)],
                    ["Monto recibido (OC completadas)", CLP.format(data.received)],
                    ["RFQ adjudicadas", String(data.awardedRfqs)],
                    ["Ahorro estimado en RFQ", CLP.format(data.totalSaving)],
                    ["Pagado a proveedores", CLP.format(data.paid)],
                    ["Pendiente de pago", CLP.format(data.pendingPay)],
                    ["Recepciones registradas", String(data.receipts)],
                ],
                theme: "striped",
                headStyles: { fillColor: [241, 90, 36] },
            });

            if (data.rfqsAwarded.length > 0) {
                doc.setFontSize(12);
                doc.text("Ahorros por RFQ adjudicada", 15, (doc as any).lastAutoTable.finalY + 10);
                autoTable(doc, {
                    startY: (doc as any).lastAutoTable.finalY + 13,
                    head: [["RFQ", "Adjudicada", "Oferta + alta", "Ahorro"]],
                    body: data.rfqsAwarded.map((r) => {
                        const s = rfqSaving(r);
                        return [r.internalCode, CLP.format(s?.winner || 0), CLP.format(s?.baseline || 0), CLP.format(s?.saving || 0)];
                    }),
                    theme: "grid",
                    headStyles: { fillColor: [241, 90, 36] },
                });
            }

            if (ccRollup.length > 0) {
                doc.setFontSize(12);
                doc.text("Ejecución por Centro de Costo", 15, (doc as any).lastAutoTable.finalY + 10);
                autoTable(doc, {
                    startY: (doc as any).lastAutoTable.finalY + 13,
                    head: [["Centro", "Presupuesto", "Comprometido", "Recibido", "Disponible"]],
                    body: ccRollup.map(({ cc, committed, received }) => [
                        `${cc.code} · ${cc.name}`,
                        CLP.format(cc.budget),
                        CLP.format(committed),
                        CLP.format(received),
                        CLP.format(cc.budget - committed),
                    ]),
                    theme: "grid",
                    headStyles: { fillColor: [241, 90, 36] },
                });
            }

            if (data.topSuppliers.length > 0) {
                doc.setFontSize(12);
                doc.text("Top proveedores por monto", 15, (doc as any).lastAutoTable.finalY + 10);
                autoTable(doc, {
                    startY: (doc as any).lastAutoTable.finalY + 13,
                    head: [["Proveedor", "OC", "Monto"]],
                    body: data.topSuppliers.map((s) => [s.name, String(s.orders), CLP.format(s.amount)]),
                    theme: "grid",
                    headStyles: { fillColor: [241, 90, 36] },
                });
            }

            doc.save(`Reporte_Abastecimiento_${period}_${new Date().toISOString().slice(0, 10)}.pdf`);
            toast({ title: "Reporte generado", description: "Se descargó el PDF." });
        } catch (e) {
            toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "No se pudo generar el PDF." });
        }
    };

    const kpis = [
        { icon: ShoppingCart, tone: "warning", label: "Solicitudes pendientes", value: String(data.pendingRequests) },
        { icon: FileText, tone: "info", label: "Órdenes activas", value: String(data.activeOrders) },
        { icon: PackageCheck, tone: "success", label: "Órdenes completadas", value: String(data.completedOrders) },
        { icon: DollarSign, tone: "default", label: "Comprometido", value: CLP.format(data.committed) },
        { icon: TrendingDown, tone: "success", label: "Ahorro en RFQ", value: CLP.format(data.totalSaving) },
    ] as const;

    return (
        <PageShell
            title="Reportes de Abastecimiento"
            description="KPIs del ciclo de compras: ahorros, ejecución por centro de costo y desempeño de proveedores. Exportable a PDF."
            toolbar={
                <div className="flex items-center gap-3">
                    <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                        <SelectTrigger className="w-40 rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="month">Este mes</SelectItem>
                            <SelectItem value="year">Este año</SelectItem>
                            <SelectItem value="all">Histórico</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button onClick={exportPDF} className="rounded-xl">
                        <FileDown className="mr-2 h-4 w-4" /> Exportar PDF
                    </Button>
                </div>
            }
        >
            {/* KPIs */}
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
                {kpis.map((k) => (
                    <Card key={k.label} className="rounded-[1.5rem]">
                        <CardContent className="p-5 flex flex-col gap-3">
                            <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", toneStyles[k.tone])}>
                                <k.icon className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="text-xl font-black tracking-tight text-foreground">{k.value}</p>
                                <MicroLabel>{k.label}</MicroLabel>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Ejecución por centro de costo */}
            <div className="space-y-4">
                <MicroLabel>Ejecución por Centro de Costo</MicroLabel>
                {ccRollup.length === 0 ? (
                    <Card className="rounded-[1.5rem]"><CardContent className="p-6 text-sm text-muted-foreground">Aún no hay centros de costo definidos.</CardContent></Card>
                ) : (
                    <Card className="rounded-[1.5rem]">
                        <CardContent className="p-0 divide-y">
                            {ccRollup.map(({ cc, committed, received }) => {
                                const pct = cc.budget > 0 ? Math.min(100, Math.round((committed / cc.budget) * 100)) : 0;
                                const over = cc.budget > 0 && committed > cc.budget;
                                return (
                                    <div key={cc.id} className="flex items-center gap-4 p-4">
                                        <Target className="h-4 w-4 text-muted-foreground shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold text-foreground truncate">{cc.name} <span className="text-muted-foreground font-normal">· {cc.code}</span></p>
                                            <p className="text-xs text-muted-foreground">{CLP.format(committed)} comprometido · {CLP.format(received)} recibido</p>
                                        </div>
                                        <Badge className={cn("rounded-xl shrink-0", over ? "bg-destructive/10 text-destructive" : "badge-info")}>{pct}%</Badge>
                                        <span className="hidden sm:block text-sm tabular-nums text-muted-foreground w-28 text-right">{CLP.format(cc.budget)}</span>
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Top proveedores */}
            <div className="space-y-4">
                <MicroLabel>Top proveedores por monto de OC</MicroLabel>
                {data.topSuppliers.length === 0 ? (
                    <Card className="rounded-[1.5rem]"><CardContent className="p-6 text-sm text-muted-foreground">Sin órdenes de compra en el período.</CardContent></Card>
                ) : (
                    <Card className="rounded-[1.5rem]">
                        <CardContent className="p-0 divide-y">
                            {data.topSuppliers.map((s) => (
                                <div key={s.name} className="flex items-center gap-4 p-4">
                                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                                    <span className="min-w-0 flex-1 font-semibold text-foreground truncate">{s.name}</span>
                                    <span className="text-xs text-muted-foreground shrink-0">{s.orders} OC</span>
                                    <span className="text-sm font-semibold tabular-nums text-foreground w-32 text-right">{CLP.format(s.amount)}</span>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}
            </div>
        </PageShell>
    );
}

const toneStyles = {
    default: "bg-muted text-foreground",
    warning: "bg-warning-subtle text-warning-subtle-foreground",
    info: "bg-info-subtle text-info-subtle-foreground",
    success: "bg-success-subtle text-success-subtle-foreground",
} as const;
