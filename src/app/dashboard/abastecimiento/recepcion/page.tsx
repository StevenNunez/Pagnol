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
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/modules/core/hooks/use-toast";
import { compressImage } from "@/lib/compress-image";
import { cn } from "@/lib/utils";
import type { PurchaseOrder, GoodsReceipt, ReceiptItem, ReceiptPhoto, Material } from "@/modules/core/lib/data";
import {
    Truck, PackageCheck, PackageOpen, Boxes, ChevronsUpDown, Check, ImagePlus, Loader2,
    Camera, Trash2, Search, X, ClipboardList,
} from "lucide-react";

const fmtDate = (iso?: string | Date) =>
    iso ? new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const ACTIVE_PO = ["generated", "sent", "issued"];

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{children}</p>;
}

// Clave estable de un ítem de OC — DEBE coincidir con receptionMutations.
const itemKey = (it: { id?: string; name: string }, idx: number) => it.id || `${it.name}#${idx}`;

type Kpi = { label: string; value: string; hint?: string; icon: React.ElementType; tone: keyof typeof toneStyles };
const toneStyles = {
    default: "bg-muted text-foreground",
    warning: "bg-warning-subtle text-warning-subtle-foreground",
    info: "bg-info-subtle text-info-subtle-foreground",
    success: "bg-success-subtle text-success-subtle-foreground",
} as const;

