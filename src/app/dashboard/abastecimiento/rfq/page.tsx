"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/modules/core/hooks/use-toast";
import { compressImage } from "@/lib/compress-image";
import { cn } from "@/lib/utils";
import type { QuoteRequest, QuoteRequestStatus, QuoteItem, QuoteItemPrice, Supplier } from "@/modules/core/lib/data";
import {
    Search, Plus, Building2, Trash2, Send, Lock, ListChecks, FileText, Upload, Loader2,
    CheckCircle2, Clock, Package, Paperclip, Award,
} from "lucide-react";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fmtDate = (iso?: string | Date) =>
    iso ? new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS: Record<QuoteRequestStatus, { label: string; badge: string }> = {
    draft: { label: "Borrador", badge: "bg-muted text-foreground" },
    sent: { label: "Enviada", badge: "badge-info" },
    closed: { label: "Cerrada", badge: "badge-warning" },
    awarded: { label: "Adjudicada", badge: "badge-success" },
    cancelled: { label: "Cancelada", badge: "badge-destructive" },
};

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{children}</p>;
}

export default function RfqPage() {
    const { quoteRequests, can } = useAppState();
    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [managingId, setManagingId] = useState<string | null>(null);

    const list = useMemo(() => {
        const q = search.trim().toLowerCase();
        const base = quoteRequests || [];
        if (!q) return base;
        return base.filter(
            (r) => r.title.toLowerCase().includes(q) || r.internalCode.toLowerCase().includes(q),
        );
    }, [quoteRequests, search]);

    const managing = useMemo(
        () => (quoteRequests || []).find((r) => r.id === managingId) ?? null,
        [quoteRequests, managingId],
    );

    return (
        <PageShell
            title="Cotizaciones (RFQ)"
            description="Solicita cotizaciones a varios proveedores por un paquete de ítems y compáralas para adjudicar."
            toolbar={
                <>
                    <div className="relative w-full xl:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar RFQ…" className="pl-9 rounded-xl" />
                    </div>
                    {can("orders:create") && (
                        <Button className="rounded-xl" onClick={() => setCreateOpen(true)}>
                            <Plus className="h-4 w-4 mr-2" /> Nueva RFQ
                        </Button>
                    )}
                </>
            }
        >
            {list.length === 0 ? (
                <EmptyState
                    icon={<ListChecks size={24} />}
                    title="Sin cotizaciones"
                    description="Crea una RFQ a partir de requerimientos aprobados e invita a tus proveedores."
                />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {list.map((rfq) => (
                        <RfqCard key={rfq.id} rfq={rfq} onManage={() => setManagingId(rfq.id)} />
                    ))}
                </div>
            )}

            {createOpen && <CreateRfqDialog onClose={() => setCreateOpen(false)} />}
            {managing && <ManageRfqDialog rfq={managing} onClose={() => setManagingId(null)} />}
        </PageShell>
    );
}

