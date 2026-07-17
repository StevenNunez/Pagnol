"use client";

// Presupuesto de costo (Dominio Financiero F3 — ADR-005): líneas append-only por
// contrato × categoría comparadas contra el ledger COMPLETO del contrato (no un
// rango: el presupuesto es total, la ejecución también). El panel principal
// conserva el foco en margen y enlaza aquí.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { useAuth, useAppState } from "@/modules/core/contexts/app-provider";
import { supabase } from "@/modules/core/lib/supabase";
import { fetchBudgetEntries } from "@/modules/data/mutations/budgetMutations";
import { budgetRollup, budgetExecutionPct } from "@/modules/data/mutations/financeMath";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { FinanceBudgetEntry, FinanceCategory, FinanceContractSummaryRow } from "@/modules/core/lib/data";
import {
    ArrowLeft, ChevronDown, ChevronRight, ClipboardList, FileUp, Loader2,
    PlusCircle, ShieldAlert, History,
} from "lucide-react";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

type CostCategory = Exclude<FinanceCategory, "revenue">;
const COST_CATEGORIES: { value: CostCategory; label: string }[] = [
    { value: "materials", label: "Materiales" },
    { value: "labor", label: "Mano de obra" },
    { value: "equipment", label: "Equipos" },
    { value: "subcontract", label: "Subcontratos" },
    { value: "rental", label: "Arriendos" },
    { value: "services", label: "Servicios" },
    { value: "indirect", label: "Indirectos" },
];
const CAT_LABEL = Object.fromEntries(COST_CATEGORIES.map((c) => [c.value, c.label]));

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{children}</p>;
}