export default function RecepcionPage() {
    const { purchaseOrders, goodsReceipts, materials, can, receiveGoodsReceipt, uploadReceptionPhoto, deleteGoodsReceipt } = useAppState();
    const { toast } = useToast();
    const [query, setQuery] = useState("");
    const [target, setTarget] = useState<PurchaseOrder | null>(null);

    const canReceive = can("stock:receive_order");

    // Mapa: purchaseOrderId → (itemKey → cantidad recibida acumulada).
    const receivedByPO = useMemo(() => {
        const m = new Map<string, Map<string, number>>();
        for (const r of goodsReceipts || []) {
            const inner = m.get(r.purchaseOrderId) || new Map<string, number>();
            for (const it of r.items || []) {
                inner.set(it.itemId, (inner.get(it.itemId) || 0) + (it.receivedQuantity || 0));
            }
            m.set(r.purchaseOrderId, inner);
        }
        return m;
    }, [goodsReceipts]);

    // OCs activas (recepción pendiente o parcial), ordenadas por fecha.
    const activeOrders = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (purchaseOrders || [])
            .filter((po) => ACTIVE_PO.includes(po.status))
            .filter((po) => {
                if (!q) return true;
                return (
                    (po.id || "").toLowerCase().includes(q) ||
                    (po.officialOCId || "").toLowerCase().includes(q) ||
                    (po.supplierName || "").toLowerCase().includes(q)
                );
            })
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [purchaseOrders, query]);

    const kpis = useMemo<Kpi[]>(() => {
        const active = (purchaseOrders || []).filter((po) => ACTIVE_PO.includes(po.status));
        let pending = 0;
        let partial = 0;
        for (const po of active) {
            const rec = receivedByPO.get(po.id);
            const some = rec && Array.from(rec.values()).some((v) => v > 0);
            if (some) partial++;
            else pending++;
        }
        const completed = (purchaseOrders || []).filter((po) => po.status === "completed").length;
        const now = new Date();
        const monthCount = (goodsReceipts || []).filter((r) => {
            const d = new Date(r.receivedAt);
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }).length;
        return [
            { label: "Por recibir", value: String(pending), hint: "Sin recepciones aún", icon: PackageOpen, tone: "warning" },
            { label: "Parciales", value: String(partial), hint: "Recepción incompleta", icon: Truck, tone: "info" },
            { label: "Recibidas", value: String(completed), hint: "OC completadas", icon: PackageCheck, tone: "success" },
            { label: "Recepciones del mes", value: String(monthCount), hint: "Eventos registrados", icon: Boxes, tone: "default" },
        ];
    }, [purchaseOrders, goodsReceipts, receivedByPO]);

    const recentReceipts = useMemo(
        () => (goodsReceipts || []).slice(0, 12),
        [goodsReceipts],
    );

    return (
        <PageShell
            title="Recepción de Mercadería"
            description="Recibe las órdenes de compra contra bodega — total o parcial — con evidencia fotográfica. El stock se actualiza automáticamente."
            toolbar={
                <div className="relative w-full xl:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por OC o proveedor…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="pl-9 rounded-xl"
                    />
                </div>
            }
        >
            {/* KPIs */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {kpis.map((kpi) => (
                    <Card key={kpi.label} className="rounded-[1.5rem]">
                        <CardContent className="p-5 flex flex-col gap-3">
                            <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", toneStyles[kpi.tone])}>
                                <kpi.icon className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="text-2xl font-black tracking-tight text-foreground">{kpi.value}</p>
                                <MicroLabel>{kpi.label}</MicroLabel>
                                {kpi.hint && <p className="text-xs text-muted-foreground mt-1">{kpi.hint}</p>}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* OCs pendientes de recepción */}
            <div className="space-y-4">
                <MicroLabel>Órdenes pendientes de recepción</MicroLabel>
                {activeOrders.length === 0 ? (
                    <EmptyState
                        icon={<PackageCheck className="h-6 w-6" />}
                        title="No hay órdenes por recibir"
                        description="Cuando se genere o adjudique una Orden de Compra aparecerá aquí para su recepción."
                    />
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {activeOrders.map((po) => (
                            <OrderCard
                                key={po.id}
                                po={po}
                                received={receivedByPO.get(po.id)}
                                canReceive={canReceive}
                                onReceive={() => setTarget(po)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Historial de recepciones */}
            {recentReceipts.length > 0 && (
                <div className="space-y-4">
                    <MicroLabel>Recepciones recientes</MicroLabel>
                    <Card className="rounded-[1.5rem]">
                        <CardContent className="p-0 divide-y">
                            {recentReceipts.map((r) => (
                                <ReceiptRow
                                    key={r.id}
                                    receipt={r}
                                    canDelete={can("stock:receive_order")}
                                    onDelete={async () => {
                                        try {
                                            await deleteGoodsReceipt(r.id);
                                            toast({ title: "Recepción eliminada" });
                                        } catch (e) {
                                            toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "No se pudo eliminar." });
                                        }
                                    }}
                                />
                            ))}
                        </CardContent>
                    </Card>
                </div>
            )}

            {target && (
                <ReceiveDialog
                    po={target}
                    received={receivedByPO.get(target.id)}
                    materials={materials || []}
                    onClose={() => setTarget(null)}
                    receiveGoodsReceipt={receiveGoodsReceipt}
                    uploadReceptionPhoto={uploadReceptionPhoto}
                />
            )}
        </PageShell>
    );
}

// ── Tarjeta de OC ────────────────────────────────────────────────────────────
function OrderCard({
    po, received, canReceive, onReceive,
}: {
    po: PurchaseOrder;
    received?: Map<string, number>;
    canReceive: boolean;
    onReceive: () => void;
}) {
    const rows = (po.items || []).map((it, idx) => {
        const key = itemKey(it, idx);
        const recd = received?.get(key) || 0;
        const remaining = Math.max(0, (it.totalQuantity || 0) - recd);
        return { name: it.name, unit: it.unit, ordered: it.totalQuantity || 0, recd, remaining };
    });
    const hasSome = rows.some((r) => r.recd > 0);

    return (
        <Card className="rounded-[1.5rem] flex flex-col">
            <CardContent className="p-5 space-y-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="font-bold text-foreground">{po.officialOCId || po.id}</p>
                        <p className="text-sm text-muted-foreground">{po.supplierName || "Sin proveedor"}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(po.createdAt)}</p>
                    </div>
                    <Badge className={cn("rounded-xl", hasSome ? "badge-info" : "badge-warning")}>
                        {hasSome ? "Parcial" : "Pendiente"}
                    </Badge>
                </div>

                <div className="rounded-xl border divide-y">
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        <span>Ítem</span><span className="text-right">Ord.</span><span className="text-right">Recib.</span><span className="text-right">Pend.</span>
                    </div>
                    {rows.map((r, i) => (
                        <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 text-sm items-center">
                            <span className="truncate text-foreground">{r.name}</span>
                            <span className="text-right tabular-nums text-muted-foreground">{r.ordered}</span>
                            <span className="text-right tabular-nums text-foreground">{r.recd}</span>
                            <span className={cn("text-right tabular-nums font-semibold", r.remaining === 0 ? "text-success" : "text-foreground")}>
                                {r.remaining}
                            </span>
                        </div>
                    ))}
                </div>

                <Button
                    className="w-full mt-auto rounded-xl"
                    onClick={onReceive}
                    disabled={!canReceive}
                >
                    <Truck className="mr-2 h-4 w-4" />
                    Registrar recepción
                </Button>
            </CardContent>
        </Card>
    );
}

// ── Fila de historial ────────────────────────────────────────────────────────
function ReceiptRow({ receipt, canDelete, onDelete }: { receipt: GoodsReceipt; canDelete: boolean; onDelete: () => void }) {
    const totalItems = (receipt.items || []).reduce((a, it) => a + (it.receivedQuantity || 0), 0);
    return (
        <div className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success-subtle text-success-subtle-foreground shrink-0">
                <PackageCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground truncate">
                    {receipt.internalCode} <span className="text-muted-foreground font-normal">· OC {receipt.purchaseOrderCode}</span>
                </p>
                <p className="text-xs text-muted-foreground truncate">
                    {receipt.supplierName} · {receipt.receivedByName} · {fmtDate(receipt.receivedAt)}
                </p>
            </div>
            <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                <span className="flex items-center gap-1"><ClipboardList className="h-3.5 w-3.5" />{totalItems} u.</span>
                {(receipt.photos || []).length > 0 && (
                    <span className="flex items-center gap-1"><Camera className="h-3.5 w-3.5" />{receipt.photos.length}</span>
                )}
            </div>
            {canDelete && (
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive shrink-0">
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Eliminar recepción</AlertDialogTitle>
                            <AlertDialogDescription>
                                Se eliminará el registro de recepción {receipt.internalCode}. El stock ya ingresado NO se revierte automáticamente.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={onDelete}>Eliminar</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </div>
    );
}

// ── Combobox de material destino ─────────────────────────────────────────────
function MaterialPicker({
    materials, value, onChange,
}: {
    materials: Material[];
    value?: string;
    onChange: (id: string | undefined) => void;
}) {
    const [open, setOpen] = useState(false);
    const selected = materials.find((m) => m.id === value);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" size="sm" className="w-full justify-between rounded-xl font-normal">
                    <span className="truncate">{selected ? selected.name : "Crear material nuevo"}</span>
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                    <CommandInput placeholder="Buscar material…" />
                    <CommandList>
                        <CommandEmpty>No se encontró el material.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem
                                value="__new__"
                                onSelect={() => { onChange(undefined); setOpen(false); }}
                            >
                                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                                <span className="italic text-muted-foreground">Crear material nuevo</span>
                            </CommandItem>
                            {materials.map((m) => (
                                <CommandItem
                                    key={m.id}
                                    value={m.name}
                                    onSelect={() => { onChange(m.id); setOpen(false); }}
                                    className="flex justify-between"
                                >
                                    <div className="flex items-center">
                                        <Check className={cn("mr-2 h-4 w-4", value === m.id ? "opacity-100" : "opacity-0")} />
                                        {m.name}
                                    </div>
                                    <span className="text-xs text-muted-foreground">Stock: {m.stock?.toLocaleString?.() ?? m.stock}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

// ── Diálogo de recepción ─────────────────────────────────────────────────────
type LineState = { qty: number; materialId?: string };

function ReceiveDialog({
    po, received, materials, onClose, receiveGoodsReceipt, uploadReceptionPhoto,
}: {
    po: PurchaseOrder;
    received?: Map<string, number>;
    materials: Material[];
    onClose: () => void;
    receiveGoodsReceipt: (data: { purchaseOrderId: string; items: ReceiptItem[]; photos: ReceiptPhoto[]; notes?: string }) => Promise<void>;
    uploadReceptionPhoto: (purchaseOrderId: string, file: File) => Promise<ReceiptPhoto>;
}) {
    const { toast } = useToast();

    // Línea por ítem de OC, con la cantidad pendiente como valor por defecto
    // y un material calzado por nombre si existe.
    const lines = useMemo(() => {
        return (po.items || []).map((it, idx) => {
            const key = itemKey(it, idx);
            const recd = received?.get(key) || 0;
            const remaining = Math.max(0, (it.totalQuantity || 0) - recd);
            const match = materials.find((m) => m.name.trim().toLowerCase() === it.name.trim().toLowerCase());
            return { key, name: it.name, unit: it.unit, ordered: it.totalQuantity || 0, recd, remaining, defaultMaterialId: match?.id };
        });
    }, [po, received, materials]);

    const [state, setState] = useState<Record<string, LineState>>(() => {
        const s: Record<string, LineState> = {};
        for (const l of lines) s[l.key] = { qty: l.remaining, materialId: l.defaultMaterialId };
        return s;
    });
    const [photos, setPhotos] = useState<ReceiptPhoto[]>([]);
    const [notes, setNotes] = useState("");
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const update = (key: string, patch: Partial<LineState>) =>
        setState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

    const handlePhotos = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                const compressed = await compressImage(file).catch(() => file);
                const photo = await uploadReceptionPhoto(po.id, compressed);
                setPhotos((prev) => [...prev, photo]);
            }
        } catch (e) {
            toast({ variant: "destructive", title: "Error al subir foto", description: e instanceof Error ? e.message : "Inténtalo de nuevo." });
        } finally {
            setUploading(false);
        }
    };

    const submit = async () => {
        const items: ReceiptItem[] = lines
            .map((l) => {
                const qty = Number(state[l.key]?.qty || 0);
                return {
                    itemId: l.key,
                    name: l.name,
                    unit: l.unit,
                    orderedQuantity: l.ordered,
                    receivedQuantity: qty,
                    materialId: state[l.key]?.materialId,
                };
            })
            .filter((it) => it.receivedQuantity > 0);

        if (!items.length) {
            toast({ variant: "destructive", title: "Nada que recibir", description: "Indica al menos una cantidad recibida." });
            return;
        }
        const exceeds = lines.find((l) => Number(state[l.key]?.qty || 0) > l.remaining);
        if (exceeds) {
            toast({ variant: "destructive", title: "Cantidad excedida", description: `"${exceeds.name}" supera lo pendiente (${exceeds.remaining}).` });
            return;
        }

        setSubmitting(true);
        try {
            await receiveGoodsReceipt({ purchaseOrderId: po.id, items, photos, notes: notes.trim() || undefined });
            toast({ title: "Recepción registrada", description: "El stock se actualizó correctamente." });
            onClose();
        } catch (e) {
            toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "No se pudo registrar la recepción." });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Recepción · {po.officialOCId || po.id}</DialogTitle>
                    <DialogDescription>
                        {po.supplierName} — confirma las cantidades recibidas y el material de destino. Puedes recibir parcialmente.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {lines.map((l) => (
                        <div key={l.key} className="rounded-xl border p-4 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <p className="font-semibold text-foreground">{l.name}</p>
                                <span className="text-xs text-muted-foreground">
                                    Pendiente: <strong className="text-foreground">{l.remaining}</strong> {l.unit} · Ordenado {l.ordered}
                                </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Cantidad recibida</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        max={l.remaining}
                                        value={state[l.key]?.qty ?? 0}
                                        onChange={(e) => update(l.key, { qty: Math.max(0, Number(e.target.value)) })}
                                        className="rounded-xl"
                                        disabled={l.remaining === 0}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Material destino (bodega)</Label>
                                    <MaterialPicker
                                        materials={materials}
                                        value={state[l.key]?.materialId}
                                        onChange={(id) => update(l.key, { materialId: id })}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Evidencia fotográfica */}
                    <div className="space-y-2">
                        <Label className="text-xs">Evidencia fotográfica (opcional)</Label>
                        <div className="flex flex-wrap gap-2">
                            {photos.map((p) => (
                                <div key={p.id} className="relative h-20 w-20 rounded-xl overflow-hidden border">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={p.url} alt={p.name || "foto"} className="h-full w-full object-cover" />
                                    <button
                                        type="button"
                                        onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                                        className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 text-destructive hover:bg-background"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ))}
                            <label className={cn(
                                "flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-muted-foreground hover:border-primary hover:text-primary transition-colors",
                                uploading && "pointer-events-none opacity-60",
                            )}>
                                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                                <span className="text-[10px] font-medium">{uploading ? "Subiendo…" : "Agregar"}</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => { handlePhotos(e.target.files); e.target.value = ""; }}
                                />
                            </label>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Observaciones</Label>
                        <Textarea
                            placeholder="Estado de la mercadería, faltantes, daños, número de guía de despacho…"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="rounded-xl"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} className="rounded-xl">Cancelar</Button>
                    <Button onClick={submit} disabled={submitting || uploading} className="rounded-xl">
                        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
                        Confirmar recepción
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