// ── Card de RFQ ───────────────────────────────────────────────────────────────
function RfqCard({ rfq, onManage }: { rfq: QuoteRequest; onManage: () => void }) {
    const router = useRouter();
    const st = STATUS[rfq.status];
    return (
        <Card className="rounded-[1.5rem] flex flex-col">
            <CardContent className="p-5 space-y-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <p className="text-xs text-muted-foreground font-mono">{rfq.internalCode}</p>
                        <p className="font-bold text-foreground">{rfq.title}</p>
                    </div>
                    <Badge className={cn("rounded-xl text-[10px] shrink-0", st.badge)}>{st.label}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-lg font-black">{rfq.items.length}</p><MicroLabel>Ítems</MicroLabel></div>
                    <div><p className="text-lg font-black">{rfq.supplierIds.length}</p><MicroLabel>Invitados</MicroLabel></div>
                    <div><p className="text-lg font-black">{rfq.responses.length}</p><MicroLabel>Ofertas</MicroLabel></div>
                </div>
                {rfq.deadline && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" /> Límite: {fmtDate(rfq.deadline)}
                    </p>
                )}
                <div className="mt-auto flex gap-2 pt-2">
                    <Button variant="outline" className="rounded-xl flex-1" onClick={onManage}>
                        <FileText className="h-4 w-4 mr-2" /> Gestionar
                    </Button>
                    {rfq.responses.length > 0 && (
                        <Button
                            className="rounded-xl flex-1"
                            onClick={() => router.push(`/dashboard/abastecimiento/comparador?rfq=${rfq.id}`)}
                        >
                            <ListChecks className="h-4 w-4 mr-2" /> Comparar
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

// ── Crear RFQ ───────────────────────────────────────────────────────────────
function CreateRfqDialog({ onClose }: { onClose: () => void }) {
    const { purchaseRequests, suppliers, quoteRequests, addQuoteRequest } = useAppState();
    const { toast } = useToast();
    const [title, setTitle] = useState("");
    const [deadline, setDeadline] = useState("");
    const [notes, setNotes] = useState("");
    const [selectedReqs, setSelectedReqs] = useState<string[]>([]);
    const [selectedSups, setSelectedSups] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    // Solicitudes aprobadas que aún no están en una RFQ adjudicada/ordenada.
    const orderedReqIds = useMemo(() => {
        const ids = new Set<string>();
        (quoteRequests || []).forEach((r) => {
            if (r.status === "awarded") r.requestIds.forEach((id) => ids.add(id));
        });
        return ids;
    }, [quoteRequests]);

    const approved = useMemo(
        () => (purchaseRequests || []).filter((p) => p.status === "approved" && !orderedReqIds.has(p.id)),
        [purchaseRequests, orderedReqIds],
    );

    const toggleReq = (id: string) =>
        setSelectedReqs((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    const toggleSup = (id: string) =>
        setSelectedSups((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

    const save = async () => {
        if (selectedReqs.length === 0) { toast({ variant: "destructive", title: "Selecciona ítems", description: "Elige al menos una solicitud aprobada." }); return; }
        if (selectedSups.length === 0) { toast({ variant: "destructive", title: "Invita proveedores", description: "Selecciona al menos un proveedor." }); return; }
        setSaving(true);
        try {
            const items: QuoteItem[] = approved
                .filter((p) => selectedReqs.includes(p.id))
                .map((p) => ({ id: p.id, name: p.materialName, unit: p.unit, quantity: p.quantity, category: p.category }));
            await addQuoteRequest({
                title: title.trim() || `RFQ ${new Date().toLocaleDateString("es-CL")}`,
                requestIds: selectedReqs,
                items,
                supplierIds: selectedSups,
                deadline: deadline || undefined,
                notes: notes.trim() || undefined,
            });
            toast({ title: "RFQ creada", description: "Ahora registra las cotizaciones de los proveedores." });
            onClose();
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error", description: e?.message || "No se pudo crear la RFQ." });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Nueva RFQ</DialogTitle>
                    <DialogDescription>Agrupa solicitudes aprobadas e invita proveedores a cotizar.</DialogDescription>
                </DialogHeader>
                <div className="space-y-5 py-2 max-h-[65vh] overflow-y-auto px-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Título</Label>
                            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Materiales eléctricos abril" />
                        </div>
                        <div className="space-y-2">
                            <Label>Fecha límite (opcional)</Label>
                            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                        </div>
                    </div>

                    {/* Ítems (solicitudes aprobadas) */}
                    <div className="space-y-2">
                        <MicroLabel>Ítems a cotizar — solicitudes aprobadas</MicroLabel>
                        {approved.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-3">No hay solicitudes aprobadas disponibles.</p>
                        ) : (
                            <div className="border rounded-xl divide-y max-h-48 overflow-auto">
                                {approved.map((p) => (
                                    <label key={p.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted">
                                        <Checkbox checked={selectedReqs.includes(p.id)} onCheckedChange={() => toggleReq(p.id)} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{p.materialName}</p>
                                            <p className="text-xs text-muted-foreground">{p.quantity} {p.unit} · {p.category}</p>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Proveedores invitados */}
                    <div className="space-y-2">
                        <MicroLabel>Proveedores invitados</MicroLabel>
                        {(suppliers || []).length === 0 ? (
                            <p className="text-sm text-muted-foreground py-3">No hay proveedores registrados.</p>
                        ) : (
                            <div className="border rounded-xl divide-y max-h-48 overflow-auto">
                                {(suppliers || []).map((s: Supplier) => (
                                    <label key={s.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted">
                                        <Checkbox checked={selectedSups.includes(s.id)} onCheckedChange={() => toggleSup(s.id)} />
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-secondary-foreground shrink-0">
                                            <Building2 className="h-4 w-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{s.name}</p>
                                            {s.categories?.length > 0 && <p className="text-xs text-muted-foreground truncate">{s.categories.join(", ")}</p>}
                                        </div>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label>Notas (opcional)</Label>
                        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Instrucciones, alcance, lugar de entrega…" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button onClick={save} disabled={saving}>
                        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Crear RFQ
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Gestionar RFQ (detalle + captura de cotizaciones) ─────────────────────────
function ManageRfqDialog({ rfq, onClose }: { rfq: QuoteRequest; onClose: () => void }) {
    const router = useRouter();
    const { suppliers, sendQuoteRequest, closeQuoteRequest, deleteQuoteRequest, deleteQuoteResponse, can } = useAppState();
    const { toast } = useToast();
    const [capturing, setCapturing] = useState<string | null>(null);

    const editable = can("orders:create") && rfq.status !== "awarded";
    const supName = (id: string) => suppliers?.find((s) => s.id === id)?.name || "Proveedor";
    const responseBySupplier = (id: string) => rfq.responses.find((r) => r.supplierId === id);

    const action = async (fn: () => Promise<void>, ok: string) => {
        try { await fn(); toast({ title: ok }); }
        catch (e: any) { toast({ variant: "destructive", title: "Error", description: e?.message }); }
    };

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {rfq.title}
                        <Badge className={cn("rounded-xl text-[10px]", STATUS[rfq.status].badge)}>{STATUS[rfq.status].label}</Badge>
                    </DialogTitle>
                    <DialogDescription>{rfq.internalCode} · {rfq.items.length} ítems · {rfq.supplierIds.length} proveedores invitados</DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-2 max-h-[65vh] overflow-y-auto px-1">
                    {/* Ítems */}
                    <div className="space-y-2">
                        <MicroLabel>Ítems solicitados</MicroLabel>
                        <div className="border rounded-xl divide-y">
                            {rfq.items.map((it) => (
                                <div key={it.id} className="flex items-center justify-between p-3 text-sm">
                                    <span className="font-medium flex items-center gap-2"><Package className="h-3.5 w-3.5 text-muted-foreground" /> {it.name}</span>
                                    <span className="text-muted-foreground">{it.quantity} {it.unit}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Proveedores + cotizaciones */}
                    <div className="space-y-2">
                        <MicroLabel>Cotizaciones por proveedor</MicroLabel>
                        <div className="space-y-3">
                            {rfq.supplierIds.map((sid) => {
                                const resp = responseBySupplier(sid);
                                const isAwarded = rfq.awardedSupplierId === sid;
                                return (
                                    <Card key={sid} className={cn("rounded-[1.5rem]", isAwarded && "ring-2 ring-success")}>
                                        <CardContent className="p-4 space-y-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                                                        <Building2 className="h-4 w-4" />
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold text-sm">{supName(sid)}</p>
                                                        {isAwarded && <span className="text-[10px] font-black uppercase tracking-widest text-success flex items-center gap-1"><Award className="h-3 w-3" /> Adjudicado</span>}
                                                    </div>
                                                </div>
                                                {resp ? (
                                                    <Badge className="badge-success rounded-xl text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" /> Cotizó</Badge>
                                                ) : (
                                                    <Badge className="rounded-xl text-[10px] bg-muted text-muted-foreground">Pendiente</Badge>
                                                )}
                                            </div>

                                            {resp && (
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                                                    <div><MicroLabel>Total</MicroLabel><p className="font-bold">{CLP.format(resp.totalPrice)}</p></div>
                                                    <div><MicroLabel>Entrega</MicroLabel><p>{resp.deliveryDays} días</p></div>
                                                    <div><MicroLabel>Garantía</MicroLabel><p className="truncate">{resp.warranty || "—"}</p></div>
                                                    <div><MicroLabel>Validez</MicroLabel><p>{fmtDate(resp.validityDate)}</p></div>
                                                    {resp.attachmentUrl && (
                                                        <a href={resp.attachmentUrl} target="_blank" rel="noopener noreferrer" className="col-span-2 sm:col-span-4 text-xs text-primary flex items-center gap-1 hover:underline">
                                                            <Paperclip className="h-3 w-3" /> {resp.attachmentName || "Ver adjunto"}
                                                        </a>
                                                    )}
                                                </div>
                                            )}

                                            {editable && (
                                                <div className="flex gap-2">
                                                    <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setCapturing(capturing === sid ? null : sid)}>
                                                        {resp ? "Editar cotización" : "Registrar cotización"}
                                                    </Button>
                                                    {resp && (
                                                        <Button variant="ghost" size="sm" className="rounded-lg text-destructive" onClick={() => action(() => deleteQuoteResponse(rfq.id, resp.id), "Cotización eliminada")}>
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                </div>
                                            )}

                                            {capturing === sid && (
                                                <CaptureForm
                                                    rfq={rfq}
                                                    supplierId={sid}
                                                    supplierName={supName(sid)}
                                                    onDone={() => setCapturing(null)}
                                                />
                                            )}
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <DialogFooter className="flex-wrap gap-2">
                    {can("orders:create") && rfq.status === "draft" && (
                        <Button variant="outline" className="rounded-xl" onClick={() => action(() => sendQuoteRequest(rfq.id), "RFQ marcada como enviada")}>
                            <Send className="h-4 w-4 mr-2" /> Marcar enviada
                        </Button>
                    )}
                    {can("orders:create") && (rfq.status === "sent" || rfq.status === "draft") && (
                        <Button variant="outline" className="rounded-xl" onClick={() => action(() => closeQuoteRequest(rfq.id), "RFQ cerrada")}>
                            <Lock className="h-4 w-4 mr-2" /> Cerrar recepción
                        </Button>
                    )}
                    {rfq.responses.length > 0 && rfq.status !== "awarded" && (
                        <Button className="rounded-xl" onClick={() => router.push(`/dashboard/abastecimiento/comparador?rfq=${rfq.id}`)}>
                            <ListChecks className="h-4 w-4 mr-2" /> Ir al comparador
                        </Button>
                    )}
                    {can("orders:create") && rfq.status !== "awarded" && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="rounded-xl text-destructive"><Trash2 className="h-4 w-4" /></Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>¿Eliminar la RFQ {rfq.internalCode}?</AlertDialogTitle>
                                    <AlertDialogDescription>Se eliminará la RFQ y sus cotizaciones. Los requerimientos no se ven afectados.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={async () => { await action(() => deleteQuoteRequest(rfq.id), "RFQ eliminada"); onClose(); }}>
                                        Sí, eliminar
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Formulario de captura de cotización ───────────────────────────────────────
function CaptureForm({
    rfq, supplierId, supplierName, onDone,
}: { rfq: QuoteRequest; supplierId: string; supplierName: string; onDone: () => void }) {
    const { addQuoteResponse, updateQuoteResponse, uploadQuoteAttachment } = useAppState();
    const { toast } = useToast();
    const existing = rfq.responses.find((r) => r.supplierId === supplierId);

    const [totalPrice, setTotalPrice] = useState<string>(existing ? String(existing.totalPrice) : "");
    const [deliveryDays, setDeliveryDays] = useState<string>(existing ? String(existing.deliveryDays) : "");
    const [warranty, setWarranty] = useState(existing?.warranty || "");
    const [conditions, setConditions] = useState(existing?.commercialConditions || "");
    const [validityDate, setValidityDate] = useState(existing?.validityDate || "");
    const [notes, setNotes] = useState(existing?.notes || "");
    const [detail, setDetail] = useState(!!existing?.itemPrices?.length);
    const [unitPrices, setUnitPrices] = useState<Record<string, string>>(() => {
        const m: Record<string, string> = {};
        existing?.itemPrices?.forEach((ip) => { m[ip.itemId] = String(ip.unitPrice); });
        return m;
    });
    const [file, setFile] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);

    const detailTotal = useMemo(() => {
        if (!detail) return 0;
        return rfq.items.reduce((acc, it) => acc + (Number(unitPrices[it.id]) || 0) * it.quantity, 0);
    }, [detail, unitPrices, rfq.items]);

    const effectiveTotal = detail ? detailTotal : Number(totalPrice) || 0;

    const save = async () => {
        if (effectiveTotal <= 0) { toast({ variant: "destructive", title: "Falta el precio total" }); return; }
        if (!deliveryDays || Number(deliveryDays) <= 0) { toast({ variant: "destructive", title: "Falta el plazo de entrega" }); return; }
        if (!warranty.trim()) { toast({ variant: "destructive", title: "Falta la garantía" }); return; }
        if (!conditions.trim()) { toast({ variant: "destructive", title: "Faltan las condiciones comerciales" }); return; }
        setSaving(true);
        try {
            let attachment: { url: string; path: string; name: string } | null = null;
            if (file) {
                const toUpload = file.type.startsWith("image/") ? await compressImage(file) : file;
                attachment = await uploadQuoteAttachment(rfq.id, toUpload);
            }
            const itemPrices: QuoteItemPrice[] | undefined = detail
                ? rfq.items.map((it) => {
                    const up = Number(unitPrices[it.id]) || 0;
                    return { itemId: it.id, name: it.name, quantity: it.quantity, unitPrice: up, total: up * it.quantity };
                })
                : undefined;

            const payload = {
                supplierId,
                supplierName,
                totalPrice: effectiveTotal,
                deliveryDays: Number(deliveryDays),
                warranty: warranty.trim(),
                commercialConditions: conditions.trim(),
                validityDate: validityDate || undefined,
                itemPrices,
                notes: notes.trim() || undefined,
                ...(attachment
                    ? { attachmentUrl: attachment.url, attachmentPath: attachment.path, attachmentName: attachment.name }
                    : existing
                        ? { attachmentUrl: existing.attachmentUrl, attachmentPath: existing.attachmentPath, attachmentName: existing.attachmentName }
                        : {}),
            };

            if (existing) await updateQuoteResponse(rfq.id, existing.id, payload);
            else await addQuoteResponse(rfq.id, payload);
            toast({ title: "Cotización guardada" });
            onDone();
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error", description: e?.message || "No se pudo guardar." });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-xl border bg-muted/30 p-4 space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {!detail && (
                    <div className="space-y-1.5">
                        <Label>Precio total (CLP) *</Label>
                        <Input type="number" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} placeholder="0" />
                    </div>
                )}
                <div className="space-y-1.5">
                    <Label>Plazo de entrega (días) *</Label>
                    <Input type="number" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} placeholder="Ej: 15" />
                </div>
                <div className="space-y-1.5">
                    <Label>Validez de la oferta</Label>
                    <Input type="date" value={validityDate} onChange={(e) => setValidityDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                    <Label>Garantía *</Label>
                    <Input value={warranty} onChange={(e) => setWarranty(e.target.value)} placeholder="Ej: 12 meses" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                    <Label>Condiciones comerciales *</Label>
                    <Input value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Ej: 30 días, pago contra entrega" />
                </div>
            </div>

            {/* Detalle por ítem (opcional) */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={detail} onCheckedChange={(v) => setDetail(!!v)} />
                Detallar precio por ítem
            </label>
            {detail && (
                <div className="border rounded-xl divide-y bg-background">
                    {rfq.items.map((it) => (
                        <div key={it.id} className="flex items-center gap-3 p-2.5">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{it.name}</p>
                                <p className="text-xs text-muted-foreground">{it.quantity} {it.unit}</p>
                            </div>
                            <Input
                                type="number"
                                className="w-32"
                                placeholder="P. unit."
                                value={unitPrices[it.id] || ""}
                                onChange={(e) => setUnitPrices((m) => ({ ...m, [it.id]: e.target.value }))}
                            />
                            <span className="w-28 text-right text-sm font-medium">
                                {CLP.format((Number(unitPrices[it.id]) || 0) * it.quantity)}
                            </span>
                        </div>
                    ))}
                    <div className="flex items-center justify-between p-3 font-bold">
                        <span>Total</span><span>{CLP.format(detailTotal)}</span>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Adjunto del proveedor</Label>
                    <Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                    {existing?.attachmentName && !file && <p className="text-xs text-muted-foreground">Actual: {existing.attachmentName}</p>}
                </div>
                <div className="space-y-1.5">
                    <Label>Notas</Label>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones de la oferta" />
                </div>
            </div>

            <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={onDone}>Cancelar</Button>
                <Button size="sm" onClick={save} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />} Guardar cotización
                </Button>
            </div>
        </div>
    );
}