export default function PresupuestoPage() {
    const router = useRouter();
    const { can, getTenantId } = useAuth();
    const { contracts, addBudgetEntry } = useAppState();
    const { toast } = useToast();

    const canView = can("module_finance:view");
    const canManage = can("finance:manage");

    const [lines, setLines] = useState<FinanceBudgetEntry[]>([]);
    const [ledger, setLedger] = useState<FinanceContractSummaryRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [historyFor, setHistoryFor] = useState<string | null>(null);

    // Diálogo de línea nueva (inicial o modificación: es lo mismo, un INSERT con motivo).
    const [dialogOpen, setDialogOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ contractId: "", category: "materials" as CostCategory, amount: "", isReduction: false, reason: "" });

    // CSV import
    const [importing, setImporting] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const tenantId = getTenantId();
            if (!tenantId) return;
            const [budget, { data: summary, error }] = await Promise.all([
                fetchBudgetEntries(tenantId),
                // Ledger COMPLETO (el presupuesto es total del contrato, no de un rango).
                supabase.rpc("finance_contract_summary", { p_from: "2000-01-01", p_to: "2100-01-01", p_tenant: tenantId }),
            ]);
            if (error) throw error;
            setLines(budget);
            setLedger((summary || []) as FinanceContractSummaryRow[]);
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo cargar el presupuesto", description: e?.message || "Error desconocido." });
        } finally {
            setLoading(false);
        }
    }, [getTenantId, toast]);

    useEffect(() => { if (canView) load(); }, [canView, load]);

    const budget = useMemo(() => budgetRollup(lines), [lines]);

    const rows = useMemo(() => {
        // Realidad por contrato/categoría (solo costos).
        const real = new Map<string, { committed: number; accrued: number; paid: number }>();
        const bump = (key: string, stage: string, amount: number) => {
            const cur = real.get(key) || { committed: 0, accrued: 0, paid: 0 };
            if (stage === "committed") cur.committed += amount;
            if (stage === "accrued") cur.accrued += amount;
            if (stage === "paid") cur.paid += amount;
            real.set(key, cur);
        };
        for (const r of ledger) {
            if (r.nature !== "cost" || !r.contract_id) continue;
            const amount = Number(r.total_net) || 0;
            bump(r.contract_id, r.stage, amount);
            bump(`${r.contract_id}|${r.category}`, r.stage, amount);
        }

        // Un contrato aparece si tiene presupuesto O costos reales.
        const ids = new Set<string>();
        for (const l of lines) ids.add(l.contractId);
        for (const r of ledger) if (r.nature === "cost" && r.contract_id) ids.add(r.contract_id);

        return Array.from(ids).map((contractId) => {
            const c = contracts?.find((x) => x.id === contractId);
            const b = budget.get(contractId) || 0;
            const r = real.get(contractId) || { committed: 0, accrued: 0, paid: 0 };
            const cats = COST_CATEGORIES
                .map(({ value }) => ({
                    category: value,
                    budget: budget.get(`${contractId}|${value}`) || 0,
                    real: real.get(`${contractId}|${value}`) || { committed: 0, accrued: 0, paid: 0 },
                }))
                .filter((x) => x.budget !== 0 || x.real.committed !== 0 || x.real.accrued !== 0 || x.real.paid !== 0);
            return { contractId, name: c?.name || "Contrato eliminado", budget: b, ...r, cats };
        }).sort((a, b) => b.budget - a.budget || b.accrued - a.accrued);
    }, [lines, ledger, budget, contracts]);

    const saveLine = async () => {
        const amount = Math.round(Number(form.amount)) * (form.isReduction ? -1 : 1);
        setSaving(true);
        try {
            await addBudgetEntry({ contractId: form.contractId, category: form.category, amountNet: amount, reason: form.reason });
            toast({ title: form.isReduction ? "Rebaja registrada" : "Línea de presupuesto registrada" });
            setDialogOpen(false);
            setForm({ contractId: "", category: "materials", amount: "", isReduction: false, reason: "" });
            await load();
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo guardar", description: e?.message || "Error desconocido." });
        } finally {
            setSaving(false);
        }
    };

    // CSV: Contrato | Categoria | Monto | Motivo (contrato por nombre o código).
    const handleCsv = (file: File) => {
        setImporting(true);
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (result) => {
                try {
                    const catByLabel = new Map(COST_CATEGORIES.map((c) => [c.label.toLowerCase(), c.value]));
                    let ok = 0; const errors: string[] = [];
                    for (const [i, raw] of (result.data as any[]).entries()) {
                        const name = String(raw.Contrato || raw.contrato || "").trim();
                        const catLabel = String(raw.Categoria || raw["Categoría"] || raw.categoria || "").trim().toLowerCase();
                        const amount = Math.round(Number(String(raw.Monto || raw.monto || "").replace(/[.$\s]/g, "").replace(",", ".")));
                        const reason = String(raw.Motivo || raw.motivo || "").trim() || "Importación CSV";
                        const contract = contracts?.find((c) => c.name.toLowerCase() === name.toLowerCase() || c.code?.toLowerCase() === name.toLowerCase());
                        const category = catByLabel.get(catLabel) as CostCategory | undefined;
                        if (!contract) { errors.push(`Fila ${i + 2}: contrato "${name}" no existe`); continue; }
                        if (!category) { errors.push(`Fila ${i + 2}: categoría "${catLabel}" inválida`); continue; }
                        if (!amount) { errors.push(`Fila ${i + 2}: monto inválido`); continue; }
                        await addBudgetEntry({ contractId: contract.id, category, amountNet: amount, reason });
                        ok++;
                    }
                    toast({
                        title: `Importación: ${ok} línea(s) cargada(s)`,
                        description: errors.length ? `${errors.length} fila(s) con error: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "…" : ""}` : "Sin errores.",
                        variant: errors.length ? "destructive" : undefined,
                    });
                    await load();
                } finally {
                    setImporting(false);
                }
            },
            error: () => { setImporting(false); toast({ variant: "destructive", title: "No se pudo leer el archivo" }); },
        });
    };

    const toggle = (key: string) => setExpanded((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
    });

    if (!canView) {
        return (
            <PageShell title="Presupuesto" description="Presupuesto de costo por contrato">
                <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Acceso restringido"
                    description="El presupuesto es información financiera sensible. Pide a un administrador el permiso 'Acceder a Finanzas'." />
            </PageShell>
        );
    }

    const historyLines = historyFor ? lines.filter((l) => l.contractId === historyFor).slice().reverse() : [];

    return (
        <PageShell
            title="Presupuesto de Costo"
            description="Presupuesto vigente por contrato y categoría vs ejecución real del ledger (histórico completo). Las líneas son inmutables: modificar = nueva línea con motivo."
            toolbar={
                <>
                    <Button variant="ghost" className="rounded-xl" onClick={() => router.push("/dashboard/finanzas")}>
                        <ArrowLeft className="mr-2 h-4 w-4" /> Resultado por Contrato
                    </Button>
                    {canManage && (
                        <div className="flex items-center gap-3">
                            <label>
                                <input type="file" accept=".csv" className="hidden"
                                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsv(f); e.target.value = ""; }} />
                                <Button variant="outline" className="rounded-xl" disabled={importing} asChild>
                                    <span>{importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}Importar CSV</span>
                                </Button>
                            </label>
                            <Button className="rounded-xl shadow-lg shadow-primary/10" onClick={() => setDialogOpen(true)}>
                                <PlusCircle className="mr-2 h-4 w-4" /> Nueva línea
                            </Button>
                        </div>
                    )}
                </>
            }
        >
            <Card className="rounded-[1.5rem]">
                <CardContent className="p-0">
                    {loading ? (
                        <LoadingState label="Cruzando presupuesto contra el ledger…" />
                    ) : rows.length === 0 ? (
                        <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="Sin presupuesto cargado"
                            description="Carga la primera línea de presupuesto (o importa un CSV con columnas Contrato, Categoría, Monto, Motivo) para comparar el plan contra la ejecución real." />
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-8" />
                                        <TableHead>Contrato</TableHead>
                                        <TableHead className="text-right">Presupuesto</TableHead>
                                        <TableHead className="text-right">Comprometido</TableHead>
                                        <TableHead className="text-right">Devengado</TableHead>
                                        <TableHead className="text-right">Pagado</TableHead>
                                        <TableHead className="text-right">Disponible</TableHead>
                                        <TableHead className="text-right w-24">% Ejec.</TableHead>
                                        <TableHead className="w-10" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((r) => {
                                        const isOpen = expanded.has(r.contractId);
                                        const available = r.budget - r.committed;
                                        const pct = budgetExecutionPct(r.accrued, r.budget);
                                        const over = r.budget > 0 && r.committed > r.budget;
                                        return (
                                            <React.Fragment key={r.contractId}>
                                                <TableRow className="cursor-pointer" onClick={() => toggle(r.contractId)}>
                                                    <TableCell>{isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}</TableCell>
                                                    <TableCell className="font-medium">
                                                        {r.name}
                                                        {r.budget === 0 && <Badge className="badge-warning ml-2">sin presupuesto</Badge>}
                                                        {over && <Badge variant="destructive" className="ml-2">sobre-comprometido</Badge>}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono font-bold">{r.budget ? CLP.format(r.budget) : "—"}</TableCell>
                                                    <TableCell className="text-right font-mono">{CLP.format(r.committed)}</TableCell>
                                                    <TableCell className="text-right font-mono">{CLP.format(r.accrued)}</TableCell>
                                                    <TableCell className="text-right font-mono text-muted-foreground">{CLP.format(r.paid)}</TableCell>
                                                    <TableCell className={`text-right font-mono ${r.budget && available < 0 ? "text-destructive font-bold" : ""}`}>{r.budget ? CLP.format(available) : "—"}</TableCell>
                                                    <TableCell className={`text-right font-mono ${pct !== null && pct > 100 ? "text-destructive font-bold" : ""}`}>{pct === null ? "—" : `${pct}%`}</TableCell>
                                                    <TableCell>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Historial de líneas"
                                                            onClick={(e) => { e.stopPropagation(); setHistoryFor(r.contractId); }}>
                                                            <History className="h-3.5 w-3.5 text-muted-foreground" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                                {isOpen && r.cats.map((cat) => {
                                                    const catPct = budgetExecutionPct(cat.real.accrued, cat.budget);
                                                    return (
                                                        <TableRow key={`${r.contractId}-${cat.category}`} className="bg-muted/40 text-sm">
                                                            <TableCell />
                                                            <TableCell className="pl-10 text-muted-foreground">{CAT_LABEL[cat.category]}</TableCell>
                                                            <TableCell className="text-right font-mono text-muted-foreground">{cat.budget ? CLP.format(cat.budget) : "—"}</TableCell>
                                                            <TableCell className="text-right font-mono text-muted-foreground">{CLP.format(cat.real.committed)}</TableCell>
                                                            <TableCell className="text-right font-mono text-muted-foreground">{CLP.format(cat.real.accrued)}</TableCell>
                                                            <TableCell className="text-right font-mono text-muted-foreground">{CLP.format(cat.real.paid)}</TableCell>
                                                            <TableCell className="text-right font-mono text-muted-foreground">{cat.budget ? CLP.format(cat.budget - cat.real.committed) : "—"}</TableCell>
                                                            <TableCell className="text-right font-mono text-muted-foreground">{catPct === null ? "—" : `${catPct}%`}</TableCell>
                                                            <TableCell />
                                                        </TableRow>
                                                    );
                                                })}
                                            </React.Fragment>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">
                Disponible = presupuesto − comprometido · % Ejec. = devengado / presupuesto.
                La ejecución cruza el ledger histórico completo del contrato (no un rango de fechas).
            </p>

            {/* Diálogo: nueva línea / modificación */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Nueva línea de presupuesto</DialogTitle>
                        <DialogDescription>
                            La línea es inmutable: para corregir se agrega otra (una rebaja resta). El motivo queda en el historial.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <MicroLabel>Contrato</MicroLabel>
                            <Select value={form.contractId} onValueChange={(v) => setForm({ ...form, contractId: v })}>
                                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Seleccionar contrato…" /></SelectTrigger>
                                <SelectContent>
                                    {(contracts || []).filter((c) => c.status === "active").map((c) => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <MicroLabel>Categoría</MicroLabel>
                                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as CostCategory })}>
                                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {COST_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <MicroLabel>Tipo</MicroLabel>
                                <Select value={form.isReduction ? "reduce" : "add"} onValueChange={(v) => setForm({ ...form, isReduction: v === "reduce" })}>
                                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="add">Aumento / inicial</SelectItem>
                                        <SelectItem value="reduce">Rebaja</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <MicroLabel>Monto (CLP neto)</MicroLabel>
                            <Input type="number" min={1} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="rounded-xl" placeholder="Ej: 12000000" />
                        </div>
                        <div className="space-y-1.5">
                            <MicroLabel>Motivo</MicroLabel>
                            <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="rounded-xl"
                                placeholder="Ej: presupuesto inicial licitación / aumento por obra extraordinaria N°2…" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                        <Button className="rounded-xl" disabled={saving || !form.contractId || !Number(form.amount) || !form.reason.trim()} onClick={saveLine}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                            Registrar línea
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Historial de líneas del contrato */}
            <Dialog open={!!historyFor} onOpenChange={(open) => !open && setHistoryFor(null)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Historial presupuestario</DialogTitle>
                        <DialogDescription>{contracts?.find((c) => c.id === historyFor)?.name}</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[50vh] overflow-y-auto space-y-2">
                        {historyLines.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-4 text-center">Sin líneas de presupuesto.</p>
                        ) : historyLines.map((l) => (
                            <div key={l.id} className="flex items-start justify-between gap-3 border rounded-xl p-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium">{CAT_LABEL[l.category]} · <span className={`font-mono ${l.amountNet < 0 ? "text-destructive" : ""}`}>{CLP.format(l.amountNet)}</span></p>
                                    <p className="text-xs text-muted-foreground">{l.reason}</p>
                                </div>
                                <div className="text-right shrink-0 text-[10px] text-muted-foreground">
                                    <div>{new Date(l.createdAt as any).toLocaleDateString("es-CL")}</div>
                                    <div>{l.createdByName}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </PageShell>
    );
}
