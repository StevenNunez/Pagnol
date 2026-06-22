'use client';

import * as React from 'react';
import { RefreshCw, AlertTriangle, Trash2, Check, CloudOff } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { useOutboxItems } from '@/modules/offline/use-offline-collection';
import { retryItem, discardOutboxItem, retryAllErrored } from '@/modules/offline/outbox';
import { syncOutbox } from '@/modules/offline/sync';
import { useOnlineStatus } from '@/hooks/use-online-status';
import type { OutboxItem } from '@/modules/offline/db';

const OP_LABEL: Record<string, string> = {
  insert: 'Crear',
  update: 'Editar',
  delete: 'Eliminar',
  upload_photo: 'Subir foto',
};

const TABLE_LABEL: Record<string, string> = {
  work_orders: 'OT',
};

function describe(item: OutboxItem): string {
  const op = OP_LABEL[item.op] || item.op;
  const table = TABLE_LABEL[item.table] || item.table;
  return `${op} · ${table}`;
}

export function SyncStatusDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const items = useOutboxItems();
  const online = useOnlineStatus();
  const errored = items.filter((i) => i.status === 'error');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[1.5rem] max-w-lg">
        <DialogHeader>
          <DialogTitle>Sincronización</DialogTitle>
          <DialogDescription>
            {online
              ? 'Cambios guardados localmente, en espera de subir al servidor.'
              : 'Sin conexión. Los cambios se subirán automáticamente al reconectar.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl"
            disabled={!online || items.length === 0}
            onClick={() => void syncOutbox()}
          >
            <RefreshCw className="h-4 w-4 mr-2" /> Sincronizar ahora
          </Button>
          {errored.length > 0 && (
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => void retryAllErrored()}>
              Reintentar fallidos ({errored.length})
            </Button>
          )}
        </div>

        <div className="max-h-[50vh] overflow-y-auto space-y-2">
          {items.length === 0 ? (
            <EmptyState
              icon={<Check className="h-8 w-8" />}
              title="Todo sincronizado"
              description="No hay cambios pendientes."
            />
          ) : (
            items.map((item) => {
              const isError = item.status === 'error';
              return (
                <div
                  key={item.seq}
                  className="flex items-start justify-between gap-3 rounded-xl border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {isError ? (
                        <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                      ) : (
                        <CloudOff className="h-4 w-4 text-warning-subtle-foreground shrink-0" />
                      )}
                      <span className="text-sm font-bold truncate">{describe(item)}</span>
                    </div>
                    {isError && item.error && (
                      <p className="mt-1 text-xs text-destructive line-clamp-2">{item.error}</p>
                    )}
                    {isError && item.retries > 0 && (
                      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {item.retries} intento(s)
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isError && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="rounded-xl h-8 w-8"
                        title="Reintentar"
                        onClick={() => item.seq != null && void retryItem(item.seq)}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="rounded-xl h-8 w-8 text-destructive"
                      title="Descartar"
                      onClick={() => item.seq != null && void discardOutboxItem(item.seq)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
