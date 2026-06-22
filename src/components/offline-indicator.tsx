'use client';

import * as React from 'react';
import { WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useOutboxItems } from '@/modules/offline/use-offline-collection';
import { SyncStatusDialog } from '@/components/sync-status-dialog';

/**
 * Píldora de estado de conexión + sincronización para la barra superior.
 * Clic → abre el panel de sincronización (cola, errores, reintento manual).
 * - Con errores → destructive.
 * - Sin conexión → warning (+ nº de cambios pendientes).
 * - En línea con pendientes → info "Sincronizando N…".
 * - En línea sin pendientes → discreta ("En línea").
 */
export function OfflineIndicator() {
  const online = useOnlineStatus();
  const items = useOutboxItems();
  const [open, setOpen] = React.useState(false);

  const pending = items.length;
  const errored = items.filter((i) => i.status === 'error').length;

  let content: React.ReactNode;
  let tone: string;
  let title: string;

  if (errored > 0) {
    tone = 'bg-destructive/10 text-destructive';
    title = `${errored} cambio(s) con error de sincronización`;
    content = (
      <>
        <AlertTriangle className="h-4 w-4" />
        <span className="hidden sm:inline">{errored} error{errored > 1 ? 'es' : ''}</span>
      </>
    );
  } else if (!online) {
    tone = 'bg-warning-subtle text-warning-subtle-foreground';
    title = 'Sin conexión — los cambios quedan pendientes de sincronizar';
    content = (
      <>
        <WifiOff className="h-4 w-4" />
        <span className="hidden sm:inline">Sin conexión{pending > 0 ? ` · ${pending}` : ''}</span>
      </>
    );
  } else if (pending > 0) {
    tone = 'bg-info-subtle text-info-subtle-foreground';
    title = `${pending} cambio(s) sincronizándose`;
    content = (
      <>
        <RefreshCw className="h-4 w-4 animate-spin" />
        <span className="hidden sm:inline">Sincronizando {pending}…</span>
      </>
    );
  } else {
    tone = 'text-muted-foreground';
    title = 'Conectado — los cambios se guardan en el servidor';
    content = (
      <>
        <span className="h-2 w-2 rounded-full bg-success shadow-[0_0_8px_hsl(var(--success)/0.5)]" />
        <span className="hidden sm:inline">En línea</span>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
        className={cn(
          'flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors hover:opacity-80',
          tone,
        )}
      >
        {content}
      </button>
      <SyncStatusDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
