"use client";

// Flujo de caja proyectado (Dominio Financiero F4.2 — RFC-002-F4-Plan).
//
// El panel de Resultado responde "¿cuánto gané?"; este responde "¿me alcanza la
// plata, y cuándo?". Se alimenta de las obligaciones del ledger
// (nature payable/receivable, en BRUTO) que siguen vivas tras los reversos: una
// factura pagada o un EP cobrado ya no proyectan nada.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { useAuth } from "@/modules/core/contexts/app-provider";
import { supabase } from "@/modules/core/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
    ArrowLeft, ShieldAlert, TrendingDown, TrendingUp, Scale, AlertTriangle, HelpCircle, Wallet,
} from "lucide-react";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

interface CashFlowRow {
    bucket: string | null;
    nature: "payable" | "receivable";
    contract_id: string | null;
    contract_name: string | null;
    counterparty_name: string | null;
    source_type: string;
    source_id: string;
    source_code: string | null;
    due_date: string | null;
    amount: number;
    overdue: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
    supplier_invoice: "Factura proveedor",
    rental_installment: "Cuota arriendo",
    payment_state_receivable: "Estado de pago",
};

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{children}</p>;
}

function weekLabel(bucket: string) {
    const d = new Date(`${bucket}T12:00:00`);
    const end = new Date(d); end.setDate(end.getDate() + 6);
    const f = (x: Date) => x.toLocaleDateString("es-CL", { day: "2-digit", month: "short" });
    return `${f(d)} – ${f(end)}`;
}

