
"use client";

import React, { useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  FileText,
  Inbox,
  PackagePlus,
  ShoppingCart,
  Truck,
  Download,
  Trash2,
  CalendarIcon,
  CheckCircle,
  Loader2,
  AlertCircle,
  Mail,
  Send, Receipt
} from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/modules/core/lib/supabase';
import type { PurchaseOrder as PurchaseOrderType, Supplier, PurchaseRequest } from '@/modules/core/lib/data';
import { DataTable, type DataTableColumn } from '@/components/data-table';

type OrderItem = { name: string; unit: string; totalQuantity: number };

// Fuera del componente: no dependen de nada del render.
const orderItemColumns: DataTableColumn<OrderItem>[] = [
    { key: 'name', header: 'Material', className: 'font-medium', cell: (i) => i.name },
    { key: 'unit', header: 'Unidad', cell: (i) => i.unit },
    {
        key: 'qty', header: 'Cantidad Total', headerClassName: 'text-right', className: 'text-right font-mono',
        cell: (i) => i.totalQuantity.toLocaleString(),
    },
];
import { generatePurchaseOrderPDF } from '@/lib/pdf-generator';
import { ProposalSubmitDialog } from '@/components/approvals/proposal-submit-dialog';
import { DirectPurchaseDialog } from '@/components/approvals/direct-purchase-dialog';
import { ProposalStatusPanel } from '@/components/approvals/proposal-status-panel';
import { proposalsForSource, currentProposal } from '@/components/approvals/proposal-utils';
import type { PurchaseProposalInput } from '@/modules/data/mutations/approvalMutations';
import { useLots } from '@/hooks/use-lots';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

// Carga diferida del calendario para optimizar el bundle inicial
const Calendar = dynamic(() => import('@/components/ui/calendar').then(mod => mod.Calendar), { ssr: false });

// Definición explícita del tipo Lot para evitar errores de inferencia
interface Lot {
    lotId: string;
    category: string;
    requests: PurchaseRequest[];
    totalQuantity: number;
}


// --- Componente de Tarjeta de Lote ---

interface GenerateOrderCardProps {
    lot: Lot;
}

