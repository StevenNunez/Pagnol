"use client";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Clock, MapPin, AlertTriangle, Building2, Mail, Truck } from 'lucide-react';
import type { PurchaseRequest, RentalRequest } from '@/modules/core/lib/data';
import { resolvePurchaseStage, isClientSupply, isRentalDerived, resolveRentalStage, STAGE_META, CLIENT_STAGE_HINT, PurchaseStage } from './purchase-pipeline';
import { PurchaseStageBadge } from './purchase-stage-badge';
import { UrgencyBadge, ExpenseKindBadge, ItemSpec, SuggestedSupplier, UrgencyReason, ServiceBadge } from '@/components/operations/request-meta';

const formatDate = (date: any): string => {
    if (!date) return 'N/A';
    const d = new Date(date);
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function ItemDetail({ req, stage }: { req: PurchaseRequest; stage: PurchaseStage }) {
    const clientHint = isClientSupply(req) ? CLIENT_STAGE_HINT[stage] : undefined;
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
                    {isClientSupply(req) && <span> — ingresó como activo del cliente</span>}
                    {typeof req.originalQuantity === 'number' && req.originalQuantity !== req.quantity && (
                        <span className="text-warning"> — recepción parcial (se solicitaron {req.originalQuantity} originalmente)</span>
                    )}
                </p>
            )}
            {stage === 'ordered' && isClientSupply(req) && req.sentToClientAt ? (
                <p className="text-[10px] font-medium text-muted-foreground">
                    Enviado a <b>{req.sentToClientEmail}</b> el {formatDate(req.sentToClientAt)}
                </p>
            ) : (stage === 'waiting_adc' || stage === 'in_review' || stage === 'to_send' || stage === 'approved' || stage === 'ordered') && (
                <p className="text-[10px] font-medium text-muted-foreground italic">{clientHint || STAGE_META[stage].hint}</p>
            )}
        </div>
    );
}

/** Badge de destino para solicitudes de suministro del cliente. */
function ClientBadge({ req }: { req: PurchaseRequest }) {
    if (!isClientSupply(req)) return null;
    return (
        <Badge variant="outline" className="text-[9px] h-5 px-1.5 font-black uppercase tracking-widest gap-1 border-info/40 text-info-subtle-foreground bg-info-subtle">
            <Building2 className="h-3 w-3" /> Cliente{req.clientName ? `: ${req.clientName}` : ''}
        </Badge>
    );
}

/** Botón de envío al cliente: visible cuando el grupo tiene ítems autorizados
 * por el ADC aún sin enviar (etapa 'to_send'). El envío lo hace la página
 * dueña (genera PDF + correo + marca enviado) vía `onSendToClient`. Si ya se
 * enviaron (etapa 'ordered'), se ofrece "Reenviar" — por ejemplo si se
 * escribió mal el correo o hay que mandarlo también a otro contacto. */
function SendToClientButton({ items, onSendToClient }: { items: PurchaseRequest[]; onSendToClient?: (items: PurchaseRequest[]) => void }) {
    if (!onSendToClient) return null;
    const toSend = items.filter((r) => isClientSupply(r) && resolvePurchaseStage(r) === 'to_send');
    if (toSend.length) {
        return (
            <Button size="sm" className="rounded-xl gap-2 w-full" onClick={() => onSendToClient(toSend)}>
                <Mail className="h-3.5 w-3.5" /> Enviar al cliente ({toSend.length} ítem{toSend.length > 1 ? 's' : ''})
            </Button>
        );
    }
    const alreadySent = items.filter((r) => isClientSupply(r) && resolvePurchaseStage(r) === 'ordered');
    if (!alreadySent.length) return null;
    return (
        <Button size="sm" variant="outline" className="rounded-xl gap-2 w-full" onClick={() => onSendToClient(alreadySent)}>
            <Mail className="h-3.5 w-3.5" /> Reenviar al cliente ({alreadySent.length} ítem{alreadySent.length > 1 ? 's' : ''})
        </Button>
    );
}

interface CardProps {
    items: PurchaseRequest[];
    onSendToClient?: (items: PurchaseRequest[]) => void;
    /** Estado real de las solicitudes de arriendo derivadas, por id. La etapa se
     *  PROYECTA desde aquí en vez de copiarse a la fila (RFC-004 F3). */
    rentalStatusById?: Map<string, RentalRequest['status']>;
}

