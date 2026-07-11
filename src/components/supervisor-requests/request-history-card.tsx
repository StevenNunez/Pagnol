"use client";

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Clock, MapPin, Users } from 'lucide-react';
import type { Material } from '@/modules/core/lib/data';
import { CompatibleMaterialRequest, requestItems, formatDateTime, daysSince } from '@/components/pagnol-requests/request-shared';
import { resolveSupervisorStage, STAGE_META } from './request-pipeline';
import { StageBadge } from './stage-badge';

interface RequestHistoryCardProps {
    req: CompatibleMaterialRequest;
    materialMap: Map<string, Material>;
    contractName?: string;
}

export function RequestHistoryCard({ req, materialMap, contractName }: RequestHistoryCardProps) {
    const stage = resolveSupervisorStage(req);
    const items = requestItems(req);
    const waitingDays = stage === 'ready_pickup' ? daysSince(req.approvalDate) : 0;

    return (
        <div className={cn(
            'bg-card rounded-[1.5rem] border shadow-sm p-6 space-y-4 transition-all hover:shadow-lg',
            stage === 'ready_pickup' && 'border-l-4 border-l-success',
            stage === 'waiting_adc' && 'border-l-4 border-l-warning',
        )}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary font-mono">
                        {req.internalCode || `REF ${req.id.slice(0, 8).toUpperCase()}`}
                    </p>
                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest mt-1">{contractName || req.contractName || '—'}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <StageBadge stage={stage} />
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {formatDateTime(req.createdAt)}
                    </span>
                </div>
            </div>

            {/* Ítems */}
            <div className="bg-muted/40 p-4 rounded-2xl">
                <ul className="space-y-1.5">
                    {items.length > 0 ? items.map((item, idx) => {
                        const mat = materialMap.get(item.materialId);
                        return (
                            <li key={idx} className="flex justify-between items-center gap-2 text-sm">
                                <span className="font-bold uppercase tracking-tight truncate">{mat?.name || 'Material desconocido'}</span>
                                <span className="font-mono text-xs font-black text-muted-foreground shrink-0">{item.quantity} {mat?.unit || 'u'}</span>
                            </li>
                        );
                    }) : (
                        <li className="flex justify-between items-center text-sm">
                            <span className="font-bold uppercase tracking-tight">{materialMap.get(req.materialId || '')?.name}</span>
                            <span className="font-mono text-xs font-black text-muted-foreground">{req.quantity}</span>
                        </li>
                    )}
                </ul>
            </div>

            {/* Metadatos de entrega */}
            <div className="flex flex-wrap items-center gap-1.5">
                {req.deliveryMode === 'directed' && req.beneficiaryName && (
                    <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-info/30 bg-info-subtle text-info font-black uppercase tracking-widest gap-1">
                        <Users className="h-3 w-3" /> Retira: {req.beneficiaryName}
                    </Badge>
                )}
                {req.deliveryMode === 'open' && (
                    <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-warning/30 bg-warning-subtle text-warning font-black uppercase tracking-widest">Retiro abierto</Badge>
                )}
                {req.area && (
                    <Badge variant="outline" className="text-[9px] h-5 px-1.5 font-black uppercase tracking-widest gap-1">
                        <MapPin className="h-3 w-3" /> {req.area}
                    </Badge>
                )}
                {stage === 'delivered' && req.receivedByUserName && (
                    <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-success/30 bg-success-subtle text-success-subtle-foreground font-black uppercase tracking-widest">
                        Recibió: {req.receivedByUserName}
                    </Badge>
                )}
            </div>

            {/* Nota accionable según etapa */}
            {stage === 'ready_pickup' && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-success-subtle border border-success/20">
                    <Clock className="h-4 w-4 text-success shrink-0" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-success-subtle-foreground">
                        {waitingDays > 0 ? `Esperando retiro hace ${waitingDays} día${waitingDays > 1 ? 's' : ''}` : 'Lista para retiro — pasa por el pañol'}
                    </p>
                </div>
            )}
            {(stage === 'waiting_adc' || stage === 'queued') && (
                <p className="text-[10px] font-medium text-muted-foreground italic pl-1">{STAGE_META[stage].hint}</p>
            )}
        </div>
    );
}
