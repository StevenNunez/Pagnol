
"use client";

import React, { useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { PageHeader } from '@/components/page-header';
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
  AlertCircle
} from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';
import type { PurchaseOrder as PurchaseOrderType, Supplier, PurchaseRequest } from '@/modules/core/lib/data';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { generatePurchaseOrderPDF } from '@/lib/pdf-generator';
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
    onArchive: (lot: Lot) => Promise<void>;
}

const GenerateOrderCard: React.FC<GenerateOrderCardProps> = ({ lot, onArchive }) => {
    const { suppliers, generatePurchaseOrder } = useAppState();
    const [selectedSupplier, setSelectedSupplier] = useState<string>('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isArchiving, setIsArchiving] = useState(false);
    const { toast } = useToast();

    const handleGenerateOrder = async () => {
        if (!selectedSupplier) {
            toast({ variant: 'destructive', title: 'Proveedor requerido', description: 'Por favor, selecciona un proveedor para continuar.' });
            return;
        }
        if (lot.requests.length === 0) {
            toast({ variant: 'destructive', title: 'Lote vacío', description: 'Este lote no tiene solicitudes para generar una orden.' });
            return;
        }

        setIsGenerating(true);
        try {
            await generatePurchaseOrder(lot.requests, selectedSupplier);
            toast({ title: 'Orden Generada', description: `La cotización para ${lot.category} ha sido creada exitosamente.` });
            setSelectedSupplier('');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
            toast({ variant: 'destructive', title: 'Error', description: errorMessage || 'No se pudo generar la orden.' });
        } finally {
            setIsGenerating(false);
        }
    };
    
    const handleArchiveWrapper = async () => {
        setIsArchiving(true);
        try {
            await onArchive(lot);
        } finally {
            setIsArchiving(false);
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
                        onClick={handleGenerateOrder} 
                        disabled={!selectedSupplier || totalRequests === 0 || isGenerating}
                    >
                        {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileText className="mr-2 h-4 w-4"/>}
                        Generar
                    </Button>
                    
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                             <Button 
                                variant="outline" 
                                className="bg-green-600 hover:bg-green-700 text-white border-green-700 w-12 px-0 shrink-0" 
                                disabled={totalRequests === 0 || isArchiving}
                                title="Finalizar lote manualmente"
                            >
                                {isArchiving ? <Loader2 className="h-4 w-4 animate-spin"/> : <CheckCircle className="h-4 w-4"/>}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>¿Finalizar este Lote?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Esta acción marcará todas las solicitudes de este lote como "ordenadas" sin generar una cotización nueva. 
                                    Úsalo si ya gestionaste estas solicitudes por otro medio.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={handleArchiveWrapper} className="bg-green-600 hover:bg-green-700">
                                    Confirmar Finalización
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </CardContent>
        </Card>
    );
};

// --- Componente Principal ---

export default function OrdersPage() {
    const { purchaseOrders, suppliers, users, cancelPurchaseOrder, archiveLot } = useAppState();
    const { batchedLots } = useLots();
    const { toast } = useToast();
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
    const [cancelingId, setCancelingId] = useState<string | null>(null);

    const supplierMap = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
    
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
            const { blob, filename } = await generatePurchaseOrderPDF(order, supplier, index + 1);
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

    const handleCancelOrder = async (orderId: string) => {
        setCancelingId(orderId);
        try {
            await cancelPurchaseOrder(orderId);
            toast({ title: 'Orden Anulada', description: `La orden ${orderId.slice(0, 8)}... fue cancelada.` });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Error desconocido";
            toast({ variant: 'destructive', title: 'Error', description: errorMessage || 'No se pudo anular la orden.' });
        } finally {
            setCancelingId(null);
        }
    };

    const handleArchiveLot = useCallback(async (lot: Lot) => {
      if (!lot || lot.requests.length === 0) {
        toast({ variant: "destructive", title: "Error", description: "El lote está vacío o no es válido." });
        return;
      }
      const requestIds = lot.requests.map(r => r.id);
      try {
        await archiveLot(requestIds);
        toast({ title: 'Lote Archivado', description: 'Solicitudes marcadas como procesadas correctamente.' });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Error desconocido";
        toast({ variant: "destructive", title: "Error al archivar", description: errorMessage });
        throw error;
      }
    }, [archiveLot, toast]);


    return (
        <div className="flex flex-col gap-8 fade-in pb-10">
            <PageHeader
                title="Generador de Cotizaciones"
                description="Genera, visualiza y gestiona las solicitudes de cotización para los proveedores."
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
                                <GenerateOrderCard key={lot.lotId} lot={lot} onArchive={handleArchiveLot} />
                            ))}
                        </div>
                    ) : (
                        <Card className="border-dashed">
                            <CardContent className="flex flex-col items-center justify-center text-center text-muted-foreground p-12">
                                <Inbox className="h-12 w-12 mb-4 opacity-50"/>
                                <h3 className="text-lg font-medium text-foreground">Todo al día</h3>
                                <p className="text-sm max-w-xs mx-auto">
                                    No hay solicitudes pendientes agrupadas en lotes.
                                </p>
                            </CardContent>
                        </Card>
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
                                        <Button onClick={(e) => { e.stopPropagation(); handleDownloadPDF(order, index); }}>
                                            <Download className="mr-2 h-4 w-4"/> PDF
                                        </Button>
                                    </div>
                                </div>
                                <AccordionContent className="p-6 pt-0">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Material</TableHead>
                                                <TableHead>Unidad</TableHead>
                                                <TableHead className="text-right">Cantidad Total</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {order.items.map((item: { name: string; unit: string; totalQuantity: number; }, idx: number) => (
                                                <TableRow key={`${order.id}-${idx}`}>
                                                    <TableCell className="font-medium">{item.name}</TableCell>
                                                    <TableCell>{item.unit}</TableCell>
                                                    <TableCell className="text-right font-mono">{item.totalQuantity.toLocaleString()} </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </AccordionContent>
                            </AccordionItem>
                        )) : (
                            <div className="flex flex-col items-center justify-center text-center text-muted-foreground p-12">
                                <Inbox className="h-16 w-16 mb-4"/>
                                <h3 className="text-xl font-semibold">Sin Cotizaciones</h3>
                                <p className="mt-2">No se han generado cotizaciones para la fecha seleccionada.</p>
                            </div>
                        )}
                    </Accordion>
                </CardContent>
            </Card>
        </div>
    );
}
