"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { supabase } from "@/modules/core/lib/supabase";
import { ACTIVO_USAGE_TYPES } from "@/lib/api/mappers";
import { ReceivePurchaseDialog, type ReceivableLine } from "@/components/receiving/receive-purchase-dialog";
import { CorrectReceiptDialog, type CorrectableReceiptLine } from "@/components/receiving/correct-receipt-dialog";
import { cn } from "@/lib/utils";
import { CalendarClock, CheckCircle2, ChevronDown, PackageCheck, RefreshCw, Truck, Undo2, Warehouse } from "lucide-react";
import { format, isBefore, startOfDay } from "date-fns";
import { es } from "date-fns/locale";

interface Line {
    id: string;
    external_ref: string;
    expected_qty: number;
    canceled_at: string | null;
    materials: { name: string; unit: string | null; usage_type: string | null } | null;
    expected_purchase_receipt_lines: { qty: number; expected_purchase_receipt_corrections: { qty_removed: number }[] }[];
}
interface Receipt {
    id: string;
    guide_number: string;
    received_on: string;
    received_by_name: string;
    created_at: string;
    expected_purchase_receipt_lines: {
        id: string; qty: number; line_id: string;
        expected_purchase_receipt_corrections: { qty_removed: number; reason: string }[];
    }[];
}
interface Purchase {
    id: string;
    external_ref: string;
    estimated_date: string | null;
    contract_ref: string | null;
    canceled_at: string | null;
    created_at: string;
    updated_at: string;
    warehouse_id: string;
    suppliers: { name: string } | null;
    warehouses: { name: string } | null;
    expected_purchase_lines: Line[];
    expected_purchase_receipts: Receipt[];
}

const corrected = (corr: { qty_removed: number }[]) => corr.reduce((s, c) => s + Number(c.qty_removed), 0);
// Lo recibido NETO: lo recibido menos lo que después se corrigió.
const received = (l: Line) => l.expected_purchase_receipt_lines.reduce(
    (s, r) => s + Number(r.qty) - corrected(r.expected_purchase_receipt_corrections ?? []), 0);
const remaining = (l: Line) => Math.max(Number(l.expected_qty) - received(l), 0);

/**
 * Lo que el sistema de compras anunció y viene en camino hacia los pañoles, y su recepción. Sólo
 * para las empresas que reciben en Pagnol. No es una orden de compra de Pagnol ni genera gasto:
 * recibir crea el activo (por unidad) o el ingreso de stock y le avisa al sistema de compras.
 */
