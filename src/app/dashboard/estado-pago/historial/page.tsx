"use client";

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PaymentState } from '@/modules/core/lib/data';
import { generateEstadoDePagoPDF } from '@/lib/ep-pdf-generator';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
    Download, Clock, CheckCircle, CircleDollarSign, FileText,
    ArrowLeft, TrendingUp, DollarSign, ReceiptText, Loader2, Ban, HandCoins
} from 'lucide-react';

const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'N/A';
    const d = date instanceof Date ? date : new Date(date as any);
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
};

const formatCurrency = (value: number) =>
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value);

const STATUS_CONFIG: Record<PaymentState['status'], { label: string; className: string; Icon: React.ComponentType<any> }> = {
    pending: { label: 'Pendiente', className: 'bg-warning-subtle text-warning-subtle-foreground', Icon: Clock },
    approved: { label: 'Aprobado', className: 'bg-success-subtle text-success-subtle-foreground', Icon: CheckCircle },
    paid: { label: 'Cobrado', className: 'bg-info-subtle text-info-subtle-foreground', Icon: CircleDollarSign },
    annulled: { label: 'Anulado', className: 'bg-muted text-muted-foreground line-through', Icon: Ban },
};

export default function PaymentHistoryPage() {
    const router = useRouter();
    const { paymentStates, currentTenant, approvePaymentState, markPaymentStatePaid, annulPaymentState } = useAppState();
    const { user, can } = useAuth();
    const { toast } = useToast();

    const canApprove = can('payment_states:approve');
    const canPay = can('payment_states:pay');

    const [busyId, setBusyId] = useState<string | null>(null);
    const [payTarget, setPayTarget] = useState<PaymentState | null>(null);
    const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [annulTarget, setAnnulTarget] = useState<PaymentState | null>(null);
    const [annulReason, setAnnulReason] = useState('');

    // Quien aprueba/cobra ve TODOS los EP del tenant; el resto, solo los suyos.
    const myPaymentStates = useMemo(() => {
        if (!user || !paymentStates) return [];
        return paymentStates
            .filter(ps => canApprove || canPay || ps.contractorId === user.id)
            .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime());
    }, [paymentStates, user, canApprove, canPay]);

    const run = async (id: string, fn: () => Promise<void>, okMsg: string) => {
        setBusyId(id);
        try {
            await fn();
            toast({ title: okMsg });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo completar la acción', description: e?.message || 'Error desconocido.' });
        } finally {
            setBusyId(null);
        }
    };

    // Los montos suman el AVANCE DEL PERÍODO de cada EP (no el acumulado, que
    // duplicaría los EP anteriores — ADR-004 §2). EPs anulados no suman.
    const summary = useMemo(() => {
        const live = myPaymentStates.filter(ps => ps.status !== 'annulled');
        const total = live.reduce((acc, ps) => acc + (ps.periodEarned || 0), 0);
        const paid = live.filter(ps => ps.status === 'paid').reduce((acc, ps) => acc + (ps.periodEarned || 0), 0);
        const pending = live.filter(ps => ps.status === 'pending').length;
        return { total, paid, pending, count: myPaymentStates.length };
    }, [myPaymentStates]);

    const handleDownload = async (ep: PaymentState) => {
        if (!user) return;
        await generateEstadoDePagoPDF(ep.id, user.name, ep.totalValue, ep.earnedValue, ep.items, currentTenant?.logoUrl);
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
                            <div className="p-2 bg-info-subtle rounded-md text-info shrink-0">
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
                            <div className="p-2 bg-warning-subtle rounded-md text-warning shrink-0">
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
                            <div className="p-2 bg-success-subtle rounded-md text-success shrink-0">
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
                            <div className="p-2 bg-info-subtle rounded-md text-info shrink-0">
                                <DollarSign className="h-4 w-4" />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">Total Pagado</p>
                                <p className="text-sm font-bold text-success">{formatCurrency(summary.paid)}</p>
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
                                        <TableHead>EP</TableHead>
                                        <TableHead>Contrato</TableHead>
                                        <TableHead className="text-right">Avance del Período</TableHead>
                                        <TableHead className="text-right">Acumulado</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {myPaymentStates.map(ep => {
                                        const cfg = STATUS_CONFIG[ep.status] || STATUS_CONFIG.pending;
                                        const { Icon } = cfg;
                                        const busy = busyId === ep.id;
                                        return (
                                            <TableRow key={ep.id} className="hover:bg-muted/30">
                                                <TableCell className="font-medium">
                                                    <div className="font-mono text-xs font-bold">{ep.internalCode || `#${ep.id.substring(0, 8).toUpperCase()}`}</div>
                                                    <div className="text-xs text-muted-foreground">{formatDate(ep.createdAt)} · {ep.contractorName}</div>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {ep.contractName || <span className="text-warning-subtle-foreground text-xs font-semibold">Sin contrato</span>}
                                                </TableCell>
                                                <TableCell className="text-right font-mono font-semibold">{formatCurrency(ep.periodEarned || 0)}</TableCell>
                                                <TableCell className="text-right font-mono text-muted-foreground">{formatCurrency(ep.earnedValue)}</TableCell>
                                                <TableCell>
                                                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full ${cfg.className}`}>
                                                        <Icon className="h-3 w-3" />
                                                        {cfg.label}
                                                    </span>
                                                    {ep.status === 'paid' && ep.paidAt && (
                                                        <div className="text-[10px] text-muted-foreground mt-1">Cobrado el {ep.paidAt}</div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        {ep.status === 'pending' && canApprove && (
                                                            <Button size="sm" className="rounded-xl" disabled={busy}
                                                                onClick={() => run(ep.id, () => approvePaymentState(ep.id), 'EP aprobado: el ingreso del período quedó devengado en Finanzas.')}>
                                                                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="mr-1.5 h-3.5 w-3.5" />}
                                                                Aprobar
                                                            </Button>
                                                        )}
                                                        {ep.status === 'approved' && canPay && (
                                                            <Button size="sm" variant="secondary" className="rounded-xl" disabled={busy}
                                                                onClick={() => { setPayDate(new Date().toISOString().slice(0, 10)); setPayTarget(ep); }}>
                                                                <HandCoins className="mr-1.5 h-3.5 w-3.5" />
                                                                Cobrado
                                                            </Button>
                                                        )}
                                                        {(ep.status === 'pending' || ep.status === 'approved' || ep.status === 'paid') && canApprove && (
                                                            <Button size="sm" variant="ghost" className="rounded-xl text-destructive" disabled={busy}
                                                                onClick={() => { setAnnulReason(''); setAnnulTarget(ep); }}>
                                                                <Ban className="h-3.5 w-3.5" />
                                                            </Button>
                                                        )}
                                                        <Button variant="outline" size="sm" className="rounded-xl" onClick={() => handleDownload(ep)}>
                                                            <Download className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
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

            {/* Diálogo: registrar cobro (fecha real — ADR-004 §3) */}
            <Dialog open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Registrar cobro</DialogTitle>
                        <DialogDescription>
                            {payTarget?.internalCode || ''} — {formatCurrency(payTarget?.periodEarned || 0)} del período.
                            El ingreso pagado se registra en Finanzas con la fecha real del cobro.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Fecha del cobro</p>
                        <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="rounded-xl" />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" className="rounded-xl" onClick={() => setPayTarget(null)}>Cancelar</Button>
                        <Button className="rounded-xl" disabled={!payDate || busyId === payTarget?.id}
                            onClick={() => {
                                const t = payTarget!;
                                setPayTarget(null);
                                run(t.id, () => markPaymentStatePaid(t.id, payDate), 'Cobro registrado: el ingreso pagado quedó en Finanzas.');
                            }}>
                            <HandCoins className="mr-2 h-4 w-4" /> Confirmar cobro
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Diálogo: anular (reversa los hechos vivos del EP) */}
            <Dialog open={!!annulTarget} onOpenChange={(open) => !open && setAnnulTarget(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Anular estado de pago</DialogTitle>
                        <DialogDescription>
                            {annulTarget?.internalCode || ''} — si estaba aprobado o cobrado, sus hechos en Finanzas
                            se reversan (los hechos no se borran: quedan neteados en 0).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Motivo</p>
                        <Textarea value={annulReason} onChange={(e) => setAnnulReason(e.target.value)}
                            placeholder="Ej: avance mal medido, se re-emitirá corregido…" className="rounded-xl" />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" className="rounded-xl" onClick={() => setAnnulTarget(null)}>Cancelar</Button>
                        <Button variant="destructive" className="rounded-xl" disabled={!annulReason.trim() || busyId === annulTarget?.id}
                            onClick={() => {
                                const t = annulTarget!;
                                setAnnulTarget(null);
                                run(t.id, () => annulPaymentState(t.id, annulReason.trim()), 'EP anulado y hechos reversados.');
                            }}>
                            <Ban className="mr-2 h-4 w-4" /> Anular EP
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
