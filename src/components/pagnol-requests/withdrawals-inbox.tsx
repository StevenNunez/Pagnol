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
import {
    Check, X, Loader2, Search, Clock, ShieldQuestion, ArrowRight, PackageCheck, ChevronDown,
} from 'lucide-react';
import type { Material, User } from '@/modules/core/lib/data';
import {
    CompatibleMaterialRequest, RequestStatus, RequestItemsList, RequestStatusBadge,
    canApproveClass, formatDateTime, daysSince, toDate, requestItems,
} from './request-shared';

const STATUS_CHIPS: { key: RequestStatus; label: string }[] = [
    { key: 'pending', label: 'Por aprobar' },
    { key: 'approved', label: 'Aprobadas' },
    { key: 'rejected', label: 'Rechazadas' },
];

const PAGE_SIZE = 20;

export function WithdrawalsInbox({ onNavigateAuthorizations }: { onNavigateAuthorizations: () => void }) {
    const { requests, updateMaterialRequestStatus, users, materials, isLoading, can } = useAppState();
    const { toast } = useToast();

    const [status, setStatus] = useState<RequestStatus>('pending');
    const [search, setSearch] = useState('');
    const [visible, setVisible] = useState(PAGE_SIZE);
    const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

    const materialMap = useMemo(() => new Map((materials || []).map((m: Material) => [m.id, m])), [materials]);
    const userMap = useMemo(() => new Map((users || []).map((u: User) => [u.id, u.name])), [users]);

    const all = useMemo(() => {
        return [...((requests || []) as CompatibleMaterialRequest[])].sort(
            (a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0),
        );
    }, [requests]);

    // Gate ADC: solo las pendientes ya autorizadas llegan al pañol.
    const pendingReady = useMemo(() => all.filter(r => r.status === 'pending' && r.adcAuthorizedAt), [all]);
    const waitingAdc = useMemo(() => all.filter(r => r.status === 'pending' && !r.adcAuthorizedAt), [all]);
    const approved = useMemo(() => all.filter(r => r.status === 'approved'), [all]);
    const rejected = useMemo(() => all.filter(r => r.status === 'rejected'), [all]);

    const counts = { pending: pendingReady.length, approved: approved.length, rejected: rejected.length };

    const activeList = status === 'pending' ? pendingReady : status === 'approved' ? approved : rejected;

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return activeList;
        return activeList.filter(r => {
            if ((r.internalCode || '').toLowerCase().includes(q)) return true;
            if ((userMap.get(r.supervisorId) || '').toLowerCase().includes(q)) return true;
            if ((r.beneficiaryName || '').toLowerCase().includes(q)) return true;
            if ((r.contractName || '').toLowerCase().includes(q)) return true;
            return requestItems(r).some(it => (materialMap.get(it.materialId)?.name || '').toLowerCase().includes(q));
        });
    }, [activeList, search, userMap, materialMap]);

    const setStatusReset = (s: RequestStatus) => { setStatus(s); setVisible(PAGE_SIZE); };

    const handleUpdate = async (requestId: string, next: 'approved' | 'rejected') => {
        setProcessingIds(prev => new Set(prev).add(requestId));
        try {
            if (next === 'approved') {
                const req = all.find(r => r.id === requestId);
                const insufficient = requestItems(req as CompatibleMaterialRequest).filter(it => {
                    const mat = materialMap.get(it.materialId);
                    return !mat || (mat.stock ?? 0) < it.quantity;
                });
                if (insufficient.length > 0) throw new Error(`Stock insuficiente para ${insufficient.length} ítem(s). Revisa el inventario.`);
            }
            await updateMaterialRequestStatus(requestId, next);
            toast({
                title: next === 'approved' ? 'Solicitud aprobada' : 'Solicitud rechazada',
                description: next === 'approved' ? 'El stock fue descontado del inventario.' : 'No se modificó el inventario.',
                variant: next === 'approved' ? 'default' : 'destructive',
            });
            // Realtime refresca la colección sola — sin refetch masivo.
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'No se pudo procesar', description: e.message || 'Error inesperado.' });
        } finally {
            setProcessingIds(prev => { const s = new Set(prev); s.delete(requestId); return s; });
        }
    };

    return (
        <div className="space-y-6">
            {/* Chips de estado + búsqueda */}
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
                        placeholder="Buscar por código, persona o material…"
                        className="h-11 rounded-xl pl-10 text-xs bg-card"
                    />
                </div>
            </div>

            {/* Aviso: solicitudes atascadas en el ADC (solo cuando revisamos pendientes) */}
            {status === 'pending' && waitingAdc.length > 0 && (
                <button
                    onClick={onNavigateAuthorizations}
                    className="w-full flex items-center gap-4 p-5 rounded-[1.5rem] bg-info-subtle border border-info/20 text-left hover:bg-info-subtle/70 transition-colors group"
                >
                    <div className="w-11 h-11 rounded-2xl bg-card flex items-center justify-center text-info shrink-0 shadow-sm">
                        <ShieldQuestion size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-black uppercase tracking-tight text-info-subtle-foreground">{waitingAdc.length} solicitud{waitingAdc.length > 1 ? 'es' : ''} esperando al ADC</p>
                        <p className="text-[11px] text-muted-foreground font-medium">Aún no autorizadas por el Administrador de Contrato — no puedes aprobarlas todavía.</p>
                    </div>
                    <ArrowRight size={16} className="text-info shrink-0 group-hover:translate-x-1 transition-transform" />
                </button>
            )}

            {/* Lista */}
            {isLoading ? (
                <LoadingState />
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={status === 'pending' ? <Check size={24} className="text-success" /> : <PackageCheck size={24} />}
                    title={search ? 'Sin resultados' : status === 'pending' ? '¡Todo al día!' : `No hay solicitudes ${status === 'approved' ? 'aprobadas' : 'rechazadas'}`}
                    description={search ? `No se encontró "${search}".` : status === 'pending' ? 'No hay retiros pendientes de aprobación.' : undefined}
                />
            ) : (
                <>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                        {filtered.slice(0, visible).map(req => (
                            <WithdrawalCard
                                key={req.id}
                                req={req}
                                materialMap={materialMap}
                                supervisorName={userMap.get(req.supervisorId)}
                                isProcessing={processingIds.has(req.id)}
                                canAct={status === 'pending' && canApproveClass(can, (req.highestClass || 'C') as 'A' | 'B' | 'C')}
                                onApprove={() => handleUpdate(req.id, 'approved')}
                                onReject={() => handleUpdate(req.id, 'rejected')}
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
        </div>
    );
}

function WithdrawalCard({ req, materialMap, supervisorName, isProcessing, canAct, onApprove, onReject }: {
    req: CompatibleMaterialRequest;
    materialMap: Map<string, Material>;
    supervisorName?: string;
    isProcessing: boolean;
    canAct: boolean;
    onApprove: () => void;
    onReject: () => void;
}) {
    const cls = (req.highestClass || 'C') as 'A' | 'B' | 'C';
    // Aprobada sin retirar: el stock ya salió pero nadie fue a buscarlo.
    const notPickedUp = req.status === 'approved' && !req.deliveryDate;
    const pickupDays = notPickedUp ? daysSince(req.approvalDate) : 0;

    return (
        <div className={cn(
            'relative bg-card rounded-[2rem] border shadow-sm overflow-hidden transition-all',
            isProcessing ? 'opacity-60 pointer-events-none' : 'hover:shadow-xl',
            req.status === 'pending' && 'border-l-4 border-l-primary',
        )}>
            {isProcessing && (
                <div className="absolute inset-0 z-10 bg-background/60 flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">Procesando…</span>
                </div>
            )}

            <div className="p-6 space-y-4">
                {/* Encabezado */}
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-primary font-mono">{req.internalCode || `REF ${req.id.slice(0, 8).toUpperCase()}`}</p>
                        <p className="text-sm font-black uppercase tracking-tight text-foreground truncate mt-0.5">{supervisorName || req.userName || 'Solicitante'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {req.status !== 'pending' && <RequestStatusBadge status={req.status} />}
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">{formatDateTime(req.createdAt)}</span>
                    </div>
                </div>

                {/* Metadatos */}
                <div className="flex flex-wrap items-center gap-1.5">
                    {req.deliveryMode === 'directed' && req.beneficiaryName && (
                        <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-info/30 bg-info-subtle text-info font-black uppercase tracking-widest">Retira: {req.beneficiaryName}</Badge>
                    )}
                    {req.deliveryMode === 'open' && (
                        <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-warning/30 bg-warning-subtle text-warning font-black uppercase tracking-widest">Retiro abierto</Badge>
                    )}
                    {req.contractName && (
                        <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-primary/30 text-primary font-black uppercase tracking-widest">{req.contractName}</Badge>
                    )}
                    {req.area && <Badge variant="outline" className="text-[9px] h-5 px-1.5 font-black uppercase tracking-widest">{req.area}</Badge>}
                    {req.receivedByUserName && (
                        <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-success/30 bg-success-subtle text-success-subtle-foreground font-black uppercase tracking-widest">Recibió: {req.receivedByUserName}</Badge>
                    )}
                    {notPickedUp && (
                        <Badge className={cn(
                            'gap-1 text-[9px] h-5 px-1.5 border-none font-black uppercase tracking-widest',
                            pickupDays >= 3 ? 'bg-destructive/10 text-destructive' : 'bg-warning-subtle text-warning',
                        )}>
                            <Clock className="h-3 w-3" /> Sin retirar{pickupDays > 0 ? ` ${pickupDays}d` : ''}
                        </Badge>
                    )}
                </div>

                {/* Ítems */}
                <div className="bg-muted/40 p-4 rounded-2xl">
                    <RequestItemsList req={req} materialMap={materialMap} />
                </div>

                {req.notes && (
                    <p className="text-xs text-muted-foreground font-medium italic border-l-2 border-border pl-3">{req.notes}</p>
                )}

                {/* Acciones (solo pendientes con permiso de clase) */}
                {canAct && (
                    <div className="flex gap-3 pt-1">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="outline" className="rounded-xl h-11 px-5 text-[10px] font-black uppercase tracking-widest border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5">
                                    <X size={14} /> Rechazar
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-[1.5rem]">
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Rechazar solicitud</AlertDialogTitle>
                                    <AlertDialogDescription>Se marcará como rechazada y no se modificará el inventario. Esta acción es irreversible.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={onReject} className="bg-destructive hover:bg-destructive/90">Rechazar</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>

                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button className={cn(
                                    'flex-1 rounded-xl h-11 text-[10px] font-black uppercase tracking-widest gap-1.5',
                                    cls === 'A' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : cls === 'B' ? 'bg-info text-info-foreground hover:bg-info/90' : 'bg-success text-success-foreground hover:bg-success/90',
                                )}>
                                    <Check size={14} /> Aprobar Despacho {cls}
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-[1.5rem]">
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Confirmar aprobación</AlertDialogTitle>
                                    <AlertDialogDescription>Se descontarán los materiales del inventario automáticamente.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={onApprove} className="bg-success text-success-foreground hover:bg-success/90">Confirmar y descontar</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                )}
            </div>
        </div>
    );
}
