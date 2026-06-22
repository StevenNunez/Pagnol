'use client';

import * as React from 'react';
import { Check, CloudOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  /** Hay ediciones locales sin confirmar en el servidor. */
  dirty: boolean;
  /** Último error de sincronización, si lo hubo. */
  error?: string;
  /** Estado de conexión actual. */
  online: boolean;
  /** Se está guardando contra el servidor en este momento. */
  saving?: boolean;
  className?: string;
}

/**
 * Badge de estado de sincronización por-registro:
 *   Sincronizado · Pendiente de sincronizar · Sin conexión · Error.
 * Usa tokens semánticos (success/warning/info/destructive) → dark mode gratis.
 * Reutilizable por cualquier formulario con autosave offline.
 */
export function DraftStatusBadge({ dirty, error, online, saving, className }: Props) {
  let icon: React.ReactNode;
  let label: string;
  let tone: string;

  if (error) {
    icon = <AlertTriangle className="h-3.5 w-3.5" />;
    label = 'Error de sincronización';
    tone = 'bg-destructive/10 text-destructive';
  } else if (saving) {
    icon = <RefreshCw className="h-3.5 w-3.5 animate-spin" />;
    label = 'Sincronizando…';
    tone = 'bg-info-subtle text-info-subtle-foreground';
  } else if (dirty && !online) {
    icon = <CloudOff className="h-3.5 w-3.5" />;
    label = 'Pendiente (sin conexión)';
    tone = 'bg-warning-subtle text-warning-subtle-foreground';
  } else if (dirty) {
    icon = <RefreshCw className="h-3.5 w-3.5" />;
    label = 'Pendiente de sincronizar';
    tone = 'bg-warning-subtle text-warning-subtle-foreground';
  } else {
    icon = <Check className="h-3.5 w-3.5" />;
    label = 'Sincronizado';
    tone = 'bg-success-subtle text-success-subtle-foreground';
  }

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest',
        tone,
        className,
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
