"use client";

import { Badge } from '@/components/ui/badge';
import { Clock, MapPin, ImageIcon } from 'lucide-react';
import type { ReturnRequest } from '@/modules/core/lib/data';
import { ReturnStatusBadge, ConditionBadge, formatDateTime } from '@/components/pagnol-requests/request-shared';
import { SecureFileLink } from '@/components/secure-file-link';

export function ReturnHistoryCard({ req }: { req: ReturnRequest }) {
    return (
        <div className="bg-card rounded-[1.5rem] border shadow-sm p-6 space-y-4 transition-all hover:shadow-lg">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary font-mono">
                        {req.internalCode || `REF ${req.id.slice(0, 8).toUpperCase()}`}
                    </p>
                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest mt-1">{req.contractName || 'Pool central'}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <ReturnStatusBadge status={req.status} />
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {formatDateTime(req.createdAt)}
                    </span>
                </div>
            </div>

            <div className="bg-muted/40 p-4 rounded-2xl flex items-center gap-3">
                <span className="inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-lg bg-primary/10 text-primary text-sm font-black shrink-0">{req.quantity}</span>
                <div className="min-w-0">
                    <p className="text-sm font-bold uppercase tracking-tight truncate">{req.materialName}</p>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase">{req.unit}</p>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                <ConditionBadge condition={req.returnCondition} />
                {req.status === 'completed' && req.handlerName && (
                    <Badge variant="outline" className="text-[9px] h-5 px-1.5 font-black uppercase tracking-widest">Recepcionó: {req.handlerName}</Badge>
                )}
                {req.evidenceUrl && (
                    <SecureFileLink stored={req.evidenceUrl}>
                        <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-info/30 text-info font-black uppercase tracking-widest gap-1 hover:bg-info-subtle transition-colors">
                            <ImageIcon className="h-3 w-3" /> Ver evidencia
                        </Badge>
                    </SecureFileLink>
                )}
            </div>

            {req.notes && (
                <p className="text-xs text-muted-foreground font-medium italic border-l-2 border-border pl-3">{req.notes}</p>
            )}
        </div>
    );
}
