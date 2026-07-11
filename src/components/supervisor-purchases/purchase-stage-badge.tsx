"use client";

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ShieldQuestion, Search, CheckCircle2, Truck, PackageCheck, X, Mail } from 'lucide-react';
import { PurchaseStage, STAGE_META } from './purchase-pipeline';

const STAGE_ICON: Record<PurchaseStage, any> = {
    waiting_adc: ShieldQuestion,
    in_review: Search,
    to_send: Mail,
    approved: CheckCircle2,
    ordered: Truck,
    received: PackageCheck,
    rejected: X,
};

export function PurchaseStageBadge({ stage, className }: { stage: PurchaseStage; className?: string }) {
    const meta = STAGE_META[stage];
    const Icon = STAGE_ICON[stage];
    return (
        <Badge className={cn('gap-1.5 border-none text-[9px] font-black uppercase tracking-widest', meta.cls, className)}>
            <Icon className="h-3 w-3" /> {meta.label}
        </Badge>
    );
}
