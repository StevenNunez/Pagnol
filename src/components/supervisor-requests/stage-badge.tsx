"use client";

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ShieldQuestion, Clock, PackageCheck, CheckCircle2, X } from 'lucide-react';
import { SupervisorStage, STAGE_META } from './request-pipeline';

const STAGE_ICON: Record<SupervisorStage, any> = {
    waiting_adc: ShieldQuestion,
    queued: Clock,
    ready_pickup: PackageCheck,
    delivered: CheckCircle2,
    rejected: X,
};

export function StageBadge({ stage, className }: { stage: SupervisorStage; className?: string }) {
    const meta = STAGE_META[stage];
    const Icon = STAGE_ICON[stage];
    return (
        <Badge className={cn('gap-1.5 border-none text-[9px] font-black uppercase tracking-widest', meta.cls, className)}>
            <Icon className="h-3 w-3" /> {meta.label}
        </Badge>
    );
}