export default function PorRecibirPage() {
    const { currentTenant, can } = useAppState();
    const mode = currentTenant?.receivingMode ?? "externa";
    const canReceive = can("stock:receive_order");

    const [rows, setRows] = useState<Purchase[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [warehouse, setWarehouse] = useState("all");
    const [tab, setTab] = useState<"pending" | "done">("pending");
    const [receiving, setReceiving] = useState<Purchase | null>(null);
    const [correcting, setCorrecting] = useState<CorrectableReceiptLine | null>(null);
    const [open, setOpen] = useState<Set<string>>(new Set());

    const load = useCallback(async () => {
        const { data, error: err } = await supabase
            .from("expected_purchases")
            .select("id, external_ref, estimated_date, contract_ref, canceled_at, created_at, updated_at, warehouse_id, suppliers(name), warehouses(name), expected_purchase_lines(id, external_ref, expected_qty, canceled_at, materials(name, unit, usage_type), expected_purchase_receipt_lines(qty, expected_purchase_receipt_corrections(qty_removed))), expected_purchase_receipts(id, guide_number, received_on, received_by_name, created_at, expected_purchase_receipt_lines(id, qty, line_id, expected_purchase_receipt_corrections(qty_removed, reason)))")
            .is("canceled_at", null)
            .order("updated_at", { ascending: false })
            .limit(300);
        setError(err ? err.message : null);
        if (err) { setRows([]); return; }
        setRows((data ?? []) as unknown as Purchase[]);
    }, []);

    useEffect(() => {
        if (mode !== "pagnol") return;
        // Fuera del cuerpo del efecto: la carga termina en setState y no debe correr de forma síncrona.
        const t = setTimeout(() => void load(), 0);
        return () => clearTimeout(t);
    }, [mode, load]);

    const all = useMemo(
        () => (rows ?? [])
            .map(p => ({ ...p, lines: p.expected_purchase_lines.filter(l => !l.canceled_at) }))
            .filter(p => p.lines.length > 0),
        [rows],
    );
    const pending = all.filter(p => p.lines.some(l => remaining(l) > 0))
        .sort((a, b) => (a.estimated_date ?? "9999").localeCompare(b.estimated_date ?? "9999"));
    const done = all.filter(p => p.lines.every(l => remaining(l) === 0));
    const warehouses = useMemo(() => {
        const m = new Map<string, string>();
        for (const p of all) m.set(p.warehouse_id, p.warehouses?.name ?? "Pañol");
        return [...m.entries()];
    }, [all]);
    const shown = (tab === "pending" ? pending : done).filter(p => warehouse === "all" || p.warehouse_id === warehouse);
    const today = startOfDay(new Date());

    if (mode !== "pagnol") {
        return (
            <PageShell title="Por recibir" description="Lo que viene en camino hacia tus pañoles.">
                <EmptyState
                    icon={<Truck size={24} />}
                    title="Tu empresa recibe en su sistema de compras"
                    description="Cuando la recepción se hace en Pagnol, aquí aparecen las compras que vienen en camino. Se activa en Configuración › Dónde se recibe."
                />
            </PageShell>
        );
    }

    const toReceivable = (p: Purchase): ReceivableLine[] =>
        p.expected_purchase_lines.filter(l => !l.canceled_at).map(l => ({
            id: l.id,
            name: l.materials?.name ?? "Ítem",
            unit: l.materials?.unit ?? null,
            expected: Number(l.expected_qty),
            received: received(l),
            tracked: !!l.materials?.usage_type && (ACTIVO_USAGE_TYPES as readonly string[]).includes(l.materials.usage_type),
        }));

    return (
        <PageShell
            title="Por recibir"
            description="Lo que tu sistema de compras anunció y viene en camino hacia los pañoles."
            toolbar={
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    {warehouses.length > 1 && (
                        <select value={warehouse} onChange={e => setWarehouse(e.target.value)}
                            className="h-10 rounded-xl border bg-background px-3 text-sm" aria-label="Pañol">
                            <option value="all">Todos los pañoles</option>
                            {warehouses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                        </select>
                    )}
                    <Button variant="outline" size="icon" className="rounded-xl shrink-0" onClick={() => void load()} aria-label="Actualizar">
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </div>
            }
        >
            <div className="flex items-center gap-1 bg-muted/50 border rounded-xl p-1 w-full sm:w-fit">
                {([["pending", "Por recibir", pending.length], ["done", "Recibidas", done.length]] as const).map(([k, label, n]) => (
                    <button key={k} type="button" onClick={() => setTab(k)}
                        className={cn("flex-1 sm:flex-none px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                            tab === k ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                        {label} ({n})
                    </button>
                ))}
            </div>

            {error && <p className="text-sm text-destructive">No se pudo cargar: {error}</p>}

            {rows === null ? (
                <LoadingState />
            ) : shown.length === 0 ? (
                <EmptyState
                    icon={<PackageCheck size={24} />}
                    title={tab === "pending" ? "Nada por recibir" : "Aún no hay compras recibidas"}
                    description={tab === "pending"
                        ? "Cuando tu sistema de compras anuncie una compra, aparecerá aquí con lo que trae y para qué pañol viene."
                        : "Las compras que recibas por completo quedarán aquí."}
                />
            ) : (
                <div className="space-y-4">
                    {shown.map(p => {
                        const eta = p.estimated_date ? new Date(`${p.estimated_date}T12:00:00`) : null;
                        const complete = p.lines.every(l => remaining(l) === 0);
                        const late = !complete && !!eta && isBefore(eta, today);
                        return (
                            <section key={p.id} className="bg-card rounded-[1.5rem] border shadow-sm p-5 space-y-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    {/* El pañolero ve lo que se compró y a quién, no la OC del sistema de compras. */}
                                    <div className="space-y-1 min-w-0">
                                        <p className="font-bold text-base break-words">{p.suppliers?.name ?? "Proveedor sin indicar"}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {p.lines.length} ítem{p.lines.length !== 1 ? "s" : ""}
                                            {p.contract_ref ? ` · Contrato ${p.contract_ref}` : ""}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline" className="gap-1.5"><Warehouse className="h-3 w-3" />{p.warehouses?.name ?? "Pañol"}</Badge>
                                        {complete ? (
                                            <Badge variant="outline" className="gap-1.5 badge-success"><CheckCircle2 className="h-3 w-3" />Recibida</Badge>
                                        ) : (
                                            <Badge variant="outline" className={cn("gap-1.5", late && "bg-destructive/10 text-destructive")}>
                                                <CalendarClock className="h-3 w-3" />
                                                {eta ? `${late ? "Debía llegar el " : "Llega el "}${format(eta, "d MMM", { locale: es })}` : "Sin fecha estimada"}
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                                <ul className="divide-y rounded-xl border">
                                    {p.lines.map(l => {
                                        const r = received(l);
                                        const exp = Number(l.expected_qty);
                                        return (
                                            <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                                                <span className="font-semibold break-words min-w-0">{l.materials?.name ?? "Ítem"}</span>
                                                <span className={cn("shrink-0", r >= exp ? "text-success font-bold" : "text-muted-foreground")}>
                                                    {r > 0 ? `${r} de ${exp}` : exp} {l.materials?.unit || (exp === 1 ? "unidad" : "unidades")}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                                {p.expected_purchase_receipts.length > 0 && (
                                    <div className="space-y-2">
                                        <button type="button" className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground"
                                            onClick={() => setOpen(prev => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                                            aria-expanded={open.has(p.id)}>
                                            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open.has(p.id) && "rotate-180")} />
                                            Recepciones registradas ({p.expected_purchase_receipts.length})
                                        </button>
                                        {open.has(p.id) && (
                                            <ul className="space-y-2">
                                                {[...p.expected_purchase_receipts].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(rc => (
                                                    <li key={rc.id} className="rounded-xl border p-3 space-y-1.5">
                                                        <p className="text-xs text-muted-foreground">
                                                            <b className="text-foreground">Guía {rc.guide_number}</b> · {format(new Date(`${rc.received_on}T12:00:00`), "d MMM yyyy", { locale: es })} · {rc.received_by_name}
                                                        </p>
                                                        {rc.expected_purchase_receipt_lines.map(rl => {
                                                            const line = p.lines.find(x => x.id === rl.line_id) ?? p.expected_purchase_lines.find(x => x.id === rl.line_id);
                                                            const quitado = corrected(rl.expected_purchase_receipt_corrections);
                                                            const net = Number(rl.qty) - quitado;
                                                            return (
                                                                <div key={rl.id} className="flex items-center justify-between gap-3 text-sm">
                                                                    <span className="min-w-0 break-words">
                                                                        <span className="font-semibold">{line?.materials?.name ?? "Ítem"}</span>{" "}
                                                                        <span className="text-muted-foreground">
                                                                            {Number(rl.qty)}{quitado > 0 ? ` (se quitaron ${quitado}${rl.expected_purchase_receipt_corrections[0]?.reason ? `: «${rl.expected_purchase_receipt_corrections[0].reason}»` : ""})` : ""}
                                                                        </span>
                                                                    </span>
                                                                    {canReceive && net > 0 && (
                                                                        <Button size="sm" variant="ghost" className="shrink-0 rounded-xl gap-1.5 text-muted-foreground"
                                                                            onClick={() => setCorrecting({
                                                                                id: rl.id, name: line?.materials?.name ?? "Ítem", unit: line?.materials?.unit ?? null, guide: rc.guide_number, net,
                                                                                tracked: !!line?.materials?.usage_type && (ACTIVO_USAGE_TYPES as readonly string[]).includes(line.materials.usage_type),
                                                                            })}>
                                                                            <Undo2 className="h-3.5 w-3.5" /> Corregir
                                                                        </Button>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}
                                {!complete && canReceive && (
                                    <div className="flex justify-end">
                                        <Button className="rounded-xl gap-2" onClick={() => setReceiving(p)}>
                                            <PackageCheck className="h-4 w-4" /> Recibir
                                        </Button>
                                    </div>
                                )}
                            </section>
                        );
                    })}
                </div>
            )}

            <CorrectReceiptDialog
                key={correcting?.id ?? "none-c"}
                line={correcting}
                onClose={() => setCorrecting(null)}
                onDone={() => void load()}
            />
            <ReceivePurchaseDialog
                key={receiving?.id ?? "none"}
                purchase={receiving ? {
                    id: receiving.id, title: receiving.suppliers?.name ?? "la compra", warehouse: receiving.warehouses?.name ?? "el pañol",
                    lines: toReceivable(receiving),
                } : null}
                onClose={() => setReceiving(null)}
                onDone={() => void load()}
            />
        </PageShell>
    );
}
