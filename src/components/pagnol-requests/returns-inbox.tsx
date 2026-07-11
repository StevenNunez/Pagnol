"use client";

import { useMemo, useState } from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { LoadingState } from '@/components/loading-state';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { Check, X, Search, PackageCheck, ChevronDown, ImageIcon } from 'lucide-react';
import type { ReturnRequest } from '@/modules/core/lib/data';
import { ReturnAcceptDialog } from './return-accept-dialog';
import {
    ReturnStatus, ReturnCondition, ReturnStatusBadge, ConditionBadge, formatDateTime, toDate,
} from './request-shared';

const STATUS_CHIPS: { key: ReturnStatus; label: string }[] = [
    { key: 'pending', label: 'Por revisar' },
    { key: 'completed', label: 'Completadas' },
    { key: 'rejected', label: 'Rechazadas' },
];

const PAGE_SIZE = 20;

export function ReturnsInbox() {
    const { returnRequests, updateReturnRequestStatus, isLoading, can } = useAppState();
    const { toast } = useToast();

    const [status, setStatus] = useState<ReturnStatus>('pending');
    const [search, setSearch] = useState('');
    const [visible, setVisible] = useState(PAGE_SIZE);
    const [accepting, setAccepting] = useState<ReturnRequest | null>(null);
    const [rejectingId, setRejectingId] = useState<string | null>(null);

    const canApprove = can('material_requests:approve') || can('material_requests:approve_class_c');

    const counts = useMemo(() => ({
        pending: (returnRequests || []).filter(r => r.status === 'pending').length,
        completed: (returnRequests || []).filter(r => r.status === 'completed').length,
        rejected: (returnRequests || []).filter(r => r.status === 'rejected').length,
    }), [returnRequests]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (returnRequests || [])
            .filter(r => r.status === status)
            .filter(r => !q
                || (r.supervisorName || '').toLowerCase().includes(q)
                || (r.materialName || '').toLowerCase().includes(q)
                || (r.internalCode || '').toLowerCase().includes(q)
                || (r.contractName || '').toLowerCase().includes(q))
            .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
    }, [returnRequests, status, search]);

    const setStatusReset = (s: ReturnStatus) => { setStatus(s); setVisible(PAGE_SIZE); setSearch(''); };

    const handleAccept = async (condition: ReturnCondition) => {
        if (!accepting) return;
        try {
            // FIX: pasar la condición declarada — sin esto la mutación mandaba
            // TODO a mantenimiento (asumía "no OK").
            await updateReturnRequestStatus(accepting.id, 'completed', { condition });
            toast({
                title: 'Devolución aceptada',
                description: condition === 'OK'
                    ? `${accepting.materialName} reingresó al inventario, disponible.`
                    : `${accepting.materialName} reingresó y quedó en mantenimiento (${condition}).`,
            });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message || 'No se pudo aceptar la devolución.' });
            throw e; // que el diálogo no cierre en error
        }
    };

    const handleReject = async (id: string) => {
        setRejectingId(id);
        try {
            await updateReturnRequestStatus(id, 'rejected');
            toast({ title: 'Devolución rechazada', description: 'El stock no se modificó.' });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message || 'No se pudo rechazar.' });
        } finally {
            setRejectingId(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-1 bg-muted/50 border rounded-xl p-1 w-fit">
                    {STATUS_CHIPS.map(({ key, label }) => (
                        <button
                            key={key}
                            onClick={() => setStatusReset(key)}
                            className={cn(
                                'px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5',
                                status === key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {label}
                            {counts[key] > 0 && (
                                <span className={cn('px-1.5 py-0.5 rounded-md text-[8px]', status === key ? 'bg-primary-foreground/20' : 'bg-muted-foreground/10')}>{counts[key]}</span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                    <Input
                        value={search}
                        onChange={e => { setSearch(e.target.value); setVisible(PAGE_SIZE); }}
                        placeholder="Buscar por persona, material o código…"
                        className="h-11 rounded-xl pl-10 text-xs bg-card"
                    />
                </div>
            </div>

            {isLoading ? (
                <LoadingState />
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={<PackageCheck size={24} />}
                    title={search ? 'Sin resultados' : status === 'pending' ? 'No hay devoluciones por revisar' : `No hay devoluciones ${status === 'completed' ? 'completadas' : 'rechazadas'}`}
                    description={search ? `No se encontró "${search}".` : undefined}
                />
            ) : (
                <>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                        {filtered.slice(0, visible).map(req => (
                            <ReturnCard
                                key={req.id}
                                req={req}
                                canAct={status === 'pending' && canApprove}
                                isRejecting={rejectingId === req.id}
                                onAccept={() => setAccepting(req)}
                                onReject={() => handleReject(req.id)}
                            />
                        ))}
                    </div>
                    {filtered.length > visible && (
                        <div className="flex justify-center">
                            <Button variant="outline" onClick={() => setVisible(v => v + PAGE_SIZE)} className="rounded-[1.5rem] px-8 h-12 text-xs font-black uppercase tracking-widest gap-2">
                                Mostrar más ({filtered.length - visible}) <ChevronDown size={16} />
                            </Button>
                        </div>
                    )}
                </>
            )}

            {accepting && (
                <ReturnAcceptDialog request={accepting} onClose={() => setAccepting(null)} onConfirm={handleAccept} />
            )}
        </div>
    );
}

function ReturnCard({ req, canAct, isRejecting, onAccept, onReject }: {
    req: ReturnRequest;
    canAct: boolean;
    isRejecting: boolean;
    onAccept: () => void;
    onReject: () => void;
}) {
    return (
        <div className={cn(
            'bg-card rounded-[2rem] border shadow-sm p-6 space-y-4 transition-all hover:shadow-xl',
            req.status === 'pending' && 'border-l-4 border-l-primary',
        )}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    {req.internalCode && <p className="text-[10px] font-black uppercase tracking-widest text-primary font-mono">{req.internalCode}</p>}
                    <p className="text-sm font-black uppercase tracking-tight text-foreground truncate mt-0.5">{req.supervisorName}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {req.status !== 'pending' && <ReturnStatusBadge status={req.status} />}
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">{formatDateTime(req.createdAt)}</span>
                </div>
            </div>

            <div className="bg-muted/40 p-4 rounded-2xl flex items-center gap-3">
                <span className="inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-lg bg-primary/10 text-primary text-sm font-black shrink-0">{req.quantity}</span>
                <div className="min-w-0">
                    <p className="text-sm font-bold uppercase tracking-tight text-foreground truncate">{req.materialName}</p>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase">{req.unit}</p>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                {req.contractName && (
                    <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-primary/30 text-primary font-black uppercase tracking-widest">{req.contractName}</Badge>
                )}
                <ConditionBadge condition={req.returnCondition} />
                {req.status === 'completed' && req.handlerName && (
                    <Badge variant="outline" className="text-[9px] h-5 px-1.5 font-black uppercase tracking-widest">Recepcionó: {req.handlerName}</Badge>
                )}
                {req.evidenceUrl && (
                    <a href={req.evidenceUrl} target="_blank" rel="noopener noreferrer">
                        <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-info/30 text-info font-black uppercase tracking-widest gap-1 hover:bg-info-subtle transition-colors">
                            <ImageIcon className="h-3 w-3" /> Ver evidencia
                        </Badge>
                    </a>
                )}
            </div>

            {req.notes && (
                <p className="text-xs text-muted-foreground font-medium italic border-l-2 border-border pl-3">{req.notes}</p>
            )}

            {canAct && (
                <div className="flex gap-3 pt-1">
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="outline" disabled={isRejecting} className="rounded-xl h-11 px-5 text-[10px] font-black uppercase tracking-widest border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5">
                                <X size={14} /> Rechazar
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="rounded-[1.5rem]">
                            <AlertDialogHeader>
                                <AlertDialogTitle>Rechazar devolución</AlertDialogTitle>
                                <AlertDialogDescription>Se marcará como rechazada y el stock no se modificará.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={onReject} className="bg-destructive hover:bg-destructive/90">Rechazar</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    <Button onClick={onAccept} disabled={isRejecting} className="flex-1 rounded-xl h-11 text-[10px] font-black uppercase tracking-widest bg-success text-success-foreground hover:bg-success/90 gap-1.5">
                        <Check size={14} /> Aceptar Devolución
                    </Button>
                </div>
            )}
        </div>
    );
}
