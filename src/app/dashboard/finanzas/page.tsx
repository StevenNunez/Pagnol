"use client";

// Resultado por Contrato (Dominio Financiero, F0 — RFC-002).
//
// Primera página de Pagnol que NO consume una colección del DataProvider: el
// ledger financiero se agrega en el servidor (RPC finance_contract_summary) y
// aquí solo se presenta. Decisión de arquitectura registrada en RFC-002 — el
// ledger será la tabla más grande del sistema y jamás viaja al navegador.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { useAuth, useAppState } from "@/modules/core/contexts/app-provider";
import { supabase } from "@/modules/core/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { AttendanceLog, FinanceCategory, FinanceContractSummaryRow, User } from "@/modules/core/lib/data";
import { laborDayPresence } from "@/modules/data/mutations/financeMath";
import {
    Landmark, HandCoins, PackageCheck, AlertTriangle, ChevronDown, ChevronRight,
    RefreshCcw, Loader2, ShieldAlert, HardHat,
} from "lucide-react";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

const CATEGORY_LABEL: Record<FinanceCategory, string> = {
    materials: "Materiales",
    labor: "Mano de obra",
    equipment: "Equipos",
    subcontract: "Subcontratos",
    rental: "Arriendos",
    services: "Servicios",
    indirect: "Indirectos",
};

type ContractRollup = {
    contractId: string | null;
    contractName: string;
    committed: number;
    accrued: number;
    paid: number;
    categories: Map<FinanceCategory, { committed: number; accrued: number; paid: number }>;
};

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{children}</p>;
}

