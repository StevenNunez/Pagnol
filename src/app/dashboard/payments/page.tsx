"use client";

import React, { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ThumbsUp, ThumbsDown, CheckCircle, XCircle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { SalaryAdvance } from "@/modules/core/lib/data";

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(value);
};

const getStatusBadge = (status: SalaryAdvance['status']) => {
    switch (status) {
        case 'pending':
            return <Badge variant="secondary" className="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300"><Clock className="mr-1 h-3 w-3" /> Pendiente</Badge>;
        case 'approved':
            return <Badge className="bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300"><CheckCircle className="mr-1 h-3 w-3" /> Aprobada</Badge>;
        case 'rejected':
            return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" /> Rechazada</Badge>;
        default:
            return <Badge variant="outline">{status}</Badge>;
    }
};

export default function SalaryAdvancesPage() {
    const { salaryAdvances, approveSalaryAdvance, rejectSalaryAdvance, isLoading } = useAppState();
    const { toast } = useToast();
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [rejectTarget, setRejectTarget] = useState<SalaryAdvance | null>(null);
    const [rejectionReason, setRejectionReason] = useState('');

    const { pending, processed } = useMemo(() => {
        const pendingRequests: SalaryAdvance[] = [];
        const processedRequests: SalaryAdvance[] = [];

        (salaryAdvances || []).forEach(req => {
            if (req.status === 'pending') {
                pendingRequests.push(req);
            } else {
                processedRequests.push(req);
            }
        });

        // Ordenar: pendientes por fecha más antigua, procesados por fecha más reciente
        pendingRequests.sort((a, b) => (a.requestedAt as any) - (b.requestedAt as any));
        processedRequests.sort((a, b) => (b.processedAt as any) - (a.processedAt as any));

        return { pending: pendingRequests, processed: processedRequests };
    }, [salaryAdvances]);

    const handleApprove = async (id: string) => {
        setProcessingId(id);
        try {
            await approveSalaryAdvance(id);
            toast({ title: 'Adelanto Aprobado', description: 'La solicitud ha sido marcada como aprobada.' });
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        } finally {
            setProcessingId(null);
        }
    };

    const handleRejectConfirm = async () => {
        if (!rejectTarget) return;
        setProcessingId(rejectTarget.id);
        try {
            await rejectSalaryAdvance(rejectTarget.id, rejectionReason.trim());
            toast({ title: 'Adelanto Rechazado', description: 'La solicitud ha sido rechazada.', variant: 'destructive' });
            setRejectTarget(null);
            setRejectionReason('');
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
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
                    <Button size="sm" variant="destructive" onClick={() => { setRejectTarget(req); setRejectionReason(''); }}>
                        <ThumbsDown className="mr-2 h-4 w-4" /> Rechazar
                    </Button>
                    <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleApprove(req.id)}>
                        <ThumbsUp className="mr-2 h-4 w-4" /> Aprobar
                    </Button>
                </>
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
        { key: 'status', header: 'Estado', cell: (req) => getStatusBadge(req.status) },
    ];

    return (
        <>
        <div className="flex flex-col gap-8">
            <PageHeader title="Gestión de Adelantos de Sueldo" description="Aprueba o rechaza las solicitudes de adelanto de los trabajadores." />

            <Card>
                <CardHeader>
                    <CardTitle>Solicitudes Pendientes de Aprobación</CardTitle>
                    <CardDescription>Revisa y procesa las solicitudes de adelanto de sueldo.</CardDescription>
                </CardHeader>
                <CardContent>
                    <DataTable
                        data={pending}
                        rowKey={(req) => req.id}
                        isLoading={isLoading}
                        columns={pendingColumns}
                        empty={{ icon: <Clock className="h-8 w-8" />, title: 'No hay solicitudes pendientes.' }}
                    />
                </CardContent>
            </Card>

             <Card>
                <CardHeader>
                    <CardTitle>Historial de Solicitudes Procesadas</CardTitle>
                </CardHeader>
                <CardContent>
                    <DataTable
                        data={processed}
                        rowKey={(req) => req.id}
                        isLoading={isLoading}
                        columns={processedColumns}
                        // Atenuadas por ser historial ya resuelto (antes iba en el <TableRow>).
                        rowClassName={() => 'text-muted-foreground'}
                        empty={{ icon: <CheckCircle className="h-8 w-8" />, title: 'No hay solicitudes procesadas.' }}
                    />
                </CardContent>
             </Card>
        </div>

        {/* Dialog rechazo con razón */}
        <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectionReason(''); } }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Rechazar solicitud de adelanto</DialogTitle>
                    <DialogDescription>
                        Solicitud de <span className="font-bold">{rejectTarget?.workerName}</span> por {rejectTarget ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(rejectTarget.amount) : ''}. Puedes indicar una razón (opcional).
                    </DialogDescription>
                </DialogHeader>
                <div className="py-2">
                    <Textarea
                        placeholder="Ej: Saldo acumulado insuficiente, solicitar en quincena siguiente..."
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        rows={3}
                        className="resize-none"
                    />
                </div>
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectionReason(''); }}>
                        Cancelar
                    </Button>
                    <Button variant="destructive" onClick={handleRejectConfirm} disabled={!!processingId}>
                        {processingId ? <Loader2 className="animate-spin" size={16} /> : 'Confirmar Rechazo'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    );
}
