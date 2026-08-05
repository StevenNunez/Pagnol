"use client";

/**
 * RFC-004 F1 — piezas de lectura de los datos del Requerimiento (RQ).
 *
 * Viven aquí y no en cada bandeja porque los mismos datos se leen en tres
 * lugares distintos (historial del solicitante, bandeja del ADC y bandeja de
 * Abastecimiento) y las reglas de "qué está atrasado" o "qué es un imprevisto"
 * tienen que decir lo mismo en los tres.
 *
 * Todo es tolerante a NULL: las filas anteriores a la migración 20260807000000
 * no tienen estos campos y la UI simplemente no los muestra — no los inventa.
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AlertTriangle, CalendarClock, Store, Wrench, Zap } from 'lucide-react';
import type { PurchaseRequest, RequestUrgency } from '@/modules/core/lib/data';
import { SERVICE_KIND_LABELS } from '@/modules/core/lib/data';

/**
 * Forma mínima que necesitan estas piezas. Se declara así —y no como
 * `PurchaseRequest`— porque la bandeja del ADC normaliza los tres tipos de
 * solicitud a su propia forma antes de renderizarlas: pedirle el objeto
 * completo la obligaría a inventar campos que no tiene.
 */
export type RequestMeta = Partial<Pick<
  PurchaseRequest,
  'urgency' | 'neededBy' | 'expenseKind' | 'status' | 'itemDescription' | 'urgencyReason'
  | 'suggestedSupplierId' | 'suggestedSupplierName' | 'contractName' | 'category'
  | 'requestType' | 'serviceKind'
>>;

const URGENCY_STYLE: Record<RequestUrgency, string> = {
  alta: 'border-destructive/40 bg-destructive/10 text-destructive',
  media: 'border-warning/40 bg-warning-subtle text-warning-subtle-foreground',
  baja: 'border-border bg-muted text-muted-foreground',
};

/** 'YYYY-MM-DD' → Date local. `new Date('2026-08-05')` se interpreta como UTC
 * y en Chile retrocede un día: el off-by-one de zona horaria que ya apareció
 * cuatro veces en work-reports. */
function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

const formatShort = (ymd: string) =>
  parseLocalDate(ymd).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });

/** Un requerimiento está atrasado si su fecha requerida ya pasó y todavía no
 * llega. Recibido o rechazado ya no puede atrasarse. */
export function isOverdue(req: RequestMeta): boolean {
  if (!req.neededBy || req.status === 'received' || req.status === 'rejected') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parseLocalDate(req.neededBy) < today;
}

/** Urgencia declarada + la fecha concreta que se derivó de ella. */
export function UrgencyBadge({ req, className }: { req: RequestMeta; className?: string }) {
  if (!req.urgency) return null;
  const overdue = isOverdue(req);
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[9px] h-5 px-1.5 font-black uppercase tracking-widest gap-1 whitespace-nowrap',
        overdue ? 'border-destructive/40 bg-destructive/10 text-destructive' : URGENCY_STYLE[req.urgency],
        className,
      )}
    >
      {overdue ? <AlertTriangle className="h-3 w-3" /> : <CalendarClock className="h-3 w-3" />}
      {overdue ? 'Atrasado' : req.urgency}
      {req.neededBy && <span className="font-bold normal-case tracking-normal">· {formatShort(req.neededBy)}</span>}
    </Badge>
  );
}

/**
 * El motivo por el que se pidió para mañana. Se muestra destacado y sin
 * truncar: es lo que quien autoriza tiene que leer para decidir si la urgencia
 * es real, y esconderlo detrás de un tooltip lo volvería decorativo.
 */
export function UrgencyReason({ req, className }: { req: RequestMeta; className?: string }) {
  if (!req.urgencyReason || req.urgency !== 'alta') return null;
  return (
    <p className={cn(
      'text-[11px] font-medium flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-foreground',
      className,
    )}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-destructive" />
      <span><b className="uppercase tracking-widest text-[9px] text-destructive">Urgente porque:</b> {req.urgencyReason}</span>
    </p>
  );
}

/** Sólo se muestra el imprevisto: marcar cada gasto normal como "ordinario"
 * llena la pantalla de una etiqueta que no cambia ninguna decisión. */
export function ExpenseKindBadge({ req, className }: { req: RequestMeta; className?: string }) {
  if (req.expenseKind !== 'extraordinario') return null;
  return (
    <Badge
      variant="outline"
      className={cn('text-[9px] h-5 px-1.5 font-black uppercase tracking-widest gap-1 border-warning/40 bg-warning-subtle text-warning-subtle-foreground whitespace-nowrap', className)}
    >
      <Zap className="h-3 w-3" /> Extraordinario
    </Badge>
  );
}

/**
 * Marca un requerimiento de servicio. Importa mostrarlo en toda la cadena
 * porque cambia lo que pasa al final: un servicio NO ingresa al pañol, se
 * conforma contra su OC y su costo va a la partida `services`.
 */
export function ServiceBadge({ req, className }: { req: RequestMeta; className?: string }) {
  if (req.requestType !== 'servicio') return null;
  return (
    <Badge
      variant="outline"
      className={cn('text-[9px] h-5 px-1.5 font-black uppercase tracking-widest gap-1 border-primary/40 bg-primary/10 text-foreground whitespace-nowrap', className)}
    >
      <Wrench className="h-3 w-3" /> Servicio{req.serviceKind ? `: ${SERVICE_KIND_LABELS[req.serviceKind]}` : ''}
    </Badge>
  );
}

/** Especificación de la línea: lo que evita la llamada telefónica para cotizar. */
export function ItemSpec({ req, className }: { req: RequestMeta; className?: string }) {
  if (!req.itemDescription) return null;
  return <p className={cn('text-[11px] text-muted-foreground', className)}>{req.itemDescription}</p>;
}

/** Proveedor sugerido por quien pide. Es una sugerencia, no una adjudicación. */
export function SuggestedSupplier({ req, className }: { req: RequestMeta; className?: string }) {
  if (!req.suggestedSupplierName) return null;
  return (
    <p className={cn('text-[10px] font-medium text-muted-foreground flex items-center gap-1.5', className)}>
      <Store className="h-3 w-3 shrink-0" />
      Sugerido: <b className="text-foreground">{req.suggestedSupplierName}</b>
      {!req.suggestedSupplierId && <span className="italic">(no registrado)</span>}
    </p>
  );
}

/** El CeCo en una línea: contrato + partida. */
export function CecoLine({ req, className }: { req: RequestMeta; className?: string }) {
  return (
    <p className={cn('text-[10px] text-muted-foreground font-medium uppercase tracking-wide', className)}>
      {req.contractName || 'Sin contrato'} · <span className="text-foreground font-bold">{req.category || 'Sin partida'}</span>
    </p>
  );
}
