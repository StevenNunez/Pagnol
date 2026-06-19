"use client";

import React, { useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/modules/core/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { CostCenter, CostCenterType, PurchaseOrder } from "@/modules/core/lib/data";
import {
    Target, Wallet, TrendingUp, PiggyBank, AlertTriangle, Plus, Pencil, Trash2, Search,
    PackageCheck, Building2,
} from "lucide-react";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const CC_TYPES: CostCenterType[] = ["Operaciones", "Mantención", "Ingeniería", "TI", "Administración", "Abastecimiento"];
const UNASSIGNED = "__none__";

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{children}</p>;
}

// Resumen de ejecución de un centro de costo, derivado de las OC imputadas.
type CCRollup = { committed: number; received: number; orders: number };

function rollupFor(ccId: string, orders: PurchaseOrder[]): CCRollup {
    let committed = 0, received = 0, count = 0;
    for (const po of orders) {
        if (po.costCenterId !== ccId || po.status === "cancelled") continue;
        const amount = po.totalAmount || 0;
        committed += amount;
        if (po.status === "completed") received += amount;
        count++;
    }
    return { committed, received, orders: count };
}

export default function CostosPage() {
    const { costCenters, purchaseOrders, can } = useAppState();
    const canManage = can("cost_centers:manage");

    const orders = purchaseOrders || [];
    const centers = costCenters || [];

    const globals = useMemo(() => {
        const budget = centers.reduce((a, c) => a + (c.budget || 0), 0);
        let committed = 0, received = 0;
        for (const c of centers) {
            const r = rollupFor(c.id, orders);
            committed += r.committed;
            received += r.received;
        }
        const unassigned = orders
            .filter((po) => po.status !== "cancelled" && !po.costCenterId)
            .reduce((a, po) => a + (po.totalAmount || 0), 0);
        return { budget, committed, received, available: budget - committed, unassigned };
    }, [centers, orders]);

    return (
        <PageShell
            title="Control de Costos"
            description="Imputa cada Orden de Compra a un Centro de Costo y compara presupuesto vs. comprometido vs. recibido."
        >
            {/* KPIs globales */}
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
                <KpiCard icon={Wallet} tone="default" label="Presupuesto" value={CLP.format(globals.budget)} hint="Suma de centros" />
                <KpiCard icon={TrendingUp} tone="info" label="Comprometido" value={CLP.format(globals.committed)} hint="OC imputadas" />
                <KpiCard icon={PackageCheck} tone="success" label="Recibido" value={CLP.format(globals.received)} hint="OC completadas" />
                <KpiCard icon={PiggyBank} tone={globals.available < 0 ? "destructive" : "default"} label="Disponible" value={CLP.format(globals.available)} hint="Presupuesto − comprometido" />
                <KpiCard icon={AlertTriangle} tone={globals.unassigned > 0 ? "warning" : "default"} label="Sin imputar" value={CLP.format(globals.unassigned)} hint="OC sin centro" />
            </div>

            <Tabs defaultValue="centros" className="space-y-6">
                <TabsList>
                    <TabsTrigger value="centros">Centros de Costo</TabsTrigger>
                    <TabsTrigger value="imputacion">Imputación de OC</TabsTrigger>
                </TabsList>

                <TabsContent value="centros" className="space-y-4">
                    <CentersTab centers={centers} orders={orders} canManage={canManage} />
                </TabsContent>

                <TabsContent value="imputacion" className="space-y-4">
                    <ImputacionTab centers={centers} orders={orders} canManage={canManage} />
                </TabsContent>
            </Tabs>
        </PageShell>
    );
}

// ── KPI ──────────────────────────────────────────────────────────────────────
const toneStyles = {
    default: "bg-muted text-foreground",
    warning: "bg-warning-subtle text-warning-subtle-foreground",
    info: "bg-info-subtle text-info-subtle-foreground",
    success: "bg-success-subtle text-success-subtle-foreground",
    destructive: "bg-destructive/10 text-destructive",
} as const;

