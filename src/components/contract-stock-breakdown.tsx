"use client";

/**
 * Desglose de existencias de un material por contrato (tabla material_stocks)
 * + acción de transferencia entre contratos (permiso stock:transfer).
 *
 * La ficha del material es única; este bloque muestra dónde están sus unidades:
 * contrato Torres, contrato Miscelánios, pool central (sin contrato), etc.
 */

import React, { useMemo, useState } from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import type { Contract, Material, MaterialStock } from '@/modules/core/lib/data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeftRight, Building2, Loader2, AlertTriangle } from 'lucide-react';

const POOL = '__pool__'; // valor del select para "pool central" (contract_id NULL)

export function ContractStockBreakdown({ material }: { material: Material }) {
    const { materialStocks, contracts, can, transferMaterialStock, notify } = useAppState();

    const [transferOpen, setTransferOpen] = useState(false);
    const [fromKey, setFromKey] = useState<string>(POOL);
    const [toKey, setToKey] = useState<string>('');
    const [qty, setQty] = useState<string>('');
    const [justification, setJustification] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const contractMap = useMemo(
        () => new Map(((contracts || []) as Contract[]).map((c) => [c.id, c])),
        [contracts]
    );
    const activeContracts = useMemo(
        () => ((contracts || []) as Contract[])
            .filter((c) => c.status === 'active')
            .sort((a, b) => a.name.localeCompare(b.name)),
        [contracts]
    );

    // Filas del material agregadas por contrato (los pañoles se suman entre sí).
    const rows = useMemo(() => {
        const acc = new Map<string, number>();
        ((materialStocks || []) as MaterialStock[])
            .filter((s) => s.materialId === material.id)
            .forEach((s) => {
                const key = s.contractId ?? POOL;
                acc.set(key, (acc.get(key) || 0) + s.qty);
            });
        return Array.from(acc.entries())
            .map(([key, total]) => ({
                key,
                contractId: key === POOL ? null : key,
                name: key === POOL ? 'Pool central' : contractMap.get(key)?.name || 'Contrato',
                qty: total,
            }))
            .sort((a, b) => (a.contractId === null ? -1 : b.contractId === null ? 1 : b.qty - a.qty));
    }, [materialStocks, material.id, contractMap]);

    const ledgerTotal = rows.reduce((acc, r) => acc + r.qty, 0);
    const hasDrift = ledgerTotal !== (material.stock || 0);
    const labelOf = (key: string) => (key === POOL ? 'Pool central' : contractMap.get(key)?.name || 'Contrato');

    const openTransfer = () => {
        const firstWithStock = rows.find((r) => r.qty > 0);
        setFromKey(firstWithStock?.key ?? POOL);
        setToKey('');
        setQty('');
        setJustification('');
        setTransferOpen(true);
    };

    const handleTransfer = async () => {
        const amount = Number(qty);
        if (!toKey || !amount || amount <= 0) {
            notify('Indica destino y una cantidad válida.', 'destructive');
            return;
        }
        setIsSubmitting(true);
        try {
            await transferMaterialStock({
                materialId: material.id,
                qty: amount,
                fromContractId: fromKey === POOL ? null : fromKey,
                toContractId: toKey === POOL ? null : toKey,
                justification: justification || undefined,
            });
            notify(`${amount} ${material.unit} transferidas a ${labelOf(toKey)}.`, 'success');
            setTransferOpen(false);
        } catch (err: any) {
            notify(err.message || 'No se pudo transferir.', 'destructive');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                    <Building2 size={14} className="text-primary" /> Existencias por Contrato
                </p>
                {can('stock:transfer') && rows.some((r) => r.qty > 0) && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={openTransfer}
                        className="rounded-xl gap-2 text-[9px] font-black uppercase tracking-widest"
                    >
                        <ArrowLeftRight size={12} /> Transferir
                    </Button>
                )}
            </div>

            {rows.length === 0 ? (
                <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                    Sin desglose registrado — el stock vive en el pool central.
                </p>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {rows.map((r) => (
                        <div
                            key={r.key}
                            className={`px-4 py-2.5 rounded-xl border flex items-center gap-3 ${
                                r.contractId === null ? 'bg-muted border-border' : 'bg-primary/5 border-primary/20'
                            }`}
                        >
                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                                {r.name}
                            </span>
                            <span className={`text-sm font-black ${r.contractId === null ? 'text-foreground' : 'text-primary'}`}>
                                {r.qty} <span className="text-[9px] font-bold uppercase">{material.unit}</span>
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {hasDrift && (
                <p className="text-[9px] font-black uppercase tracking-widest text-warning flex items-center gap-1.5">
                    <AlertTriangle size={12} />
                    El desglose ({ledgerTotal}) no cuadra con el stock total ({material.stock || 0}). Corrige con una transferencia o ajuste.
                </p>
            )}

            <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
                <DialogContent className="max-w-md bg-card sm:rounded-[2rem]">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-black uppercase flex items-center gap-2">
                            <ArrowLeftRight size={16} className="text-primary" /> Transferir Existencias
                        </DialogTitle>
                        <DialogDescription className="text-[10px] font-bold uppercase tracking-widest">
                            {material.name} — el total del inventario no cambia, solo su asignación.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Desde</Label>
                            <Select value={fromKey} onValueChange={setFromKey}>
                                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {rows.filter((r) => r.qty > 0).map((r) => (
                                        <SelectItem key={r.key} value={r.key}>
                                            {r.name} — {r.qty} {material.unit}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Hacia</Label>
                            <Select value={toKey} onValueChange={setToKey}>
                                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Selecciona destino…" /></SelectTrigger>
                                <SelectContent>
                                    {fromKey !== POOL && <SelectItem value={POOL}>Pool central (sin contrato)</SelectItem>}
                                    {activeContracts
                                        .filter((c) => c.id !== fromKey)
                                        .map((c) => (
                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                Cantidad ({material.unit})
                            </Label>
                            <Input
                                type="number"
                                min={1}
                                value={qty}
                                onChange={(e) => setQty(e.target.value)}
                                className="rounded-xl"
                                placeholder="0"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                Justificación (opcional)
                            </Label>
                            <Textarea
                                value={justification}
                                onChange={(e) => setJustification(e.target.value)}
                                className="rounded-xl min-h-[70px]"
                                placeholder="Ej: reasignación de EPP al contrato Torres"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setTransferOpen(false)} className="rounded-xl">
                            Cancelar
                        </Button>
                        <Button onClick={handleTransfer} disabled={isSubmitting} className="rounded-xl gap-2">
                            {isSubmitting && <Loader2 size={14} className="animate-spin" />}
                            Transferir
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