const GenerateOrderCard: React.FC<GenerateOrderCardProps> = ({ lot }) => {
    const { suppliers, materials, generatePurchaseOrder, approvalProposals, approvalSignatures, purchaseOrders } = useAppState();
    const [draft, setDraft] = useState<(PurchaseProposalInput & { title?: string }) | null>(null);
    // RFC-006 F2: la propuesta (firma por monto) de este lote.
    const views = useMemo(
        () => proposalsForSource(approvalProposals, approvalSignatures, purchaseOrders, p => p.sourceType === 'lot' && p.sourceId === lot.lotId),
        [approvalProposals, approvalSignatures, purchaseOrders, lot.lotId],
    );
    const current = currentProposal(views);
    const lastRejected = !current && views[0]?.state === 'rejected' ? views[0] : null;
    const [selectedSupplier, setSelectedSupplier] = useState<string>('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [directOpen, setDirectOpen] = useState(false);
    // Valorización (F0): toda OC nace con precios reales. Se precargan desde el
    // catálogo (materials.unitCost, calce por nombre) y el usuario los confirma.
    const [pricingOpen, setPricingOpen] = useState(false);
    const [prices, setPrices] = useState<Record<string, string>>({});
    const { toast } = useToast();

    const openPricing = () => {
        if (!selectedSupplier) {
            toast({ variant: 'destructive', title: 'Proveedor requerido', description: 'Por favor, selecciona un proveedor para continuar.' });
            return;
        }
        if (lot.requests.length === 0) {
            toast({ variant: 'destructive', title: 'Lote vacío', description: 'Este lote no tiene solicitudes para generar una orden.' });
            return;
        }
        const byName = new Map<string, number>();
        for (const m of materials || []) {
            const key = (m.name || '').trim().toLowerCase();
            if (key && m.unitCost && !byName.has(key)) byName.set(key, m.unitCost);
        }
        const initial: Record<string, string> = {};
        for (const req of lot.requests) {
            const catalog = byName.get((req.materialName || '').trim().toLowerCase());
            initial[req.id] = catalog ? String(catalog) : '';
        }
        setPrices(initial);
        setPricingOpen(true);
    };

    const totalEstimate = lot.requests.reduce((acc, req) => acc + (parseFloat(prices[req.id]) || 0) * (req.quantity || 0), 0);
    const allPriced = lot.requests.every((req) => (parseFloat(prices[req.id]) || 0) > 0);

    // RFC-006 F2: con los precios confirmados se arma la propuesta y se envía a
    // firma. La OC se emite después, con los precios firmados.
    const handleSendToSign = () => {
        const supplier = suppliers.find((s: Supplier) => s.id === selectedSupplier);
        setPricingOpen(false);
        setDraft({
            title: `Lote ${lot.category}`,
            sourceType: 'lot',
            sourceId: lot.lotId,
            requestIds: lot.requests.map(r => r.id),
            supplierId: selectedSupplier,
            supplierName: supplier?.name || null,
            items: lot.requests.map(r => ({
                requestId: r.id,
                name: r.materialName,
                unit: r.unit,
                quantity: r.quantity,
                unitPrice: parseFloat(prices[r.id]) || 0,
            })),
            netTotal: totalEstimate,
        });
    };

    const handleEmit = async () => {
        if (!current) return;
        setIsGenerating(true);
        try {
            await generatePurchaseOrder(lot.requests, current.proposal.supplierId || '', {}, current.proposal.id);
            toast({ title: 'OC emitida', description: `Orden de Compra de ${lot.category} por lo firmado.` });
            setSelectedSupplier('');
        } finally {
            setIsGenerating(false);
        }
    };


    const totalRequests = lot.requests.length;
    const totalQuantity = lot.requests.reduce((acc, curr) => acc + (curr.quantity || 0), 0);

    return (
        <Card className="bg-card flex flex-col h-full border-l-4 border-l-primary/40">
            <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-base capitalize">
                            <PackagePlus className="h-5 w-5 text-primary"/>
                            {lot.category}
                        </CardTitle>
                        <CardDescription className="mt-1">
                            {totalRequests} {totalRequests === 1 ? 'solicitud' : 'solicitudes'} • {totalQuantity.toLocaleString()} unidades
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4 flex-grow flex flex-col justify-end pt-0">
                {current ? (
                    <ProposalStatusPanel view={current} onEmit={handleEmit} />
                ) : (<>
                {lastRejected && (
                    <p className="text-xs text-destructive">
                        {lastRejected.proposal.internalCode} fue rechazada
                        {lastRejected.signatures.find(s => s.decision === 'rejected')?.note ? `: "${lastRejected.signatures.find(s => s.decision === 'rejected')!.note}"` : ''}.
                    </p>
                )}
                <div className="space-y-2 mt-4">
                    <Select onValueChange={setSelectedSupplier} value={selectedSupplier}>
                        <SelectTrigger>
                            <SelectValue placeholder="Seleccionar Proveedor" />
                        </SelectTrigger>
                        <SelectContent>
                            {suppliers.length > 0 ? (
                                suppliers.map((s: Supplier) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)
                            ) : (
                                <div className="text-center text-sm text-muted-foreground p-4 flex flex-col items-center gap-2">
                                    <AlertCircle className="h-4 w-4" />
                                    No hay proveedores
                                </div>
                            )}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex gap-2">
                     <Button
                        className="w-full"
                        onClick={openPricing}
                        disabled={!selectedSupplier || totalRequests === 0 || isGenerating}
                    >
                        {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileText className="mr-2 h-4 w-4"/>}
                        Valorizar y enviar a firma
                    </Button>

                    {/* Diálogo de valorización: la OC no puede nacer sin precios */}
                    <Dialog open={pricingOpen} onOpenChange={setPricingOpen}>
                        <DialogContent className="sm:max-w-lg">
                            <DialogHeader>
                                <DialogTitle>Valorizar cotización · {lot.category}</DialogTitle>
                                <DialogDescription>
                                    Precios unitarios netos precargados desde el catálogo. Confírmalos o ajústalos —
                                    el documento compromete este presupuesto y la recepción actualizará el catálogo con el precio real.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="max-h-[50vh] overflow-y-auto space-y-3 py-2">
                                {lot.requests.map((req) => (
                                    <div key={req.id} className="flex items-center gap-3">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{req.materialName}</p>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                                {req.quantity} {req.unit}{req.contractName ? ` · ${req.contractName}` : ''}
                                            </p>
                                        </div>
                                        <div className="w-36 shrink-0">
                                            <Input
                                                type="number"
                                                min="0"
                                                placeholder="Precio unit."
                                                value={prices[req.id] ?? ''}
                                                onChange={(e) => setPrices((prev) => ({ ...prev, [req.id]: e.target.value }))}
                                                className="text-right font-mono rounded-xl"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center justify-between border-t pt-3">
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total neto estimado</span>
                                <span className="text-lg font-bold font-mono">
                                    {new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(totalEstimate)}
                                </span>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setPricingOpen(false)}>Cancelar</Button>
                                <Button onClick={handleSendToSign} disabled={!allPriced || isGenerating}>
                                    <FileText className="mr-2 h-4 w-4"/>
                                    Continuar
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                </div>
                {/* RFC-006 F3: compra que ya se hizo por fuera — con su factura o boleta. */}
                <button
                    type="button"
                    onClick={() => setDirectOpen(true)}
                    disabled={totalRequests === 0}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 self-start disabled:opacity-50"
                >
                    <Receipt className="h-3.5 w-3.5" /> Compra ya realizada (con factura o boleta)
                </button>
                <DirectPurchaseDialog
                    open={directOpen}
                    onClose={() => setDirectOpen(false)}
                    lotId={lot.lotId}
                    title={`Lote ${lot.category}`}
                    requests={lot.requests}
                />
                </>)}
                <ProposalSubmitDialog draft={draft} onClose={() => setDraft(null)} />
            </CardContent>
        </Card>
    );
};

// --- Componente Principal ---

export default function OrdersPage() {
    const { purchaseOrders, suppliers, users, cancelPurchaseOrder, currentTenant } = useAppState();
    const { user } = useAuth();
    const { batchedLots } = useLots();
    const { toast } = useToast();
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
    const [cancelingId, setCancelingId] = useState<string | null>(null);

    const supplierMap = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);

    // Envío de la cotización por correo al proveedor.
    const [emailingOrder, setEmailingOrder] = useState<{ order: PurchaseOrderType; index: number } | null>(null);
    const [emailTo, setEmailTo] = useState('');
    const [emailMessage, setEmailMessage] = useState('');
    const [sendingEmail, setSendingEmail] = useState(false);

    const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
    
    const getDate = useCallback((date: Date | string) => {
        return new Date(date as any);
    }, []);
    
    const filteredPurchaseOrders = useMemo(() => {
        if (!purchaseOrders) return [];
        return purchaseOrders.filter((order: PurchaseOrderType) => {
            if (order.status !== 'generated') return false; // Solo cotizaciones
            if (!selectedDate) return true;
            const orderDate = getDate(order.createdAt);
            return isSameDay(orderDate, selectedDate);
        }).sort((a: PurchaseOrderType, b: PurchaseOrderType) => 
            getDate(b.createdAt).getTime() - getDate(a.createdAt).getTime()
        );
    }, [purchaseOrders, selectedDate, getDate]);


    const handleDownloadPDF = async (order: PurchaseOrderType, index: number) => {
        const supplier = supplierMap.get(order.supplierId);
        if(!supplier) {
             toast({ variant: "destructive", title: "Error", description: "No se encontró la información del proveedor." });
             return;
        }

        try {
            const { blob, filename } = await generatePurchaseOrderPDF(order, supplier, index + 1, currentTenant?.logoUrl);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error(error);
            toast({ variant: "destructive", title: "Error al generar PDF", description: "Ocurrió un problema al crear el documento." });
        }
    };

    const openEmail = (order: PurchaseOrderType, index: number) => {
        const supplier = supplierMap.get(order.supplierId);
        setEmailTo(supplier?.email || '');
        setEmailMessage('');
        setEmailingOrder({ order, index });
    };

    const handleSendEmail = async () => {
        if (!emailingOrder) return;
        const { order, index } = emailingOrder;
        const supplier = supplierMap.get(order.supplierId);
        if (!supplier) { toast({ variant: 'destructive', title: 'Error', description: 'No se encontró el proveedor.' }); return; }
        if (!emailTo.trim()) { toast({ variant: 'destructive', title: 'Falta el correo', description: 'Indica al menos un destinatario.' }); return; }
        setSendingEmail(true);
        try {
            const code = `COT-${String(index + 1).padStart(3, '0')}`;
            const { blob, filename } = await generatePurchaseOrderPDF(order, supplier, index + 1, currentTenant?.logoUrl);
            const pdfBase64 = await blobToBase64(blob);
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!token) throw new Error('Sesión no disponible.');
            const res = await fetch('/api/purchasing/send-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    to: emailTo.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
                    subject: `Solicitud de cotización ${code} · ${supplier.name}`,
                    message: emailMessage.trim() || undefined,
                    pdfBase64,
                    filename,
                    orderCode: code,
                    docLabel: 'Solicitud de cotización',
                    companyName: currentTenant?.name,
                    companyLogoUrl: currentTenant?.logoUrl,
                    senderName: user?.name,
                    senderEmail: user?.email,
                    senderPhone: user?.phone,
                    senderRole: user?.cargo,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            toast({ title: 'Cotización enviada', description: `Se envió a ${emailTo}.` });
            setEmailingOrder(null);
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo enviar', description: e?.message || 'Error desconocido.' });
        } finally {
            setSendingEmail(false);
        }
    };

    const handleCancelOrder = async (orderId: string) => {
        setCancelingId(orderId);
        try {
            await cancelPurchaseOrder(orderId);
            toast({ title: 'Orden Anulada', description: `La orden ${orderId.slice(0, 8)}... fue cancelada.` });
        } catch (error: any) {
            const errorMessage = error?.message || "Error desconocido";
            toast({ variant: 'destructive', title: 'Error', description: errorMessage || 'No se pudo anular la orden.' });
        } finally {
            setCancelingId(null);
        }
    };



    return (
        <div className="flex flex-col gap-8 fade-in pb-10">
            <PageHeader
                title="Órdenes de Compra"
                description="Valoriza cada lote, envíalo a firma según el monto y emite la OC cuando esté firmada."
            />

            <Card className="border-none shadow-none bg-transparent p-0">
                <div className="mb-4">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <ShoppingCart className="h-5 w-5 text-primary" /> 
                        Lotes Listos para Cotización
                    </h2>
                    <p className="text-muted-foreground text-sm">
                        Asigna un proveedor a estos lotes para generar el documento PDF.
                    </p>
                </div>
                
                <CardContent className="p-0">
                    {batchedLots.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {batchedLots.map(lot => (
                                <GenerateOrderCard key={lot.lotId} lot={lot} />
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            icon={<Inbox size={24} />}
                            title="Todo al día"
                            description="No hay solicitudes pendientes agrupadas en lotes."
                        />
                    )}
                </CardContent>
            </Card>

             <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                        <div>
                            <CardTitle className="flex items-center gap-2"><Truck /> Historial de Cotizaciones Generadas</CardTitle>
                            <CardDescription>Aquí puedes ver todas las solicitudes de cotización que has generado.</CardDescription>
                        </div>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant={"outline"} className={cn("w-full sm:w-[280px] justify-start text-left font-normal", !selectedDate && "text-muted-foreground")}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {selectedDate ? format(selectedDate, "PPP", {locale: es}) : <span>Selecciona una fecha</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <Calendar mode="single" selected={selectedDate} onSelect={setSelectedDate} initialFocus />
                            </PopoverContent>
                        </Popover>
                    </div>
                </CardHeader>
                <CardContent>
                    <Accordion type="multiple" className="w-full space-y-4">
                        {filteredPurchaseOrders.length > 0 ? filteredPurchaseOrders.map((order, index) => (
                            <AccordionItem value={order.id} key={order.id} className="border rounded-lg bg-card">
                                 <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full p-4">
                                    <AccordionTrigger className="w-full p-0 hover:no-underline text-left flex-grow">
                                        <div>
                                            <h3 className="font-semibold text-base">COT-{String(index + 1).padStart(3, '0')}</h3>
                                            <p className="text-sm text-muted-foreground">
                                                Proveedor: <span className="font-medium text-primary">{order.supplierName}</span>
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Generada el: {getDate(order.createdAt).toLocaleDateString('es-CL')}
                                            </p>
                                        </div>
                                    </AccordionTrigger>
                                    <div className="flex gap-2 mt-4 sm:mt-0 sm:ml-4 flex-shrink-0">
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="outline" size="icon" className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground" disabled={cancelingId === order.id}>
                                                    {cancelingId === order.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4"/>}
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>¿Anular Solicitud de Cotización?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Esta acción eliminará la solicitud y devolverá todos sus ítems a su estado anterior. ¿Estás seguro?
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleCancelOrder(order.id)} className="bg-destructive hover:bg-destructive/90">
                                                        Sí, anular solicitud
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                        <Button variant="outline" onClick={(e) => { e.stopPropagation(); openEmail(order, index); }}>
                                            <Mail className="mr-2 h-4 w-4"/> Enviar
                                        </Button>
                                        <Button onClick={(e) => { e.stopPropagation(); handleDownloadPDF(order, index); }}>
                                            <Download className="mr-2 h-4 w-4"/> PDF
                                        </Button>
                                    </div>
                                </div>
                                <AccordionContent className="p-6 pt-0">
                                    <DataTable
                                        data={order.items}
                                        rowKey={(_item, idx) => `${order.id}-${idx}`}
                                        columns={orderItemColumns}
                                        empty={{ title: 'Esta cotización no tiene ítems.' }}
                                    />
                                </AccordionContent>
                            </AccordionItem>
                        )) : (
                            <EmptyState
                                icon={<Inbox size={24} />}
                                title="Sin Cotizaciones"
                                description="No se han generado cotizaciones para la fecha seleccionada."
                            />
                        )}
                    </Accordion>
                </CardContent>
            </Card>

            {/* Enviar cotización por correo al proveedor */}
            <Dialog open={!!emailingOrder} onOpenChange={(o) => { if (!o) setEmailingOrder(null); }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Enviar cotización por correo</DialogTitle>
                        <DialogDescription>
                            Se adjunta el PDF y se envía directamente al proveedor
                            {emailingOrder ? <> <span className="font-medium">{supplierMap.get(emailingOrder.order.supplierId)?.name}</span></> : ''}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label>Para (correo del proveedor)</Label>
                            <Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="proveedor@correo.cl (separa varios con coma)" />
                            {emailingOrder && !supplierMap.get(emailingOrder.order.supplierId)?.email && (
                                <p className="text-xs text-warning-subtle-foreground">Este proveedor no tiene correo guardado; escríbelo aquí (o agrégalo en Proveedores).</p>
                            )}
                        </div>
                        <div className="space-y-1.5">
                            <Label>Mensaje (opcional)</Label>
                            <Textarea value={emailMessage} onChange={(e) => setEmailMessage(e.target.value)} rows={3}
                                placeholder="Estimado proveedor, adjuntamos nuestra solicitud de cotización…" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setEmailingOrder(null)}>Cancelar</Button>
                        <Button onClick={handleSendEmail} disabled={sendingEmail || !emailTo.trim()}>
                            {sendingEmail ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />} Enviar al proveedor
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