function KpiCard({ icon: Icon, tone, label, value, hint }: {
    icon: React.ElementType; tone: keyof typeof toneStyles; label: string; value: string; hint?: string;
}) {
    return (
        <Card className="rounded-[1.5rem]">
            <CardContent className="p-5 flex flex-col gap-3">
                <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", toneStyles[tone])}>
                    <Icon className="h-5 w-5" />
                </div>
                <div>
                    <p className="text-xl font-black tracking-tight text-foreground">{value}</p>
                    <MicroLabel>{label}</MicroLabel>
                    {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
                </div>
            </CardContent>
        </Card>
    );
}

// ── Tab: Centros de Costo ────────────────────────────────────────────────────
function CentersTab({ centers, orders, canManage }: { centers: CostCenter[]; orders: PurchaseOrder[]; canManage: boolean }) {
    const { toast } = useToast();
    const { deleteCostCenter } = useAppState();
    const [editing, setEditing] = useState<CostCenter | null>(null);
    const [creating, setCreating] = useState(false);

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <MicroLabel>{centers.length} centro(s) de costo</MicroLabel>
                {canManage && (
                    <Button onClick={() => setCreating(true)} className="rounded-xl">
                        <Plus className="mr-2 h-4 w-4" /> Nuevo centro
                    </Button>
                )}
            </div>

            {centers.length === 0 ? (
                <EmptyState
                    icon={<Target className="h-6 w-6" />}
                    title="Sin centros de costo"
                    description="Crea el primer centro de costo para empezar a imputar tus órdenes de compra y controlar el presupuesto."
                />
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {centers.map((cc) => {
                        const r = rollupFor(cc.id, orders);
                        const pct = cc.budget > 0 ? Math.min(100, Math.round((r.committed / cc.budget) * 100)) : 0;
                        const over = cc.budget > 0 && r.committed > cc.budget;
                        return (
                            <Card key={cc.id} className="rounded-[1.5rem]">
                                <CardContent className="p-5 space-y-4">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="font-bold text-foreground truncate">{cc.name}</p>
                                            <p className="text-xs text-muted-foreground">{cc.code} · {cc.type}</p>
                                        </div>
                                        <Badge className={cn("rounded-xl shrink-0", cc.status === "active" ? "badge-success" : "bg-muted text-muted-foreground")}>
                                            {cc.status === "active" ? "Activo" : "Cerrado"}
                                        </Badge>
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex justify-between text-xs">
                                            <span className="text-muted-foreground">Comprometido</span>
                                            <span className={cn("font-semibold tabular-nums", over ? "text-destructive" : "text-foreground")}>
                                                {CLP.format(r.committed)} / {CLP.format(cc.budget)}
                                            </span>
                                        </div>
                                        <Progress value={pct} indicatorClassName={cn(over && "bg-destructive")} />
                                        <div className="flex justify-between text-xs text-muted-foreground">
                                            <span>{pct}% usado{over ? " · sobre presupuesto" : ""}</span>
                                            <span className="flex items-center gap-1"><PackageCheck className="h-3 w-3" />{CLP.format(r.received)} recibido</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between border-t pt-3">
                                        <span className="text-xs text-muted-foreground">{r.orders} OC imputada(s)</span>
                                        {canManage && (
                                            <div className="flex gap-1">
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(cc)}>
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>Eliminar centro de costo</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                Se eliminará "{cc.name}". Las OC imputadas a este centro quedarán sin imputar.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                            <AlertDialogAction
                                                                onClick={async () => {
                                                                    try {
                                                                        await deleteCostCenter(cc.id);
                                                                        toast({ title: "Centro eliminado" });
                                                                    } catch (e) {
                                                                        toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "No se pudo eliminar." });
                                                                    }
                                                                }}
                                                            >
                                                                Eliminar
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            {(creating || editing) && (
                <CostCenterForm
                    center={editing}
                    onClose={() => { setCreating(false); setEditing(null); }}
                />
            )}
        </div>
    );
}

// ── Formulario de centro de costo ────────────────────────────────────────────
function CostCenterForm({ center, onClose }: { center: CostCenter | null; onClose: () => void }) {
    const { addCostCenter, updateCostCenter, users } = useAppState();
    const { toast } = useToast();
    const [form, setForm] = useState({
        code: center?.code || "",
        name: center?.name || "",
        type: center?.type || ("Operaciones" as CostCenterType),
        budget: center?.budget ?? 0,
        status: center?.status || ("active" as "active" | "closed"),
        responsibleId: center?.responsibleId || "",
        startDate: center?.startDate || "",
        endDate: center?.endDate || "",
        notes: center?.notes || "",
    });
    const [saving, setSaving] = useState(false);

    const set = (patch: Partial<typeof form>) => setForm((p) => ({ ...p, ...patch }));

    const submit = async () => {
        if (!form.name.trim()) {
            toast({ variant: "destructive", title: "Falta el nombre", description: "El centro de costo necesita un nombre." });
            return;
        }
        setSaving(true);
        try {
            const responsible = (users || []).find((u) => u.id === form.responsibleId);
            const payload: Partial<CostCenter> = {
                code: form.code.trim() || undefined,
                name: form.name.trim(),
                type: form.type,
                budget: Number(form.budget) || 0,
                status: form.status,
                responsibleId: form.responsibleId || undefined,
                responsibleName: responsible?.name || undefined,
                startDate: form.startDate || undefined,
                endDate: form.endDate || undefined,
                notes: form.notes.trim() || undefined,
            };
            if (center) await updateCostCenter(center.id, payload);
            else await addCostCenter(payload);
            toast({ title: center ? "Centro actualizado" : "Centro creado" });
            onClose();
        } catch (e) {
            toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "No se pudo guardar." });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{center ? "Editar centro de costo" : "Nuevo centro de costo"}</DialogTitle>
                    <DialogDescription>Define el presupuesto y el responsable. El código se autogenera si lo dejas vacío.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Código</Label>
                            <Input value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder="Auto (CC-…)" className="rounded-xl" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Tipo</Label>
                            <Select value={form.type} onValueChange={(v) => set({ type: v as CostCenterType })}>
                                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {CC_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Nombre</Label>
                        <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ej: Mantención Flota Norte" className="rounded-xl" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Presupuesto (CLP)</Label>
                            <Input type="number" min={0} value={form.budget} onChange={(e) => set({ budget: Number(e.target.value) })} className="rounded-xl" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Estado</Label>
                            <Select value={form.status} onValueChange={(v) => set({ status: v as "active" | "closed" })}>
                                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">Activo</SelectItem>
                                    <SelectItem value="closed">Cerrado</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Responsable (opcional)</Label>
                        <Select value={form.responsibleId || UNASSIGNED} onValueChange={(v) => set({ responsibleId: v === UNASSIGNED ? "" : v })}>
                            <SelectTrigger className="rounded-xl"><SelectValue placeholder="Sin responsable" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={UNASSIGNED}>Sin responsable</SelectItem>
                                {(users || []).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Inicio (opcional)</Label>
                            <Input type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} className="rounded-xl" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Término (opcional)</Label>
                            <Input type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} className="rounded-xl" />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Notas</Label>
                        <Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} className="rounded-xl" />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} className="rounded-xl">Cancelar</Button>
                    <Button onClick={submit} disabled={saving} className="rounded-xl">{saving ? "Guardando…" : "Guardar"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Tab: Imputación de OC ────────────────────────────────────────────────────
function ImputacionTab({ centers, orders, canManage }: { centers: CostCenter[]; orders: PurchaseOrder[]; canManage: boolean }) {
    const { assignOrderCostCenter } = useAppState();
    const { toast } = useToast();
    const [query, setQuery] = useState("");
    const [onlyUnassigned, setOnlyUnassigned] = useState(false);

    const activeCenters = centers.filter((c) => c.status === "active");

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return orders
            .filter((po) => po.status !== "cancelled")
            .filter((po) => (onlyUnassigned ? !po.costCenterId : true))
            .filter((po) => {
                if (!q) return true;
                return (
                    (po.officialOCId || po.id || "").toLowerCase().includes(q) ||
                    (po.supplierName || "").toLowerCase().includes(q)
                );
            })
            .sort((a, b) => Number(!!a.costCenterId) - Number(!!b.costCenterId) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [orders, query, onlyUnassigned]);

    const assign = async (orderId: string, value: string) => {
        try {
            await assignOrderCostCenter(orderId, value === UNASSIGNED ? null : value);
            toast({ title: "Imputación actualizada" });
        } catch (e) {
            toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "No se pudo imputar." });
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
                <div className="relative w-full sm:w-80">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar OC o proveedor…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9 rounded-xl" />
                </div>
                <Button variant={onlyUnassigned ? "default" : "outline"} onClick={() => setOnlyUnassigned((v) => !v)} className="rounded-xl">
                    <AlertTriangle className="mr-2 h-4 w-4" /> Solo sin imputar
                </Button>
            </div>

            {rows.length === 0 ? (
                <EmptyState icon={<Building2 className="h-6 w-6" />} title="Sin órdenes de compra" description="No hay órdenes que coincidan con el filtro." />
            ) : (
                <Card className="rounded-[1.5rem]">
                    <CardContent className="p-0 divide-y">
                        {rows.map((po) => (
                            <div key={po.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-foreground truncate">
                                        {po.officialOCId || po.id}
                                        {!po.costCenterId && <Badge className="ml-2 rounded-lg badge-warning text-[10px]">Sin imputar</Badge>}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate">{po.supplierName || "Sin proveedor"}</p>
                                </div>
                                <div className="text-sm font-semibold tabular-nums text-foreground sm:w-32 sm:text-right">
                                    {CLP.format(po.totalAmount || 0)}
                                </div>
                                <div className="sm:w-64">
                                    <Select
                                        value={po.costCenterId || UNASSIGNED}
                                        onValueChange={(v) => assign(po.id, v)}
                                        disabled={!canManage}
                                    >
                                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Imputar a…" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={UNASSIGNED}>Sin imputar</SelectItem>
                                            {activeCenters.map((c) => (
                                                <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
