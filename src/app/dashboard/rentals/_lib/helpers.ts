import type {
  RentalDirection,
  RentalBillingCycle,
  RentalAssetCategory,
  RentalContractStatus,
  RentalPayment,
  RentalPaymentStatus,
} from '@/modules/core/lib/data';

// ── Etiquetas (es-CL) ─────────────────────────────────────────────────────────

export const DIRECTION_LABEL: Record<RentalDirection, string> = {
  incoming: 'Arrendado a proveedor',
  outgoing: 'Arrendado a cliente',
};

export const DIRECTION_SHORT: Record<RentalDirection, string> = {
  incoming: 'Entrante',
  outgoing: 'Saliente',
};

export const BILLING_CYCLE_LABEL: Record<RentalBillingCycle, string> = {
  monthly: 'Mensual',
  biweekly: 'Quincenal',
  weekly: 'Semanal',
  daily: 'Diario',
  one_time: 'Pago único',
};

export const CATEGORY_LABEL: Record<RentalAssetCategory, string> = {
  machinery: 'Maquinaria',
  measurement: 'Equipo de medición',
  vehicle: 'Vehículo',
  truck: 'Camión',
  other: 'Otro',
};

export const CONTRACT_STATUS_LABEL: Record<RentalContractStatus, string> = {
  active: 'Activo',
  pending: 'Pendiente',
  finished: 'Finalizado',
  cancelled: 'Cancelado',
};

export const PAYMENT_STATUS_LABEL: Record<RentalPaymentStatus, string> = {
  pending: 'Pendiente',
  paid: 'Pagado',
  overdue: 'Vencido',
};

// ── Clases de badge (mapas estáticos para no purgar Tailwind en prod) ─────────

export const CONTRACT_STATUS_BADGE: Record<RentalContractStatus, string> = {
  active: 'badge-success',
  pending: 'badge-info',
  finished: 'bg-muted text-muted-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
};

export const PAYMENT_STATUS_BADGE: Record<RentalPaymentStatus, string> = {
  pending: 'badge-warning',
  paid: 'badge-success',
  overdue: 'bg-destructive/10 text-destructive',
};

export const DIRECTION_BADGE: Record<RentalDirection, string> = {
  incoming: 'badge-warning',
  outgoing: 'badge-info',
};

export const ASSET_STATUS_LABEL: Record<'active' | 'returned', string> = {
  active: 'En arriendo',
  returned: 'Devuelto',
};

export const ASSET_STATUS_BADGE: Record<'active' | 'returned', string> = {
  active: 'badge-success',
  returned: 'bg-muted text-muted-foreground',
};

// ── Formato de moneda ─────────────────────────────────────────────────────────

export function formatMoney(amount: number, currency = 'CLP'): string {
  if (currency === 'CLP') {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(amount || 0);
  }
  // UF / USD u otros: muestra el código y el número con 2 decimales.
  const n = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(amount || 0);
  return `${currency} ${n}`;
}

// ── Estado derivado de pago ───────────────────────────────────────────────────

/** Deriva el estado real: 'overdue' si la cuota pendiente venció. */
export function derivePaymentStatus(p: Pick<RentalPayment, 'status' | 'dueDate'>): RentalPaymentStatus {
  if (p.status === 'paid') return 'paid';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(p.dueDate as any);
  due.setHours(0, 0, 0, 0);
  return due < today ? 'overdue' : 'pending';
}
