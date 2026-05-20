"use client";

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PaymentState } from '@/modules/core/lib/data';
import { generateEstadoDePagoPDF } from '@/lib/ep-pdf-generator';
import {
    Download, Clock, CheckCircle, CircleDollarSign, FileText,
    ArrowLeft, TrendingUp, DollarSign, ReceiptText
} from 'lucide-react';

const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'N/A';
    const d = date instanceof Date ? date : new Date(date as any);
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
};

const formatCurrency = (value: number) =>
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value);

const STATUS_CONFIG: Record<PaymentState['status'], { label: string; className: string; Icon: React.ComponentType<any> }> = {
    pending: { label: 'Pendiente', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', Icon: Clock },
    approved: { label: 'Aprobado', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', Icon: CheckCircle },
    paid: { label: 'Pagado', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', Icon: CircleDollarSign },
};

export default function PaymentHistoryPage() {
    const router = useRouter();
    const { paymentStates } = useAppState();
    const { user } = useAuth();

    const myPaymentStates = useMemo(() => {
        if (!user || !paymentStates) return [];
        return paymentStates
            .filter(ps => ps.contractorId === user.id)
            .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime());
    }, [paymentStates, user]);

    const summary = useMemo(() => {
        const total = myPaymentStates.reduce((acc, ps) => acc + ps.earnedValue, 0);
        const paid = myPaymentStates.filter(ps => ps.status === 'paid').reduce((acc, ps) => acc + ps.earnedValue, 0);
        const pending = myPaymentStates.filter(ps => ps.status === 'pending').length;
        return { total, paid, pending, count: myPaymentStates.length };
    }, [myPaymentStates]);

    const handleDownload = async (ep: PaymentState) => {
        if (!user) return;
        await generateEstadoDePagoPDF(ep.id, user.name, ep.totalValue, ep.earnedValue, ep.items);
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/estado-pago')} className="hover:bg-muted/50 shrink-0">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <PageHeader
                        title="Historial de Estados de Pago"
                        description="Todos los estados de pago que has generado y su situación actual."
                        className="mb-0 border-0 pb-0"
                    />
                </div>
            </div>

            {/* KPI Summary */}
            {myPaymentStates.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card>
                        <CardContent className="p-4 flex items-center gap-3">
                            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-md text-blue-600 shrink-0">
                                <ReceiptText className="h-4 w-4" />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">Total EP</p>
                                <p className="text-xl font-bold">{summary.count}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4 flex items-center gap-3">
                            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-md text-yellow-600 shrink-0">
                                <Clock className="h-4 w-4" />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">Pendientes</p>
                                <p className="text-xl font-bold">{summary.pending}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4 flex items-center gap-3">
                            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-md text-green-600 shrink-0">
                                <TrendingUp className="h-4 w-4" />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">Total Presentado</p>
                                <p className="text-sm font-bold">{formatCurrency(summary.total)}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4 flex items-center gap-3">
                            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-md text-blue-600 shrink-0">
                                <DollarSign className="h-4 w-4" />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">Total Pagado</p>
                                <p className="text-sm font-bold text-green-600">{formatCurrency(summary.paid)}</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        Mis Estados de Pago
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {myPaymentStates.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                            <div className="p-4 bg-muted/50 rounded-full">
                                <FileText className="h-10 w-10 opacity-40" />
                            </div>
                            <h3 className="text-lg font-semibold text-foreground">Sin estados de pago</h3>
                            <p className="text-sm text-center max-w-xs">
                                Aún no has generado ningún estado de pago. Ve a un contrato y presiona &quot;Generar Estado de Pago&quot;.
                            </p>
                            <Button variant="outline" onClick={() => router.push('/dashboard/estado-pago')}>
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Ver mis contratos
                            </Button>
                        </div>
                    ) : (
                        <ScrollArea className="h-[55vh]">
                            <Table>
                                <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead className="text-right">Valor Total Contrato</TableHead>
                                        <TableHead className="text-right">Valor Ganado (EP)</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {myPaymentStates.map(ep => {
                                        const cfg = STATUS_CONFIG[ep.status];
                                        const { Icon } = cfg;
                                        return (
                                            <TableRow key={ep.id} className="hover:bg-muted/30">
                                                <TableCell className="font-medium">
                                                    <div>{formatDate(ep.createdAt)}</div>
                                                    <div className="text-xs text-muted-foreground font-mono">#{ep.id.substring(0, 8).toUpperCase()}</div>
                                                </TableCell>
                                                <TableCell className="text-right font-mono">{formatCurrency(ep.totalValue)}</TableCell>
                                                <TableCell className="text-right font-mono font-semibold text-green-600">{formatCurrency(ep.earnedValue)}</TableCell>
                                                <TableCell>
                                                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full ${cfg.className}`}>
                                                        <Icon className="h-3 w-3" />
                                                        {cfg.label}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button variant="outline" size="sm" onClick={() => handleDownload(ep)}>
                                                        <Download className="mr-1.5 h-3.5 w-3.5" />
                                                        PDF
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
