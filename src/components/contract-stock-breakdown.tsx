"use client";

/**
 * Desglose de existencias de un material por contrato × pañol (tabla
 * material_stocks) + acción de transferencia (permiso stock:transfer).
 *
 * La ficha del material es única; este bloque muestra dónde están sus unidades:
 * contrato Torres en el pañol X, pool central (sin contrato) en la Bodega
 * Central, etc. Transferir sirve para asignarlas a un contrato, devolverlas al
 * pool o simplemente cambiarlas de pañol.
 */

import React, { useMemo, useState } from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import type { Contract, Material, MaterialStock, Warehouse } from '@/modules/core/lib/data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeftRight, Building2, Loader2, AlertTriangle } from 'lucide-react';
import { isRastreable } from '@/lib/api/mappers';

const POOL = '__pool__'; // valor del select para "pool central" (contract_id NULL)
const NO_WH = '__none__'; // valor del select para "sin pañol" (warehouse_id NULL)
const keyOf = (contractId: string | null, warehouseId: string | null) => `${contractId ?? POOL}|${warehouseId ?? NO_WH}`;

export function ContractStockBreakdown({ material }: { material: Material }) {
    const { materialStocks, contracts, warehouses, can, transferMaterialStock, notify } = useAppState();

    const [transferOpen, setTransferOpen] = useState(false);
    const [fromKey, setFromKey] = useState<string>(keyOf(null, null));
    const [toKey, setToKey] = useState<string>('');
    const [toWh, setToWh] = useState<string>(NO_WH);
    const [toTouched, setToTouched] = useState(false);
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

    const whMap = useMemo(
        () => new Map(((warehouses || []) as Warehouse[]).map((w) => [w.id, w.name])),
        [warehouses]
    );
    const activeWarehouses = useMemo(
        () => ((warehouses || []) as Warehouse[])
            .filter((w) => w.status === 'active')
            .sort((a, b) => a.name.localeCompare(b.name)),
        [warehouses]
    );

    // Filas del material por contrato × pañol.
    const rows = useMemo(() => {
        const acc = new Map<string, { contractId: string | null; warehouseId: string | null; qty: number }>();
        ((materialStocks || []) as MaterialStock[])
            .filter((s) => s.materialId === material.id)
            .forEach((s) => {
                const key = keyOf(s.contractId, s.warehouseId);
                const prev = acc.get(key);
                if (prev) prev.qty += s.qty;
                else acc.set(key, { contractId: s.contractId, warehouseId: s.warehouseId, qty: s.qty });
            });
        return Array.from(acc.entries())
            .map(([key, r]) => ({
                key,
                ...r,
                name: r.contractId === null ? 'Pool central' : contractMap.get(r.contractId)?.name || 'Contrato',
                panol: r.warehouseId ? whMap.get(r.warehouseId) || 'Pañol' : 'Sin pañol',
            }))
            .sort((a, b) => (a.contractId === null ? -1 : b.contractId === null ? 1 : b.qty - a.qty));
    }, [materialStocks, material.id, contractMap, whMap]);

    const ledgerTotal = rows.reduce((acc, r) => acc + r.qty, 0);
    const hasDrift = ledgerTotal !== (material.stock || 0);
    // Un activo (cada unidad con su QR) llega a un contrato SOLO por una solicitud de
    // material: queda la autorización, quién lo recibió y la fecha. Aquí sólo se puede
    // cambiar de pañol o devolverlo al pool central.
    const isAsset = isRastreable(material.usageType);
    const labelOf = (key: string) => (key === POOL ? 'Pool central' : contractMap.get(key)?.name || 'Contrato');
    const [fromContract, fromWh] = fromKey.split('|');
    // Un consumible que cambia de contrato lleva su costo al contrato de destino (un activo no:
    // sólo cambia de lugar). Es la excepción, no el movimiento normal.
    const reassignsCost = !isAsset && !!toKey && toKey !== fromContract;

    const openTransfer = () => {
        const firstWithStock = rows.find((r) => r.qty > 0);
        setFromKey(firstWithStock?.key ?? keyOf(null, null));
        // Por defecto el MISMO contrato: lo habitual es sólo cambiar de pañol. Cambiar de contrato
        // reasigna el costo de las unidades y se pide expresamente.
        setToKey(!isAsset && firstWithStock ? (firstWithStock.contractId ?? POOL) : POOL);
        setToTouched(false);
        setToWh(NO_WH);
        // Una unidad con identidad propia (activo) se mueve de a una.
        setQty(Number(material.stock) === 1 ? '1' : '');
        setJustification('');
        setTransferOpen(true);
    };

    const handleTransfer = async () => {
        const amount = Number(qty);
        if (!toKey || !amount || amount <= 0) {
            notify('Indica destino y una cantidad válida.', 'destructive');
            return;
        }
        if (toKey === fromContract && toWh === fromWh) {
            notify('El destino es el mismo lugar de origen: cambia el pañol (o reasigna el contrato).', 'destructive');
            return;
        }
        if (reassignsCost && !justification.trim()) {
            notify('Cambiar de contrato reasigna el costo: indica el motivo en la justificación.', 'destructive');
            return;
        }
        setIsSubmitting(true);
        try {
            await transferMaterialStock({
                materialId: material.id,
                qty: amount,
                fromContractId: fromContract === POOL ? null : fromContract,
                fromWarehouseId: fromWh === NO_WH ? null : fromWh,
                toContractId: toKey === POOL ? null : toKey,
                warehouseId: toWh === NO_WH ? null : toWh,
                justification: justification || undefined,
            });
            notify(`${amount} ${material.unit} transferidas a ${labelOf(toKey)}${toWh === NO_WH ? '' : ' · ' + (whMap.get(toWh) || 'pañol')}.`, 'success');
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
                    <Building2 size={14} className="text-primary" /> Existencias por Contrato y Pañol
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
                                {r.name} · {r.panol}
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
                            <Select value={fromKey} onValueChange={(v) => { setFromKey(v); if (!toTouched && !isAsset) setToKey(v.split('|')[0]); }}>
                                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {rows.filter((r) => r.qty > 0).map((r) => (
                                        <SelectItem key={r.key} value={r.key}>
                                            {r.name} · {r.panol} — {r.qty} {material.unit}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Contrato dueño del costo</Label>
                            <Select value={toKey} onValueChange={(v) => { setToKey(v); setToTouched(true); }}>
                                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Selecciona destino…" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={POOL}>Pool central (sin contrato){fromContract === POOL ? ' — el mismo' : ''}</SelectItem>
                                    {!isAsset && activeContracts.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}{fromContract === c.id ? ' — el mismo' : ''}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {reassignsCost && (
                                <p className="text-[10px] font-bold uppercase tracking-widest text-warning">
                                    Cambiar de contrato mueve el costo de estas unidades al contrato de destino. Para sólo cambiarlas de pañol, deja el mismo contrato.
                                </p>
                            )}
                            {isAsset && (
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                    Para entregarlo a un contrato o faena usa una solicitud de material.
                                </p>
                            )}
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pañol de destino</Label>
                            <Select value={toWh} onValueChange={setToWh}>
                                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NO_WH}>Sin pañol</SelectItem>
                                    {activeWarehouses.map((w) => (
                                        <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
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
                                {reassignsCost ? 'Justificación (obligatoria al cambiar de contrato)' : 'Justificación (opcional)'}
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