export default function FlujoPage() {
    const router = useRouter();
    const { can, getTenantId } = useAuth();
    const { toast } = useToast();

    const canView = can("module_finance:view");

    const today = new Date();
    const in90 = new Date(today); in90.setDate(in90.getDate() + 90);
    const [from, setFrom] = useState(today.toISOString().slice(0, 10));
    const [to, setTo] = useState(in90.toISOString().slice(0, 10));
    const [rows, setRows] = useState<CashFlowRow[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc("finance_cash_flow", {
                p_from: from, p_to: to, p_tenant: getTenantId() ?? null,
            });
            if (error) throw error;
            setRows((data || []) as CashFlowRow[]);
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo cargar el flujo", description: e?.message || "Error desconocido." });
        } finally {
            setLoading(false);
        }
    }, [from, to, getTenantId, toast]);

    useEffect(() => { if (canView) load(); }, [canView, load]);

    const { weeks, totals, noDate } = useMemo(() => {
        const byWeek = new Map<string, { out: number; in: number; rows: CashFlowRow[] }>();
        const noDate: CashFlowRow[] = [];
        const totals = { out: 0, in: 0, overdueOut: 0, overdueIn: 0, noDateOut: 0, noDateIn: 0 };

        for (const r of rows) {
            const amount = Number(r.amount) || 0;
            if (!r.bucket) {
                noDate.push(r);
                if (r.nature === "payable") totals.noDateOut += amount; else totals.noDateIn += amount;
                continue;
            }
            const cur = byWeek.get(r.bucket) || { out: 0, in: 0, rows: [] };
            if (r.nature === "payable") { cur.out += amount; totals.out += amount; if (r.overdue) totals.overdueOut += amount; }
            else { cur.in += amount; totals.in += amount; if (r.overdue) totals.overdueIn += amount; }
            cur.rows.push(r);
            byWeek.set(r.bucket, cur);
        }

        // Saldo acumulado: la pregunta real no es "cuánto sale esta semana" sino
        // "en qué semana me quedo corto".
        let running = 0;
        const weeks = [...byWeek.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([bucket, v]) => {
                const net = v.in - v.out;
                running += net;
                return { bucket, ...v, net, running };
            });
        return { weeks, totals, noDate };
    }, [rows]);

    if (!canView) {
        return (
            <PageShell title="Flujo de Caja" description="Proyección de entradas y salidas">
                <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Acceso restringido"
                    description="El flujo de caja es información financiera sensible. Pide a un administrador el permiso 'Acceder a Finanzas'." />
            </PageShell>
        );
    }

    const kpis = [
        { label: "Por pagar", value: totals.out, icon: TrendingDown, tone: "text-destructive" },
        { label: "Por cobrar", value: totals.in, icon: TrendingUp, tone: "text-success" },
        { label: "Saldo proyectado", value: totals.in - totals.out, icon: Scale, tone: totals.in - totals.out < 0 ? "text-destructive" : "" },
        { label: "Vencido por pagar", value: totals.overdueOut, icon: AlertTriangle, tone: totals.overdueOut > 0 ? "text-warning" : "" },
    ];

    return (
        <PageShell
            title="Flujo de Caja Proyectado"
            description="Obligaciones vivas por fecha de vencimiento, en monto bruto: lo que efectivamente sale y entra del banco. Una factura pagada o un EP cobrado dejan de proyectar."
            toolbar={
                <>
                    <Button variant="ghost" className="rounded-xl" onClick={() => router.push("/dashboard/finanzas")}>
                        <ArrowLeft className="mr-2 h-4 w-4" /> Resultado por Contrato
                    </Button>
                    <div className="flex items-center gap-2">
                        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl w-auto" />
                        <span className="text-muted-foreground text-sm">→</span>
                        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-xl w-auto" />
                    </div>
                </>
            }
        >
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {kpis.map((k) => (
                    <Card key={k.label} className="rounded-[1.5rem]">
                        <CardContent className="p-5 space-y-1">
                            <div className="flex items-center justify-between">
                                <MicroLabel>{k.label}</MicroLabel>
                                <k.icon className={`h-4 w-4 ${k.tone || "text-muted-foreground"}`} />
                            </div>
                            <p className={`text-2xl font-bold font-mono ${k.tone}`}>{CLP.format(k.value)}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Card className="rounded-[1.5rem]">
                <CardContent className="p-0">
                    {loading ? (
                        <LoadingState label="Proyectando vencimientos…" />
                    ) : weeks.length === 0 && noDate.length === 0 ? (
                        <EmptyState icon={<Wallet className="h-6 w-6" />} title="Sin obligaciones en el rango"
                            description="No hay facturas por pagar, cuotas de arriendo ni estados de pago por cobrar con vencimiento en estas fechas." />
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Semana</TableHead>
                                        <TableHead className="text-right">Entradas</TableHead>
                                        <TableHead className="text-right">Salidas</TableHead>
                                        <TableHead className="text-right">Neto</TableHead>
                                        <TableHead className="text-right">Saldo acumulado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {weeks.map((w) => (
                                        <React.Fragment key={w.bucket}>
                                            <TableRow>
                                                <TableCell className="font-medium">{weekLabel(w.bucket)}</TableCell>
                                                <TableCell className="text-right font-mono text-success">{w.in ? CLP.format(w.in) : "—"}</TableCell>
                                                <TableCell className="text-right font-mono text-destructive">{w.out ? CLP.format(w.out) : "—"}</TableCell>
                                                <TableCell className={`text-right font-mono ${w.net < 0 ? "text-destructive" : ""}`}>{CLP.format(w.net)}</TableCell>
                                                <TableCell className={`text-right font-mono font-bold ${w.running < 0 ? "text-destructive" : ""}`}>{CLP.format(w.running)}</TableCell>
                                            </TableRow>
                                            {w.rows.map((r) => (
                                                <TableRow key={`${r.source_type}-${r.source_id}`} className="bg-muted/40 text-sm">
                                                    <TableCell className="pl-8 text-muted-foreground">
                                                        {SOURCE_LABEL[r.source_type] || r.source_type}
                                                        {r.source_code ? ` ${r.source_code}` : ""}
                                                        {r.overdue && <Badge variant="destructive" className="ml-2">vencido</Badge>}
                                                        <span className="block text-xs">{r.counterparty_name || "—"}{r.contract_name ? ` · ${r.contract_name}` : ""}</span>
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-muted-foreground">{r.nature === "receivable" ? CLP.format(r.amount) : ""}</TableCell>
                                                    <TableCell className="text-right font-mono text-muted-foreground">{r.nature === "payable" ? CLP.format(r.amount) : ""}</TableCell>
                                                    <TableCell colSpan={2} className="text-right text-xs text-muted-foreground">
                                                        vence {r.due_date}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Sin fecha: ocultarlas daría un flujo optimista */}
            {noDate.length > 0 && (
                <Card className="rounded-[1.5rem]">
                    <CardContent className="p-6 space-y-3">
                        <div className="flex items-center gap-2">
                            <HelpCircle className="h-4 w-4 text-muted-foreground" />
                            <MicroLabel>Sin fecha de vencimiento comprometida</MicroLabel>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            No entran en el calendario porque nadie pactó una fecha — estimarla sería inventar un dato.
                            Los estados de pago aprobados caen acá: el ingreso ya se devengó, pero el cobro no tiene plazo comprometido.
                        </p>
                        <div className="flex flex-wrap gap-4 pt-1">
                            <div>
                                <MicroLabel>Por cobrar sin fecha</MicroLabel>
                                <p className="text-lg font-bold font-mono text-success">{CLP.format(totals.noDateIn)}</p>
                            </div>
                            <div>
                                <MicroLabel>Por pagar sin fecha</MicroLabel>
                                <p className="text-lg font-bold font-mono text-destructive">{CLP.format(totals.noDateOut)}</p>
                            </div>
                        </div>
                        <div className="space-y-2 pt-2">
                            {noDate.map((r) => (
                                <div key={`${r.source_type}-${r.source_id}`} className="flex items-center justify-between gap-3 border rounded-xl p-3 text-sm">
                                    <div className="min-w-0">
                                        <p className="font-medium">{SOURCE_LABEL[r.source_type] || r.source_type}{r.source_code ? ` ${r.source_code}` : ""}</p>
                                        <p className="text-xs text-muted-foreground">{r.counterparty_name || "—"}{r.contract_name ? ` · ${r.contract_name}` : ""}</p>
                                    </div>
                                    <span className={`font-mono shrink-0 ${r.nature === "payable" ? "text-destructive" : "text-success"}`}>
                                        {CLP.format(r.amount)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            <p className="text-xs text-muted-foreground">
                Montos en BRUTO (con IVA): el flujo mide caja, no resultado — por eso no cuadran con el margen,
                que va en neto. El saldo acumulado parte de cero: proyecta el movimiento del período, no el saldo
                bancario real (Pagnol no lleva tesorería).
            </p>
        </PageShell>
    );
}
