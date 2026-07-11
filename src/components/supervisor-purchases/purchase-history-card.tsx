"use client";

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Clock, MapPin, AlertTriangle } from 'lucide-react';
import type { PurchaseRequest } from '@/modules/core/lib/data';
import { resolvePurchaseStage, STAGE_META, PurchaseStage } from './purchase-pipeline';
import { PurchaseStageBadge } from './purchase-stage-badge';

const formatDate = (date: any): string => {
    if (!date) return 'N/A';
    const d = new Date(date);
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function ItemDetail({ req, stage }: { req: PurchaseRequest; stage: PurchaseStage }) {
    return (
        <div className="space-y-1.5">
            {stage === 'rejected' && req.rejectionReason && (
                <p className="text-[10px] font-medium text-destructive flex items-start gap-1.5">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" /> {req.rejectionReason}
                </p>
            )}
            {stage === 'received' && (
                <p className="text-[10px] font-medium text-muted-foreground">
                    Recibido el {formatDate(req.receivedAt)}
                    {typeof req.originalQuantity === 'number' && req.originalQuantity !== req.quantity && (
                        <span className="text-warning"> — recepción parcial (se solicitaron {req.originalQuantity} originalmente)</span>
                    )}
                </p>
            )}
            {(stage === 'waiting_adc' || stage === 'in_review' || stage === 'approved' || stage === 'ordered') && (
                <p className="text-[10px] font-medium text-muted-foreground italic">{STAGE_META[stage].hint}</p>
            )}
        </div>
    );
}

/** Una solicitud suelta (sin batch, o grupo de un solo ítem). */
function SingleCard({ req }: { req: PurchaseRequest }) {
    const stage = resolvePurchaseStage(req);
    return (
        <div className={cn(
            'bg-card rounded-[1.5rem] border shadow-sm p-6 space-y-4 transition-all hover:shadow-lg',
            stage === 'waiting_adc' && 'border-l-4 border-l-warning',
        )}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary font-mono">{req.internalCode || `REF ${req.id.slice(0, 8).toUpperCase()}`}</p>
                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest mt-1">{req.contractName || '—'}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <PurchaseStageBadge stage={stage} />
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {formatDate(req.createdAt)}
                    </span>
                </div>
            </div>

            <div className="bg-muted/40 p-4 rounded-2xl">
                <div className="flex justify-between items-center gap-2">
                    <div className="min-w-0">
                        <p className="text-sm font-bold uppercase tracking-tight truncate">{req.materialName}</p>
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{req.category || 'General'}</p>
                    </div>
                    <span className="font-mono text-xs font-black text-muted-foreground shrink-0">{req.quantity} {req.unit}</span>
                </div>
            </div>

            {req.area && (
                <Badge variant="outline" className="text-[9px] h-5 px-1.5 font-black uppercase tracking-widest gap-1 w-fit">
                    <MapPin className="h-3 w-3" /> {req.area}
                </Badge>
            )}

            {req.justification && (
                <p className="text-xs text-muted-foreground font-medium italic border-l-2 border-border pl-3">{req.justification}</p>
            )}

            <ItemDetail req={req} stage={stage} />
        </div>
    );
}

/** Pedido con varios ítems que se enviaron juntos (mismo batchId). Cada ítem
 * conserva su propia etapa — Abastecimiento puede aprobar/rechazar por ítem,
 * así que un solo badge de grupo mentiría si divergen. */
function GroupCard({ items }: { items: PurchaseRequest[] }) {
    const anchor = items[0];
    return (
        <div className="bg-card rounded-[1.5rem] border shadow-sm p-6 space-y-4 transition-all hover:shadow-lg">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary font-mono">
                        {anchor.internalCode || `REF ${anchor.id.slice(0, 8).toUpperCase()}`} <span className="text-muted-foreground normal-case font-medium">+ {items.length - 1} ítem{items.length - 1 > 1 ? 's' : ''} más</span>
                    </p>
                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest mt-1">{anchor.contractName || '—'}</p>
                </div>
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap flex items-center gap-1 shrink-0">
                    <Clock className="h-3 w-3" /> {formatDate(anchor.createdAt)}
                </span>
            </div>

            <div className="space-y-2">
                {items.map(req => {
                    const stage = resolvePurchaseStage(req);
                    return (
                        <div key={req.id} className="bg-muted/40 p-4 rounded-2xl space-y-2">
                            <div className="flex justify-between items-center gap-2">
                                <div className="min-w-0">
                                    <p className="text-sm font-bold uppercase tracking-tight truncate">{req.materialName}</p>
                                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{req.category || 'General'}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="font-mono text-xs font-black text-muted-foreground">{req.quantity} {req.unit}</span>
                                    <PurchaseStageBadge stage={stage} />
                                </div>
                            </div>
                            <ItemDetail req={req} stage={stage} />
                        </div>
                    );
                })}
            </div>

            {anchor.area && (
                <Badge variant="outline" className="text-[9px] h-5 px-1.5 font-black uppercase tracking-widest gap-1 w-fit">
                    <MapPin className="h-3 w-3" /> {anchor.area}
                </Badge>
            )}
            {anchor.justification && (
                <p className="text-xs text-muted-foreground font-medium italic border-l-2 border-border pl-3">{anchor.justification}</p>
            )}
        </div>
    );
}

export function PurchaseHistoryCard({ items }: { items: PurchaseRequest[] }) {
    if (items.length === 1) return <SingleCard req={items[0]} />;
    return <GroupCard items={items} />;
}
