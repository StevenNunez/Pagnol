"use client";

import React, { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ThumbsUp, ThumbsDown, CheckCircle, XCircle, Clock, Banknote } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { SalaryAdvance } from "@/modules/core/lib/data";

const MEDIOS_DE_PAGO = ['Transferencia', 'Efectivo', 'Cheque', 'Otro'];

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(value);
};

const getStatusBadge = (status: SalaryAdvance['status']) => {
    switch (status) {
        case 'pending':
            return <Badge className="badge-warning"><Clock className="mr-1 h-3 w-3" /> Pendiente</Badge>;
        case 'approved':
            return <Badge className="bg-info-subtle text-info-subtle-foreground"><CheckCircle className="mr-1 h-3 w-3" /> Aprobada</Badge>;
        case 'paid':
            return <Badge className="bg-success-subtle text-success-subtle-foreground"><Banknote className="mr-1 h-3 w-3" /> Pagada</Badge>;
        case 'rejected':
            return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" /> Rechazada</Badge>;
        default:
            return <Badge variant="outline">{status}</Badge>;
    }
};

export default function SalaryAdvancesPage() {
    const { salaryAdvances, approveSalaryAdvance, rejectSalaryAdvance, markSalaryAdvancePaid } = useAppState();
    const { toast } = useToast();
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [rechazando, setRechazando] = useState<SalaryAdvance | null>(null);
    const [motivo, setMotivo] = useState('');
    const [pagando, setPagando] = useState<SalaryAdvance | null>(null);
    const [fechaPago, setFechaPago] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [medioPago, setMedioPago] = useState(MEDIOS_DE_PAGO[0]);

    const { pending, approved, processed } = useMemo(() => {
        const pendingRequests: SalaryAdvance[] = [];
        const approvedRequests: SalaryAdvance[] = [];
        const processedRequests: SalaryAdvance[] = [];

        (salaryAdvances || []).forEach(req => {
            if (req.status === 'pending') pendingRequests.push(req);
            // Aprobada ≠ transferida: sigue siendo trabajo por hacer hasta que
            // alguien registre el pago, así que tiene su propia bandeja.
            else if (req.status === 'approved') approvedRequests.push(req);
            else processedRequests.push(req);
        });

        // Ordenar: pendientes por fecha más antigua, procesados por fecha más reciente
        pendingRequests.sort((a, b) => (a.requestedAt as any) - (b.requestedAt as any));
        approvedRequests.sort((a, b) => (a.processedAt as any) - (b.processedAt as any));
        processedRequests.sort((a, b) => (b.processedAt as any) - (a.processedAt as any));

        return { pending: pendingRequests, approved: approvedRequests, processed: processedRequests };
    }, [salaryAdvances]);

    const handleAction = async (id: string, action: 'approve' | 'reject') => {
        setProcessingId(id);
        try {
            if (action === 'approve') {
                await approveSalaryAdvance(id);
                toast({ title: 'Adelanto Aprobado', description: 'Queda pendiente de transferencia.' });
            } else {
                await rejectSalaryAdvance(id, motivo.trim());
                toast({ title: 'Adelanto Rechazado', description: 'El trabajador verá el motivo.', variant: 'destructive' });
            }
            setRechazando(null);
            setMotivo('');
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        } finally {
            setProcessingId(null);
        }
    };

    const registrarPago = async () => {
        if (!pagando) return;
        setProcessingId(pagando.id);
        try {
            await markSalaryAdvancePaid(pagando.id, { paymentDate: fechaPago, paymentMethod: medioPago });
            toast({ title: 'Pago registrado', description: `Transferencia del ${fechaPago} guardada.` });
            setPagando(null);
        } catch (e: any) {
            toast({ title: 'No se pudo registrar el pago', description: e.message, variant: 'destructive' });
        } finally {
            setProcessingId(null);
        }
    };

    const pendingColumns: DataTableColumn<SalaryAdvance>[] = [
        { key: 'worker', header: 'Trabajador', className: 'font-medium', cell: (req) => req.workerName },
        { key: 'amount', header: 'Monto Solicitado', className: 'font-mono text-lg font-bold', cell: (req) => formatCurrency(req.amount) },
        {
            key: 'requested', header: 'Fecha Solicitud',
            cell: (req) => formatDistanceToNow(new Date(req.requestedAt), { addSuffix: true, locale: es }),
        },
        {
            key: 'actions', header: 'Acciones', headerClassName: 'text-right', className: 'text-right space-x-2',
            cell: (req) => processingId === req.id ? <Loader2 className="animate-spin h-5 w-5 ml-auto" /> : (
                <>
                    <Button size="sm" variant="destructive" onClick={() => { setRechazando(req); setMotivo(''); }}>
                        <ThumbsDown className="mr-2 h-4 w-4" /> Rechazar
                    </Button>
                    <Button size="sm" onClick={() => handleAction(req.id, 'approve')}>
                        <ThumbsUp className="mr-2 h-4 w-4" /> Aprobar
                    </Button>
                </>
            ),
        },
    ];

    const approvedColumns: DataTableColumn<SalaryAdvance>[] = [
        { key: 'worker', header: 'Trabajador', className: 'font-medium', cell: (req) => req.workerName },
        { key: 'amount', header: 'Monto', className: 'font-mono text-lg font-bold', cell: (req) => formatCurrency(req.amount) },
        {
            key: 'approved', header: 'Aprobado',
            cell: (req) => (
                <>
                    {req.processedAt ? formatDistanceToNow(new Date(req.processedAt), { addSuffix: true, locale: es }) : '—'}
                    {req.approverName && <span className="block text-xs text-muted-foreground">por {req.approverName}</span>}
                </>
            ),
        },
        {
            key: 'actions', header: 'Acciones', headerClassName: 'text-right', className: 'text-right',
            cell: (req) => processingId === req.id ? <Loader2 className="animate-spin h-5 w-5 ml-auto" /> : (
                <Button size="sm" onClick={() => { setPagando(req); setFechaPago(format(new Date(), 'yyyy-MM-dd')); setMedioPago(MEDIOS_DE_PAGO[0]); }}>
                    <Banknote className="mr-2 h-4 w-4" /> Registrar pago
                </Button>
            ),
        },
    ];

    const processedColumns: DataTableColumn<SalaryAdvance>[] = [
        { key: 'worker', header: 'Trabajador', cell: (req) => req.workerName },
        { key: 'amount', header: 'Monto', className: 'font-mono', cell: (req) => formatCurrency(req.amount) },
        {
            key: 'processed', header: 'Fecha Procesado',
            cell: (req) => req.processedAt ? formatDistanceToNow(new Date(req.processedAt), { addSuffix: true, locale: es }) : 'N/A',
        },
        {
            key: 'status', header: 'Estado',
            cell: (req) => (
                <>
                    {getStatusBadge(req.status)}
                    {req.status === 'paid' && req.paymentDate && (
                        <span className="block text-xs mt-1">
                            {req.paymentDate}{req.paymentMethod ? ` · ${req.paymentMethod}` : ''}
                        </span>
                    )}
                    {req.status === 'rejected' && req.rejectionReason && (
                        <span className="block text-xs mt-1 italic">{req.rejectionReason}</span>
                    )}
                </>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-8">
            <PageHeader title="Gestión de Adelantos de Sueldo" description="Aprueba o rechaza las solicitudes de adelanto de los trabajadores." />

            <Card>
                <CardHeader>
                    <CardTitle>Solicitudes Pendientes de Aprobación</CardTitle>
                    <CardDescription>Revisa y procesa las solicitudes de adelanto de sueldo.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <DataTable
                        data={pending}
                        rowKey={(req) => req.id}
                        columns={pendingColumns}
                        className="border-0 rounded-none"
                        empty={{ icon: <Clock className="h-6 w-6" />, title: 'No hay solicitudes pendientes.' }}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Aprobados pendientes de transferir</CardTitle>
                    <CardDescription>
                        Ya autorizados. Mientras no se registre el pago, el trabajador no tiene
                        respaldo de la transferencia y la obligación sigue proyectada en el flujo de caja.
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <DataTable
                        data={approved}
                        rowKey={(req) => req.id}
                        columns={approvedColumns}
                        className="border-0 rounded-none"
                        empty={{ icon: <Banknote className="h-6 w-6" />, title: 'No hay adelantos pendientes de transferir.' }}
                    />
                </CardContent>
            </Card>

             <Card>
                <CardHeader>
                    <CardTitle>Historial de Solicitudes Procesadas</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <DataTable
                        data={processed}
                        rowKey={(req) => req.id}
                        columns={processedColumns}
                        className="border-0 rounded-none"
                        rowClassName={() => 'text-muted-foreground'}
                        empty={{ icon: <CheckCircle className="h-6 w-6" />, title: 'No hay solicitudes procesadas.' }}
                    />
                </CardContent>
             </Card>

            {/* Rechazo con motivo. La columna `rejection_reason` existía desde la
                reparación del drift #6 y la UI nunca la llenaba: el trabajador
                veía "Rechazado" sin saber por qué. */}
            <Dialog open={!!rechazando} onOpenChange={(o) => { if (!o) { setRechazando(null); setMotivo(''); } }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Rechazar adelanto</DialogTitle>
                        <DialogDescription>
                            {rechazando ? `${rechazando.workerName} · ${formatCurrency(rechazando.amount)}` : ''}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="motivo">Motivo (lo verá el trabajador)</Label>
                        <Textarea
                            id="motivo"
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            placeholder="Ej.: ya tienes un adelanto vigente este mes."
                            rows={3}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setRechazando(null); setMotivo(''); }}>Cancelar</Button>
                        <Button
                            variant="destructive"
                            disabled={!motivo.trim() || !!processingId}
                            onClick={() => rechazando && handleAction(rechazando.id, 'reject')}
                        >
                            {processingId ? <Loader2 className="animate-spin h-4 w-4" /> : 'Rechazar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Registro del pago: mismo respaldo que una factura a proveedor. */}
            <Dialog open={!!pagando} onOpenChange={(o) => { if (!o) setPagando(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Registrar pago del adelanto</DialogTitle>
                        <DialogDescription>
                            {pagando ? `${pagando.workerName} · ${formatCurrency(pagando.amount)}` : ''}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="fecha-pago">Fecha de la transferencia</Label>
                            <Input id="fecha-pago" type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Medio de pago</Label>
                            <Select value={medioPago} onValueChange={setMedioPago}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {MEDIOS_DE_PAGO.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Queda registrado con tu nombre y no se puede modificar después.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPagando(null)}>Cancelar</Button>
                        <Button disabled={!fechaPago || !!processingId} onClick={registrarPago}>
                            {processingId ? <Loader2 className="animate-spin h-4 w-4" /> : 'Confirmar pago'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
