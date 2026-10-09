'use client';

import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { isValidRut, formatRut } from '@/lib/rut';
import type { PurchaseRequest, Supplier } from '@/modules/core/lib/data';
import { cn } from '@/lib/utils';
import { Loader2, Receipt } from 'lucide-react';

/**
 * RFC-006 F3 — Registrar una compra que YA se hizo por fuera (reemplaza a
 * "Finalizar lote manualmente"). Pide el respaldo: factura o boleta, empresa con
 * RUT y quién compró. Los pedidos quedan listos para que el pañol los reciba.
 */
export function DirectPurchaseDialog({
  open,
  onClose,
  lotId,
  title,
  requests,
}: {
  open: boolean;
  onClose: () => void;
  lotId?: string | null;
  title: string;
  requests: PurchaseRequest[];
}) {
  const { suppliers, users, registerDirectPurchase } = useAppState();
  const { user } = useAuth();
  const { toast } = useToast();
  const [docType, setDocType] = useState<'factura' | 'boleta'>('factura');
  const [docNumber, setDocNumber] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierRut, setSupplierRut] = useState('');
  const [buyerId, setBuyerId] = useState(user?.id || '');
  const [saving, setSaving] = useState(false);

  const people = useMemo(
    () => ((users || []) as any[]).filter(u => u.isActive !== false).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [users],
  );
  const buyer = people.find(u => u.id === buyerId);
  const rutOk = isValidRut(supplierRut);
  const valid = docNumber.trim().length > 0 && supplierName.trim().length >= 2 && rutOk && !!buyer;

  const pickSupplier = (id: string) => {
    setSupplierId(id);
    const s = ((suppliers || []) as Supplier[]).find(x => x.id === id);
    if (s) {
      setSupplierName(s.name);
      setSupplierRut(s.rut || '');
    }
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await registerDirectPurchase({
        lotId: lotId || null,
        requestIds: requests.map(r => r.id),
        docType,
        docNumber,
        supplierName,
        supplierRut,
        buyerId: buyer.id,
        buyerName: buyer.name,
      });
      toast({ title: 'Compra registrada', description: 'Los pedidos quedaron listos para que el pañol los reciba e ingrese al inventario.' });
      onClose();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo registrar', description: e?.message || 'Error inesperado.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-lg rounded-[1.5rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Receipt className="h-5 w-5 text-primary" /> Registrar compra ya realizada</DialogTitle>
          <DialogDescription>
            {title}: para compras que ya se hicieron y hay que ingresar al inventario. Queda registrado con su
            documento y no se puede editar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border divide-y text-sm">
            {requests.map(r => (
              <div key={r.id} className="flex justify-between gap-3 px-3 py-2">
                <span className="truncate">{r.materialName}</span>
                <span className="text-muted-foreground shrink-0">{r.quantity} {r.unit}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-[140px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label>Documento</Label>
              <Select value={docType} onValueChange={v => setDocType(v as any)}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="factura">Factura</SelectItem>
                  <SelectItem value="boleta">Boleta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dp-number">Número</Label>
              <Input id="dp-number" value={docNumber} onChange={e => setDocNumber(e.target.value)} placeholder="Ej: 104582" className="rounded-xl" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Empresa</Label>
            <Select value={supplierId || 'otro'} onValueChange={v => (v === 'otro' ? (setSupplierId(''), setSupplierName(''), setSupplierRut('')) : pickSupplier(v))}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Elige un proveedor o escribe otro" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="otro">Otra empresa (escribir)</SelectItem>
                {((suppliers || []) as Supplier[]).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[1fr_160px] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dp-name">Nombre de la empresa</Label>
              <Input id="dp-name" value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="Ej: Ferretería El Minero" className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dp-rut">RUT</Label>
              <Input
                id="dp-rut"
                value={supplierRut}
                onChange={e => setSupplierRut(e.target.value)}
                onBlur={() => rutOk && setSupplierRut(formatRut(supplierRut))}
                placeholder="76.412.380-8"
                className={cn('rounded-xl', supplierRut && !rutOk && 'border-destructive')}
              />
              {supplierRut && !rutOk && <p className="text-[11px] text-destructive">RUT no válido</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Quién hizo la compra</Label>
            <Select value={buyerId} onValueChange={setBuyerId}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Elige a la persona" /></SelectTrigger>
              <SelectContent>
                {people.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" className="rounded-xl" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="rounded-xl gap-2" onClick={save} disabled={saving || !valid}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />} Registrar compra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
