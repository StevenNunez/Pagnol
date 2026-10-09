'use client';

import React, { useState } from 'react';
import { Loader2, Minus, PackagePlus, Plus } from 'lucide-react';
import { Material } from '@/modules/core/lib/data';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// Motivos frecuentes: un toque y listo. Igual se puede escribir otro.
const QUICK_REASONS = ['Compra directa', 'Conteo de inventario', 'Llegó desde otra faena'];

/**
 * Sumar unidades a un material sin salir de Gestión de Activos. Registra lo
 * mismo que Ingreso Manual (entrada al pool central + kardex con el motivo).
 */
export function AddStockDialog({ asset, onClose }: { asset: Material | null; onClose: () => void }) {
  const { addManualStockEntry } = useAppState();
  const { toast } = useToast();
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Cada vez que se abre para otro material, parte limpio.
  const [shownId, setShownId] = useState(asset?.id);
  if (shownId !== asset?.id) {
    setShownId(asset?.id);
    setQty('1');
    setReason('');
  }

  const quantity = Math.floor(Number(qty));
  const validQty = Number.isFinite(quantity) && quantity >= 1;
  const validReason = reason.trim().length >= 5;
  const current = asset?.stock ?? 0;
  const unit = asset?.unit || 'unidades';

  const handleSave = async () => {
    if (!asset || !validQty || !validReason) return;
    setSaving(true);
    try {
      await addManualStockEntry(asset.id, quantity, reason.trim());
      toast({ title: 'Cantidad ingresada', description: `${asset.name}: ahora hay ${current + quantity} ${unit}.` });
      onClose();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo ingresar', description: e?.message || 'Error inesperado.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!asset} onOpenChange={open => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-md rounded-[2rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-black uppercase tracking-tight">
            <PackagePlus size={20} className="text-primary" /> Ingresar cantidad
          </DialogTitle>
          <DialogDescription className="font-bold uppercase text-xs tracking-tight text-foreground/80">
            {asset?.name}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); handleSave(); }}
          className="space-y-6"
        >
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">¿Cuántas llegaron?</p>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="icon" className="h-14 w-14 rounded-xl shrink-0" onClick={() => setQty(q => String(Math.max(1, (Math.floor(Number(q)) || 1) - 1)))} aria-label="Restar uno">
                <Minus size={18} />
              </Button>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={qty}
                onChange={e => setQty(e.target.value)}
                onFocus={e => e.target.select()}
                className="h-14 rounded-xl text-center text-2xl font-black"
                autoFocus
                aria-label="Cantidad a ingresar"
              />
              <Button type="button" variant="outline" size="icon" className="h-14 w-14 rounded-xl shrink-0" onClick={() => setQty(q => String((Math.floor(Number(q)) || 0) + 1))} aria-label="Sumar uno">
                <Plus size={18} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Hay <span className="font-black text-foreground">{current}</span> {unit}
              {validQty && <> → quedarán <span className="font-black text-primary">{current + quantity}</span></>}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Motivo</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_REASONS.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={cn(
                    'px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors',
                    reason === r ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="O escribe el motivo (ej: compra en ferretería, factura 1234)"
              className="rounded-xl min-h-[72px]"
            />
            {reason.length > 0 && !validReason && (
              <p className="text-xs text-destructive">Escribe un poco más (mínimo 5 letras).</p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving} className="rounded-xl">Cancelar</Button>
            <Button type="submit" disabled={saving || !validQty || !validReason} className="rounded-xl gap-2 shadow-lg shadow-primary/10">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />}
              Ingresar {validQty ? quantity : ''}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
