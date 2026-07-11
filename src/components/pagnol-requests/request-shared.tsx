"use client";

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Clock, Check, X, AlertTriangle } from 'lucide-react';
import type { Material, MaterialRequest } from '@/modules/core/lib/data';

// ── Tipos y compatibilidad ──────────────────────────────────────────────────

export type RequestStatus = 'pending' | 'approved' | 'rejected';
export type ReturnStatus = 'pending' | 'completed' | 'rejected';
export type ReturnCondition = 'OK' | 'CON FALLA' | 'ROTO';

// Solicitudes antiguas guardaban un material plano en vez de items[].
export type CompatibleMaterialRequest = MaterialRequest & {
    materialId?: string;
    quantity?: number;
};

export function requestItems(req: CompatibleMaterialRequest): { materialId: string; quantity: number }[] {
    if (req.items && Array.isArray(req.items)) return req.items;
    if (req.materialId && req.quantity) return [{ materialId: req.materialId, quantity: req.quantity }];
    return [];
}

// ── Permisos por clase (alineado con el servidor) ───────────────────────────

/**
 * ¿Puede este usuario aprobar una solicitud de la clase dada? Refleja la
 * jerarquía del servidor: A cubre B y C; B cubre C. Se usa para mostrar los
 * botones exactamente cuando la mutación va a aceptar la acción (sin falsos
 * positivos con el permiso genérico `material_requests:approve`).
 */
export function canApproveClass(can: (p: any) => boolean, cls: 'A' | 'B' | 'C'): boolean {
    if (cls === 'A') return can('material_requests:approve_class_a');
    if (cls === 'B') return can('material_requests:approve_class_b') || can('material_requests:approve_class_a');
    return can('material_requests:approve_class_c') || can('material_requests:approve_class_b') || can('material_requests:approve_class_a');
}

// ── Formato ─────────────────────────────────────────────────────────────────

export const toDate = (date: any): Date | null => {
    if (!date) return null;
    return date instanceof Date ? date : new Date(date);
};

export const formatDateTime = (date: any): string => {
    const d = toDate(date);
    return d ? d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'N/A';
};

export const daysSince = (date: any): number => {
    const d = toDate(date);
    return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : 0;
};

// ── Badges (tokens semánticos, firma Pagnol) ────────────────────────────────

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
    if (status === 'pending') return <Badge className="badge-warning gap-1 border-none text-[9px] font-black uppercase tracking-widest"><Clock className="h-3 w-3" /> Pendiente</Badge>;
    if (status === 'approved') return <Badge className="badge-success gap-1 border-none text-[9px] font-black uppercase tracking-widest"><Check className="h-3 w-3" /> Aprobada</Badge>;
    return <Badge className="gap-1 border-none bg-destructive/10 text-destructive text-[9px] font-black uppercase tracking-widest"><X className="h-3 w-3" /> Rechazada</Badge>;
}

export function ReturnStatusBadge({ status }: { status: ReturnStatus }) {
    if (status === 'pending') return <Badge className="badge-warning gap-1 border-none text-[9px] font-black uppercase tracking-widest"><Clock className="h-3 w-3" /> Por revisar</Badge>;
    if (status === 'completed') return <Badge className="badge-success gap-1 border-none text-[9px] font-black uppercase tracking-widest"><Check className="h-3 w-3" /> Completada</Badge>;
    return <Badge className="gap-1 border-none bg-destructive/10 text-destructive text-[9px] font-black uppercase tracking-widest"><X className="h-3 w-3" /> Rechazada</Badge>;
}

export function ConditionBadge({ condition }: { condition?: ReturnCondition | null }) {
    if (!condition) return null;
    const cls = condition === 'OK'
        ? 'bg-success-subtle text-success-subtle-foreground'
        : condition === 'CON FALLA'
            ? 'bg-warning-subtle text-warning'
            : 'bg-destructive/10 text-destructive';
    return <Badge className={cn('gap-1 border-none text-[9px] font-black uppercase tracking-widest', cls)}>{condition !== 'OK' && <AlertTriangle className="h-3 w-3" />}{condition}</Badge>;
}

export function ClassChip({ cls }: { cls?: 'A' | 'B' | 'C' | null }) {
    if (!cls) return null;
    const styles = {
        A: 'border-destructive/30 text-destructive bg-destructive/10',
        B: 'border-warning/30 text-warning bg-warning-subtle',
        C: 'border-success/30 text-success-subtle-foreground bg-success-subtle',
    }[cls];
    return <Badge variant="outline" className={cn('text-[9px] h-4 px-1 shrink-0 font-black uppercase tracking-widest', styles)}>Clase {cls}</Badge>;
}

// ── Lista de ítems de una solicitud ─────────────────────────────────────────

export function RequestItemsList({ req, materialMap }: { req: CompatibleMaterialRequest; materialMap: Map<string, Material> }) {
    const items = requestItems(req);
    return (
        <ul className="space-y-2">
            {items.map((item, index) => {
                const material = materialMap.get(item.materialId);
                const currentStock = material?.stock ?? 0;
                const isInsufficient = req.status === 'pending' && currentStock < item.quantity;
                return (
                    <li key={index} className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-lg bg-primary/10 text-primary text-xs font-black">{item.quantity}</span>
                        <span className={cn('text-sm font-bold uppercase tracking-tight', isInsufficient ? 'text-destructive' : 'text-foreground')}>
                            {material?.name ?? 'Material desconocido'}
                        </span>
                        {material?.unit && <span className="text-[10px] text-muted-foreground font-bold uppercase">({material.unit})</span>}
                        <ClassChip cls={material?.class} />
                        {isInsufficient && (
                            <Badge className="text-[9px] h-5 px-1.5 border-none bg-destructive/10 text-destructive font-black uppercase tracking-widest gap-1">
                                <AlertTriangle className="h-3 w-3" /> Solo {currentStock} en stock
                            </Badge>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