/** Etapa a mostrar: la propia, o la del arriendo cuando el requerimiento derivó. */
function stageOf(req: PurchaseRequest, rentalStatusById?: Map<string, RentalRequest['status']>): PurchaseStage {
    if (isRentalDerived(req)) return resolveRentalStage(rentalStatusById?.get(req.rentalRequestId!));
    return resolvePurchaseStage(req);
}

/** Una solicitud suelta (sin batch, o grupo de un solo ítem). */
function SingleCard({ items, onSendToClient, rentalStatusById }: CardProps) {
    const req = items[0];
    const stage = stageOf(req, rentalStatusById);
    return (
        <div className={cn(
            'bg-card rounded-[1.5rem] border shadow-sm p-6 space-y-4 transition-all hover:shadow-lg',
            stage === 'waiting_adc' && 'border-l-4 border-l-warning',
            stage === 'to_send' && 'border-l-4 border-l-info',
        )}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary font-mono">{req.internalCode || `REF ${req.id.slice(0, 8).toUpperCase()}`}</p>
                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">{req.contractName || '—'}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <ClientBadge req={req} />
                        <ServiceBadge req={req} />
                        <UrgencyBadge req={req} />
                        <ExpenseKindBadge req={req} />
                    </div>
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
                        <ItemSpec req={req} />
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{req.category || 'General'}</p>
                    </div>
                    <span className="font-mono text-xs font-black text-muted-foreground shrink-0">{req.quantity} {req.unit}</span>
                </div>
            </div>

            {isRentalDerived(req) && (
                <a
                    href="/dashboard/abastecimiento/arriendos"
                    className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] font-medium text-foreground hover:bg-primary/10 transition-colors"
                >
                    <Truck className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>Se gestiona en <b>Arriendos</b>: cotización, comparación de ofertas y calendario de pagos.</span>
                </a>
            )}
            <UrgencyReason req={req} />
            <SuggestedSupplier req={req} />

            {req.area && (
                <Badge variant="outline" className="text-[9px] h-5 px-1.5 font-black uppercase tracking-widest gap-1 w-fit">
                    <MapPin className="h-3 w-3" /> {req.area}
                </Badge>
            )}

            {req.justification && (
                <p className="text-xs text-muted-foreground font-medium italic border-l-2 border-border pl-3">{req.justification}</p>
            )}

            <ItemDetail req={req} stage={stage} />
            <SendToClientButton items={items} onSendToClient={onSendToClient} />
        </div>
    );
}

/** Pedido con varios ítems que se enviaron juntos (mismo batchId). Cada ítem
 * conserva su propia etapa — Abastecimiento puede aprobar/rechazar por ítem,
 * así que un solo badge de grupo mentiría si divergen. */
function GroupCard({ items, onSendToClient, rentalStatusById }: CardProps) {
    const anchor = items[0];
    return (
        <div className="bg-card rounded-[1.5rem] border shadow-sm p-6 space-y-4 transition-all hover:shadow-lg">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary font-mono">
                        {anchor.internalCode || `REF ${anchor.id.slice(0, 8).toUpperCase()}`} <span className="text-muted-foreground normal-case font-medium">+ {items.length - 1} ítem{items.length - 1 > 1 ? 's' : ''} más</span>
                    </p>
                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">{anchor.contractName || '—'}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <ClientBadge req={anchor} />
                        <ServiceBadge req={anchor} />
                        <UrgencyBadge req={anchor} />
                        <ExpenseKindBadge req={anchor} />
                    </div>
                </div>
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap flex items-center gap-1 shrink-0">
                    <Clock className="h-3 w-3" /> {formatDate(anchor.createdAt)}
                </span>
            </div>

            <div className="space-y-2">
                {items.map(req => {
                    const stage = stageOf(req, rentalStatusById);
                    return (
                        <div key={req.id} className="bg-muted/40 p-4 rounded-2xl space-y-2">
                            <div className="flex justify-between items-center gap-2">
                                <div className="min-w-0">
                                    <p className="text-sm font-bold uppercase tracking-tight truncate">{req.materialName}</p>
                                    <ItemSpec req={req} />
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
            <UrgencyReason req={anchor} />
            <SuggestedSupplier req={anchor} />
            <SendToClientButton items={items} onSendToClient={onSendToClient} />
        </div>
    );
}

export function PurchaseHistoryCard({ items, onSendToClient, rentalStatusById }: CardProps) {
    if (items.length === 1) return <SingleCard items={items} onSendToClient={onSendToClient} rentalStatusById={rentalStatusById} />;
    return <GroupCard items={items} onSendToClient={onSendToClient} rentalStatusById={rentalStatusById} />;
}
