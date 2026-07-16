"use client";

// Facturas de Proveedor (cuentas por pagar). Reconstruida en F0 del Dominio
// Financiero: antes este archivo era un duplicado copy-paste del procesador de
// cotizaciones y NO existía superficie para registrar/pagar facturas (las
// mutaciones addSupplierPayment/markPaymentAsPaid estaban huérfanas).
// Marcar una factura como pagada emite el hecho financiero "pagado"; el vínculo
// opcional con la OC hereda el contrato para el panel Resultado por Contrato.

import React, { useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { SupplierPayment } from "@/modules/core/lib/data";
import { Receipt, Plus, CircleDollarSign, Clock, AlertTriangle, Trash2, CheckCircle2, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const NONE = "__none__";

const STATUS_BADGE: Record<SupplierPayment["status"], { label: string; cls: string }> = {
    pending: { label: "Pendiente", cls: "badge-warning" },
    paid: { label: "Pagada", cls: "badge-success" },
    overdue: { label: "Vencida", cls: "badge-destructive" },
};

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{children}</p>;
}

export default function SupplierInvoicesPage() {
    const {
        supplierPayments, suppliers, purchaseOrders,
        addSupplierPayment, markPaymentAsPaid, deleteSupplierPayment,
    } = useAppState();
    const { toast } = useToast();

    const [createOpen, setCreateOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [payTarget, setPayTarget] = useState<SupplierPayment | null>(null);
    const [payMethod, setPayMethod] = useState("Transferencia");
    const [deleteTarget, setDeleteTarget] = useState<SupplierPayment | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Formulario de nueva factura
    const [supplierId, setSupplierId] = useState("");
    const [invoiceNumber, setInvoiceNumber] = useState("");
    const [amount, setAmount] = useState("");
    const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [dueDate, setDueDate] = useState("");
    const [poId, setPoId] = useState(NONE);

    const supplierMap = useMemo(() => new Map((suppliers || []).map((s) => [s.id, s.name])), [suppliers]);

    // OCs vinculables del proveedor elegido (activas o completadas, no anuladas).
    const linkablePOs = useMemo(() => {
        return (purchaseOrders || [])
            .filter((po) => po.status !== "cancelled")
            .filter((po) => !supplierId || po.supplierId === supplierId)
            .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime());
    }, [purchaseOrders, supplierId]);

    const rows = useMemo(() => {
        const today = new Date().toISOString().slice(0, 10);
        return (supplierPayments || [])
            .map((p) => ({
                ...p,
                // 'pending' con vencimiento pasado se muestra como vencida.
                status: (p.status === "pending" && p.dueDate && new Date(p.dueDate).toISOString().slice(0, 10) < today
                    ? "overdue" : p.status) as SupplierPayment["status"],
            }))
            .sort((a, b) => new Date(b.issueDate as any).getTime() - new Date(a.issueDate as any).getTime());
    }, [supplierPayments]);

    const kpis = useMemo(() => {
        const pending = rows.filter((r) => r.status !== "paid");
        return {
            porPagar: pending.reduce((a, r) => a + (r.amount || 0), 0),
            pendientes: pending.filter((r) => r.status === "pending").length,
            vencidas: pending.filter((r) => r.status === "overdue").length,
            pagadasMes: rows.filter((r) => {
                if (r.status !== "paid" || !r.paymentDate) return false;
                const d = new Date(r.paymentDate);
                const now = new Date();
                return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            }).length,
        };
    }, [rows]);

    const resetForm = () => {
        setSupplierId(""); setInvoiceNumber(""); setAmount("");
        setIssueDate(new Date().toISOString().slice(0, 10)); setDueDate(""); setPoId(NONE);
    };

    const handleCreate = async () => {
        if (!supplierId || !invoiceNumber.trim() || !(parseFloat(amount) > 0) || !dueDate) {
            toast({ variant: "destructive", title: "Faltan datos", description: "Proveedor, N° de factura, monto y vencimiento son obligatorios." });
            return;
        }
        setSaving(true);
        try {
            await addSupplierPayment({
                supplier_id: supplierId,
                invoice_number: invoiceNumber.trim(),
                amount: Math.round(parseFloat(amount)),
                issue_date: issueDate,
                due_date: dueDate,
                purchase_order_id: poId === NONE ? null : poId,
            });
            toast({ title: "Factura registrada", description: `${invoiceNumber.trim()} · ${CLP.format(parseFloat(amount))} (bruto).` });
            setCreateOpen(false);
            resetForm();
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo registrar", description: e?.message || "Error desconocido." });
        } finally {
            setSaving(false);
        }
    };

    const handlePay = async () => {
        if (!payTarget) return;
        setProcessingId(payTarget.id);
        try {
            await markPaymentAsPaid(payTarget.id, { paymentDate: new Date(), paymentMethod: payMethod });
            toast({ title: "Factura pagada", description: `${payTarget.invoiceNumber} quedó registrada como pagada.` });
            setPayTarget(null);
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo marcar el pago", description: e?.message || "Error desconocido." });
        } finally {
            setProcessingId(null);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setProcessingId(deleteTarget.id);
        try {
            await deleteSupplierPayment(deleteTarget.id);
            toast({ title: "Factura eliminada", description: "Sus hechos financieros fueron reversados." });
            setDeleteTarget(null);
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo eliminar", description: e?.message || "Error desconocido." });
        } finally {
            setProcessingId(null);
        }
    };

    return (
        <PageShell
            title="Facturas de Proveedor"
            description="Registra las facturas recibidas, vincúlalas a su OC y marca los pagos. El pago alimenta el Resultado por Contrato."
        >
            {/* KPIs */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                    { icon: CircleDollarSign, label: "Por pagar (bruto)", value: CLP.format(kpis.porPagar), tone: "bg-muted text-foreground" },
                    { icon: Clock, label: "Pendientes", value: String(kpis.pendientes), tone: "bg-info-subtle text-info-subtle-foreground" },
                    { icon: AlertTriangle, label: "Vencidas", value: String(kpis.vencidas), tone: kpis.vencidas > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground" },
                    { icon: CheckCircle2, label: "Pagadas este mes", value: String(kpis.pagadasMes), tone: "bg-success-subtle text-success-subtle-foreground" },
                ].map((k) => (
                    <Card key={k.label} className="rounded-[1.5rem]">
                        <CardContent className="p-5 flex items-center gap-4">
                            <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${k.tone}`}>
                                <k.icon className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <MicroLabel>{k.label}</MicroLabel>
                                <p className="text-xl font-bold truncate">{k.value}</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Toolbar */}
            <div className="flex justify-end">
                <Button
                    onClick={() => setCreateOpen(true)}
                    className="rounded-[1.5rem] shadow-lg shadow-primary/10 hover:scale-105 active:scale-95"
                >
                    <Plus className="mr-2 h-4 w-4" /> Registrar factura
                </Button>
            </div>

            {/* Tabla */}
            <Card className="rounded-[1.5rem]">
                <CardContent className="p-0">
                    {rows.length === 0 ? (
                        <EmptyState
                            icon={<Receipt className="h-6 w-6" />}
                            title="Sin facturas registradas"
                            description="Registra la primera factura de proveedor para empezar a controlar las cuentas por pagar."
                        />
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Factura</TableHead>
                                    <TableHead>Proveedor</TableHead>
                                    <TableHead>OC</TableHead>
                                    <TableHead className="text-right">Monto (bruto)</TableHead>
                                    <TableHead>Vencimiento</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((p) => (
                                    <TableRow key={p.id} className={p.status === "paid" ? "text-muted-foreground" : undefined}>
                                        <TableCell className="font-medium font-mono">{p.invoiceNumber}</TableCell>
                                        <TableCell>{supplierMap.get(p.supplierId) || "—"}</TableCell>
                                        <TableCell className="font-mono text-xs">{p.purchaseOrderId || p.purchaseOrderNumber || "—"}</TableCell>
                                        <TableCell className="text-right font-mono font-bold">{CLP.format(p.amount || 0)}</TableCell>
                                        <TableCell>{p.dueDate ? format(new Date(p.dueDate), "dd MMM yyyy", { locale: es }) : "—"}</TableCell>
                                        <TableCell>
                                            <Badge className={STATUS_BADGE[p.status].cls}>{STATUS_BADGE[p.status].label}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right space-x-2">
                                            {processingId === p.id ? (
                                                <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                                            ) : (
                                                <>
                                                    {p.status !== "paid" && (
                                                        <Button size="sm" variant="outline" className="rounded-xl" onClick={() => { setPayMethod("Transferencia"); setPayTarget(p); }}>
                                                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Pagar
                                                        </Button>
                                                    )}
                                                    <Button size="sm" variant="ghost" className="rounded-xl text-destructive hover:text-destructive" onClick={() => setDeleteTarget(p)}>
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Diálogo: nueva factura */}
            <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Registrar factura de proveedor</DialogTitle>
                        <DialogDescription>
                            El monto es el TOTAL de la factura (bruto, IVA incluido). Vincular la OC permite imputar el pago al contrato correcto.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-2 gap-4 py-2">
                        <div className="col-span-2 space-y-1.5">
                            <Label>Proveedor *</Label>
                            <Select value={supplierId} onValueChange={(v) => { setSupplierId(v); setPoId(NONE); }}>
                                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Seleccionar proveedor" /></SelectTrigger>
                                <SelectContent>
                                    {(suppliers || []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>N° de factura *</Label>
                            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="F-001234" className="rounded-xl font-mono" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Monto bruto (CLP) *</Label>
                            <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="rounded-xl font-mono text-right" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Fecha de emisión</Label>
                            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="rounded-xl" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Vencimiento *</Label>
                            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="rounded-xl" />
                        </div>
                        <div className="col-span-2 space-y-1.5">
                            <Label>Orden de Compra (opcional)</Label>
                            <Select value={poId} onValueChange={setPoId}>
                                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NONE}>Sin OC vinculada</SelectItem>
                                    {linkablePOs.map((po) => (
                                        <SelectItem key={po.id} value={po.id}>
                                            {(po.officialOCId || po.id)} · {po.supplierName}{po.totalAmount ? ` · ${CLP.format(po.totalAmount)}` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                        <Button onClick={handleCreate} disabled={saving}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                            Registrar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Diálogo: marcar pagada */}
            <Dialog open={!!payTarget} onOpenChange={(o) => { if (!o) setPayTarget(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Marcar como pagada</DialogTitle>
                        <DialogDescription>
                            {payTarget && <>Factura <span className="font-mono font-bold">{payTarget.invoiceNumber}</span> por {CLP.format(payTarget.amount || 0)} (bruto). Se emitirá el hecho financiero de pago.</>}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5 py-2">
                        <Label>Método de pago</Label>
                        <Select value={payMethod} onValueChange={setPayMethod}>
                            <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {["Transferencia", "Cheque", "Efectivo", "Vale vista", "Otro"].map((m) => (
                                    <SelectItem key={m} value={m}>{m}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPayTarget(null)}>Cancelar</Button>
                        <Button onClick={handlePay} disabled={!!processingId}>
                            {processingId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                            Confirmar pago
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Confirmación de borrado */}
            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar esta factura?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteTarget && <>Se eliminará la factura <span className="font-mono font-bold">{deleteTarget.invoiceNumber}</span>. Si estaba pagada, sus hechos financieros se reversarán (no se borran — se emite el espejo contable).</>}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Eliminar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </PageShell>
    );
}