const monthStart = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function FinanzasPage() {
    const { can, getTenantId } = useAuth();
    const { users, attendanceLogs } = useAppState();
    const { toast } = useToast();

    const [from, setFrom] = useState(monthStart());
    const [to, setTo] = useState(todayIso());
    const [rows, setRows] = useState<FinanceContractSummaryRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [ufInfo, setUfInfo] = useState<{ date: string; value: number } | null>(null);
    const [refreshingUf, setRefreshingUf] = useState(false);
    const [refreshingLabor, setRefreshingLabor] = useState(false);

    const canView = can("module_finance:view");

    const fetchSummary = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc("finance_contract_summary", {
                p_from: from,
                p_to: to,
                p_tenant: getTenantId() ?? null,
            });
            if (error) throw error;
            setRows((data || []) as FinanceContractSummaryRow[]);
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo cargar el resumen", description: e?.message || "Error desconocido." });
        } finally {
            setLoading(false);
        }
    }, [from, to, getTenantId, toast]);

    const fetchUf = useCallback(async () => {
        const { data } = await supabase
            .from("uf_rates")
            .select("rate_date, value")
            .order("rate_date", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (data) setUfInfo({ date: data.rate_date, value: Number(data.value) });
    }, []);

    useEffect(() => {
        if (!canView) return;
        fetchSummary();
    }, [canView, fetchSummary]);

    useEffect(() => {
        if (!canView) return;
        fetchUf();
    }, [canView, fetchUf]);

    const refreshUf = async () => {
        setRefreshingUf(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!token) throw new Error("Sesión no disponible.");
            const res = await fetch("/api/finance/uf-refresh", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            await fetchUf();
            toast({ title: "UF actualizada", description: json?.latest ? `${json.latest.fecha}: ${CLP.format(json.latest.valor)}` : "Serie sincronizada." });
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo actualizar la UF", description: e?.message || "Error desconocido." });
        } finally {
            setRefreshingUf(false);
        }
    };

    const recalcLabor = async () => {
        setRefreshingLabor(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!token) throw new Error("Sesión no disponible.");
            const res = await fetch("/api/finance/labor-refresh", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId: getTenantId() ?? undefined }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            await fetchSummary();
            toast({
                title: "Costo de MO reconciliado",
                description: `${json.emitted ?? 0} hecho(s) nuevo(s), ${json.mirrors ?? 0} reverso(s) — ventana ${json.window?.from} → ${json.window?.to}.`,
            });
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo recalcular la MO", description: e?.message || "Error desconocido." });
        } finally {
            setRefreshingLabor(false);
        }
    };

    // Alerta de calidad de dato (ADR-003 §4): presencia en el rango sin sueldo
    // base configurado ⇒ ese costo NO está en el ledger (no se inventan $0).
    const noSalaryWorkers = useMemo(() => {
        const present = new Set<string>();
        for (const l of attendanceLogs as AttendanceLog[]) {
            if (!l.date || l.date < from || l.date > to) continue;
            if (present.has(l.userId)) continue;
            if (laborDayPresence([{ type: l.type, markType: l.markType, contractId: l.contractId, timestamp: "" }])) {
                present.add(l.userId);
            }
        }
        return (users as User[]).filter((u) => present.has(u.id) && !(Number(u.baseSalary) > 0));
    }, [users, attendanceLogs, from, to]);

    const { contracts, totals } = useMemo(() => {
        const byContract = new Map<string, ContractRollup>();
        const totals = { committed: 0, accrued: 0, paid: 0, unassigned: 0 };
        for (const r of rows) {
            if (r.nature !== "cost") continue; // ingresos llegan en F2
            const key = r.contract_id ?? "__none__";
            const cur = byContract.get(key) || {
                contractId: r.contract_id,
                contractName: r.contract_name || "Sin contrato",
                committed: 0, accrued: 0, paid: 0,
                categories: new Map(),
            };
            const cat = cur.categories.get(r.category) || { committed: 0, accrued: 0, paid: 0 };
            const amount = Number(r.total_net) || 0;
            if (r.stage === "committed") { cur.committed += amount; cat.committed += amount; totals.committed += amount; }
            if (r.stage === "accrued")   { cur.accrued += amount;   cat.accrued += amount;   totals.accrued += amount; }
            if (r.stage === "paid")      { cur.paid += amount;      cat.paid += amount;      totals.paid += amount; }
            if (r.contract_id === null) totals.unassigned += amount;
            cur.categories.set(r.category, cat);
            byContract.set(key, cur);
        }
        const contracts = Array.from(byContract.values()).sort((a, b) => {
            // "Sin contrato" siempre al final; el resto por devengado desc.
            if (a.contractId === null) return 1;
            if (b.contractId === null) return -1;
            return b.accrued - a.accrued;
        });
        return { contracts, totals };
    }, [rows]);

    const toggle = (key: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });

    if (!canView) {
        return (
            <PageShell title="Finanzas" description="Resultado por Contrato">
                <EmptyState
                    icon={<ShieldAlert className="h-6 w-6" />}
                    title="Acceso restringido"
                    description="El Resultado por Contrato es información sensible. Pide a un administrador el permiso 'Acceder a Finanzas'."
                />
            </PageShell>
        );
    }

    return (
        <PageShell
            title="Resultado por Contrato"
            description="Hechos económicos del ledger financiero: comprometido → devengado → pagado (montos netos CLP, congelados al momento del hecho)."
            toolbar={
                <>
                    <div className="flex items-end gap-3">
                        <div className="space-y-1">
                            <MicroLabel>Desde</MicroLabel>
                            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl w-40" />
                        </div>
                        <div className="space-y-1">
                            <MicroLabel>Hasta</MicroLabel>
                            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-xl w-40" />
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {ufInfo && (
                            <Badge variant="outline" className="rounded-xl font-mono">
                                UF {ufInfo.date}: {CLP.format(ufInfo.value)}
                            </Badge>
                        )}
                        <Button variant="outline" size="sm" className="rounded-xl" onClick={refreshUf} disabled={refreshingUf}>
                            {refreshingUf ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-2 h-3.5 w-3.5" />}
                            Actualizar UF
                        </Button>
                        <Button variant="outline" size="sm" className="rounded-xl" onClick={recalcLabor} disabled={refreshingLabor}>
                            {refreshingLabor ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <HardHat className="mr-2 h-3.5 w-3.5" />}
                            Recalcular MO
                        </Button>
                    </div>
                </>
            }
        >
            {/* KPIs */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                    { icon: Landmark, label: "Comprometido", value: CLP.format(totals.committed), hint: "OC emitidas", tone: "bg-info-subtle text-info-subtle-foreground" },
                    { icon: PackageCheck, label: "Devengado", value: CLP.format(totals.accrued), hint: "Recepciones", tone: "bg-success-subtle text-success-subtle-foreground" },
                    { icon: HandCoins, label: "Pagado", value: CLP.format(totals.paid), hint: "Facturas pagadas (neto)", tone: "bg-muted text-foreground" },
                    { icon: AlertTriangle, label: "Sin contrato", value: CLP.format(totals.unassigned), hint: "Hechos por imputar", tone: totals.unassigned > 0 ? "bg-warning-subtle text-warning-subtle-foreground" : "bg-muted text-foreground" },
                ].map((k) => (
                    <Card key={k.label} className="rounded-[1.5rem]">
                        <CardContent className="p-5 flex items-center gap-4">
                            <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${k.tone}`}>
                                <k.icon className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <MicroLabel>{k.label}</MicroLabel>
                                <p className="text-xl font-bold truncate">{k.value}</p>
                                <p className="text-xs text-muted-foreground">{k.hint}</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Calidad de dato MO: presencia sin sueldo base = costo invisible (ADR-003 §4) */}
            {noSalaryWorkers.length > 0 && (
                <Card className="rounded-[1.5rem] border-warning/50 bg-warning-subtle/40">
                    <CardContent className="p-5 flex items-start gap-4">
                        <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 bg-warning-subtle text-warning-subtle-foreground">
                            <HardHat className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <MicroLabel>Calidad de dato — Mano de obra</MicroLabel>
                            <p className="font-bold">
                                {noSalaryWorkers.length} trabajador(es) con asistencia en el período y sin sueldo base
                            </p>
                            <p className="text-sm text-muted-foreground">
                                Sus días trabajados NO devengan costo en el ledger (no se inventan montos $0).
                                Configura el sueldo en la ficha del trabajador y usa «Recalcular MO» — la
                                reconciliación emitirá los días pendientes de la ventana.
                            </p>
                            <p className="text-sm text-muted-foreground mt-1 truncate">
                                {noSalaryWorkers.slice(0, 5).map((u) => u.name).join(", ")}
                                {noSalaryWorkers.length > 5 ? ` y ${noSalaryWorkers.length - 5} más…` : ""}
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Tabla por contrato */}
            <Card className="rounded-[1.5rem]">
                <CardContent className="p-0">
                    {loading ? (
                        <LoadingState label="Consultando el ledger financiero…" />
                    ) : contracts.length === 0 ? (
                        <EmptyState
                            icon={<Landmark className="h-6 w-6" />}
                            title="Sin hechos económicos en el período"
                            description="El ledger parte de cero (corte limpio): las OC, recepciones y pagos nuevos irán apareciendo aquí automáticamente."
                        />
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-8" />
                                    <TableHead>Contrato</TableHead>
                                    <TableHead className="text-right">Comprometido</TableHead>
                                    <TableHead className="text-right">Devengado</TableHead>
                                    <TableHead className="text-right">Pagado</TableHead>
                                    <TableHead className="text-right w-32">% Devengado</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {contracts.map((c) => {
                                    const key = c.contractId ?? "__none__";
                                    const isOpen = expanded.has(key);
                                    const pct = c.committed > 0 ? Math.round((c.accrued / c.committed) * 100) : null;
                                    const isUnassigned = c.contractId === null;
                                    return (
                                        <React.Fragment key={key}>
                                            <TableRow
                                                className={`cursor-pointer ${isUnassigned ? "bg-warning-subtle/40" : ""}`}
                                                onClick={() => toggle(key)}
                                            >
                                                <TableCell>
                                                    {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    {isUnassigned ? (
                                                        <span className="flex items-center gap-2">
                                                            <AlertTriangle className="h-4 w-4 text-warning" />
                                                            Sin contrato
                                                            <Badge className="badge-warning">imputación pendiente</Badge>
                                                        </span>
                                                    ) : c.contractName}
                                                </TableCell>
                                                <TableCell className="text-right font-mono">{CLP.format(c.committed)}</TableCell>
                                                <TableCell className="text-right font-mono font-bold">{CLP.format(c.accrued)}</TableCell>
                                                <TableCell className="text-right font-mono">{CLP.format(c.paid)}</TableCell>
                                                <TableCell className="text-right font-mono">{pct === null ? "—" : `${pct}%`}</TableCell>
                                            </TableRow>
                                            {isOpen && Array.from(c.categories.entries()).map(([cat, v]) => (
                                                <TableRow key={`${key}-${cat}`} className="bg-muted/40 text-sm">
                                                    <TableCell />
                                                    <TableCell className="pl-10 text-muted-foreground">{CATEGORY_LABEL[cat] || cat}</TableCell>
                                                    <TableCell className="text-right font-mono text-muted-foreground">{CLP.format(v.committed)}</TableCell>
                                                    <TableCell className="text-right font-mono text-muted-foreground">{CLP.format(v.accrued)}</TableCell>
                                                    <TableCell className="text-right font-mono text-muted-foreground">{CLP.format(v.paid)}</TableCell>
                                                    <TableCell />
                                                </TableRow>
                                            ))}
                                        </React.Fragment>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">
                Los hechos son inmutables (Manifiesto, Art. 2): las correcciones aparecen como reversos, nunca como ediciones.
                Etapas independientes: una misma compra aparece en Comprometido (OC), Devengado (recepción) y Pagado (factura).
            </p>
        </PageShell>
    );
}
