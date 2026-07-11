"use client";

import { useMemo, useState } from 'react';
import * as ExcelJS from 'exceljs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
    ArrowUpRight, ArrowDownRight, Search, FileSpreadsheet, History, CheckCircle2, Loader2,
} from 'lucide-react';
import { DisplayTransaction, STAGE_META } from './report-utils';
import type { ReportData } from './use-report-data';

const PAGE_SIZE = 50;

type RangePreset = '7D' | '30D' | 'MONTH' | 'ALL';

function presetRange(preset: RangePreset): { from: Date | null; to: Date | null } {
    const now = new Date();
    switch (preset) {
        case '7D': return { from: new Date(now.getTime() - 7 * 86400000), to: null };
        case '30D': return { from: new Date(now.getTime() - 30 * 86400000), to: null };
        case 'MONTH': return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
        default: return { from: null, to: null };
    }
}

export function AuditTab({ data }: { data: ReportData }) {
    const { transactions, usersMap } = data;
    const { toast } = useToast();

    const [preset, setPreset] = useState<RangePreset>('30D');
    const [fromStr, setFromStr] = useState('');
    const [toStr, setToStr] = useState('');
    const [typeFilter, setTypeFilter] = useState<'ALL' | 'WITHDRAWAL' | 'RETURN'>('ALL');
    const [personQuery, setPersonQuery] = useState('');
    const [page, setPage] = useState(0);
    const [isExporting, setIsExporting] = useState(false);

    const filtered = useMemo(() => {
        // Fechas manuales mandan; si no hay, aplica el preset.
        let from: Date | null;
        let to: Date | null;
        if (fromStr || toStr) {
            from = fromStr ? new Date(`${fromStr}T00:00:00`) : null;
            to = toStr ? new Date(`${toStr}T23:59:59`) : null;
        } else {
            ({ from, to } = presetRange(preset));
        }
        const q = personQuery.trim().toLowerCase();
        return transactions.filter(tx => {
            if (from && tx.timestamp < from) return false;
            if (to && tx.timestamp > to) return false;
            if (typeFilter !== 'ALL' && tx.type !== typeFilter) return false;
            if (q && !tx.holderName.toLowerCase().includes(q)
                && !(tx.requesterName || '').toLowerCase().includes(q)
                && !(tx.internalCode || '').toLowerCase().includes(q)) return false;
            return true;
        });
    }, [transactions, preset, fromStr, toStr, typeFilter, personQuery]);

    // Volver a página 0 cuando cambia el filtro (derivado, sin effect).
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount - 1);
    const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

    const confirmedCount = useMemo(() => filtered.filter(t => t.isConfirmed).length, [filtered]);

    const setFilterAndReset = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(0); };

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const workbook = new ExcelJS.Workbook();
            const ws = workbook.addWorksheet('Auditoría');
            ws.columns = [
                { header: 'Código', key: 'code', width: 18 },
                { header: 'Tipo', key: 'type', width: 12 },
                { header: 'Estado', key: 'stage', width: 20 },
                { header: 'Fecha', key: 'date', width: 12 },
                { header: 'Hora', key: 'time', width: 8 },
                { header: 'Custodio', key: 'holder', width: 28 },
                { header: 'RUT', key: 'rut', width: 14 },
                { header: 'Solicitado por', key: 'requester', width: 28 },
                { header: 'Sitio / Destino', key: 'site', width: 22 },
                { header: 'Contrato', key: 'contract', width: 22 },
                { header: 'Ítems', key: 'items', width: 8 },
                { header: 'Confirmado', key: 'confirmed', width: 12 },
            ];
            ws.getRow(1).font = { bold: true };
            filtered.forEach((tx: DisplayTransaction) => {
                ws.addRow({
                    code: tx.internalCode || tx.id.substring(0, 8).toUpperCase(),
                    type: tx.type === 'WITHDRAWAL' ? 'DESPACHO' : 'RETORNO',
                    stage: STAGE_META[tx.stage].label,
                    date: tx.timestamp.toLocaleDateString('es-CL'),
                    time: tx.timestamp.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
                    holder: tx.holderName,
                    rut: usersMap.get(tx.holderId)?.rut || '—',
                    requester: tx.requesterName || tx.holderName,
                    site: tx.site || '—',
                    contract: tx.contractName || '—',
                    items: tx.itemCount,
                    confirmed: tx.isConfirmed ? 'SÍ' : 'NO',
                });
            });
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Auditoria_PAGNOL_${new Date().toISOString().split('T')[0]}.xlsx`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Error al exportar auditoría:', e);
            toast({ variant: 'destructive', title: 'Error de exportación' });
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="space-y-8 animate-in slide-in-from-bottom-4">
            {/* FILTROS */}
            <div className="flex flex-wrap items-end gap-4 bg-card p-6 sm:p-8 rounded-[2rem] border shadow-sm">
                <div className="flex items-center gap-1 bg-muted/50 border rounded-xl p-1">
                    {([['7D', '7 días'], ['30D', '30 días'], ['MONTH', 'Este mes'], ['ALL', 'Todo']] as [RangePreset, string][]).map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => { setPreset(key); setFromStr(''); setToStr(''); setPage(0); }}
                            className={cn(
                                'px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all',
                                preset === key && !fromStr && !toStr ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <div className="flex flex-col space-y-2">
                    <label className="text-[9px] font-black text-muted-foreground uppercase tracking-widest ml-1">Desde</label>
                    <Input type="date" value={fromStr} onChange={e => { setFromStr(e.target.value); setPage(0); }} className="h-10 rounded-xl w-40 text-xs" />
                </div>
                <div className="flex flex-col space-y-2">
                    <label className="text-[9px] font-black text-muted-foreground uppercase tracking-widest ml-1">Hasta</label>
                    <Input type="date" value={toStr} onChange={e => { setToStr(e.target.value); setPage(0); }} className="h-10 rounded-xl w-40 text-xs" />
                </div>
                <div className="flex flex-col space-y-2">
                    <label className="text-[9px] font-black text-muted-foreground uppercase tracking-widest ml-1">Operación</label>
                    <Select value={typeFilter} onValueChange={setFilterAndReset(setTypeFilter) as (v: string) => void}>
                        <SelectTrigger className="h-10 rounded-xl w-40 text-[10px] font-bold uppercase tracking-widest bg-muted/50"><SelectValue /></SelectTrigger>
                        <SelectContent className="rounded-xl">
                            <SelectItem value="ALL">TODAS</SelectItem>
                            <SelectItem value="WITHDRAWAL">DESPACHOS</SelectItem>
                            <SelectItem value="RETURN">RETORNOS</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col space-y-2 flex-1 min-w-[200px]">
                    <label className="text-[9px] font-black text-muted-foreground uppercase tracking-widest ml-1">Persona o código</label>
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                        <Input
                            value={personQuery}
                            onChange={e => { setPersonQuery(e.target.value); setPage(0); }}
                            placeholder="Buscar por custodio, solicitante o código..."
                            className="h-10 rounded-xl pl-10 text-xs"
                        />
                    </div>
                </div>
                <Button onClick={handleExport} disabled={isExporting || filtered.length === 0} variant="outline" className="h-10 rounded-xl gap-2 text-[10px] font-black uppercase tracking-widest">
                    {isExporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Exportar Excel
                </Button>
            </div>

            <Card className="rounded-[3rem] border-none shadow-2xl bg-card overflow-hidden">
                <div className="p-8 sm:p-10 border-b flex flex-wrap items-center justify-between gap-4 bg-muted">
                    <div>
                        <h3 className="text-xl font-black uppercase tracking-tight">Registro Maestro de Transacciones</h3>
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mt-1">Despachos y retornos del período seleccionado</p>
                    </div>
                    <div className="flex gap-4">
                        <div className="text-center px-6 py-2 bg-card rounded-2xl border">
                            <p className="text-sm font-black text-foreground">{filtered.length}</p>
                            <p className="text-[8px] font-black uppercase text-muted-foreground">Operaciones</p>
                        </div>
                        <div className="text-center px-6 py-2 bg-card rounded-2xl border">
                            <p className="text-sm font-black text-success">{confirmedCount}</p>
                            <p className="text-[8px] font-black uppercase text-muted-foreground">Confirmadas</p>
                        </div>
                    </div>
                </div>
                <div className="overflow-x-auto no-scrollbar">
                    <table className="w-full text-left min-w-[900px]">
                        <thead className="bg-muted border-b">
                            <tr>
                                <th className="px-8 py-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Código</th>
                                <th className="px-8 py-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Operación</th>
                                <th className="px-8 py-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Fecha y Hora</th>
                                <th className="px-8 py-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Custodio</th>
                                <th className="px-8 py-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Sitio / Contrato</th>
                                <th className="px-8 py-5 text-[9px] font-black uppercase tracking-widest text-center text-muted-foreground">Estado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {pageRows.map(tx => (
                                <tr key={tx.id} className="hover:bg-muted transition-colors group">
                                    <td className="px-8 py-5">
                                        <span className="font-mono text-xs font-black text-foreground group-hover:text-pagnol-orange transition-colors tracking-wider">
                                            {tx.internalCode || tx.id.substring(0, 8).toUpperCase()}
                                        </span>
                                        <p className="text-[9px] text-muted-foreground font-bold mt-1">{tx.itemCount} ítem(s)</p>
                                    </td>
                                    <td className="px-8 py-5">
                                        <div className={cn(
                                            'flex items-center gap-2.5 text-[10px] font-black uppercase px-3 py-1.5 rounded-xl w-fit border',
                                            tx.type === 'WITHDRAWAL' ? 'bg-pagnol-orange/10 text-pagnol-orange border-pagnol-orange/20' : 'bg-success-subtle text-success border-success/30',
                                        )}>
                                            {tx.type === 'WITHDRAWAL' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                                            {tx.type === 'WITHDRAWAL' ? 'DESPACHO' : 'RETORNO'}
                                        </div>
                                    </td>
                                    <td className="px-8 py-5 text-[10px] font-bold text-muted-foreground whitespace-nowrap">
                                        {tx.timestamp.toLocaleDateString('es-CL')} <span className="opacity-30 mx-1">|</span> {tx.timestamp.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    <td className="px-8 py-5">
                                        <p className="font-black text-xs uppercase text-foreground">{tx.holderName}</p>
                                        <p className="text-[9px] text-muted-foreground font-bold uppercase mt-1">
                                            {usersMap.get(tx.holderId)?.rut || usersMap.get(tx.holderId)?.role || '—'}
                                            {tx.requesterName && <span className="normal-case"> · solicitó {tx.requesterName}</span>}
                                        </p>
                                    </td>
                                    <td className="px-8 py-5">
                                        <Badge variant="outline" className="text-[9px] font-black uppercase border-border">{tx.site || '—'}</Badge>
                                        {tx.contractName && <p className="text-[9px] text-muted-foreground font-bold uppercase mt-1.5">{tx.contractName}</p>}
                                    </td>
                                    <td className="px-8 py-5">
                                        <div className="flex justify-center items-center gap-2">
                                            <span className={cn('px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest', STAGE_META[tx.stage].cls)}>
                                                {STAGE_META[tx.stage].label}
                                            </span>
                                            {tx.isConfirmed && <CheckCircle2 size={14} className="text-success shrink-0" />}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filtered.length === 0 && (
                        <div className="p-10">
                            <EmptyState
                                icon={<History size={24} />}
                                title="Sin operaciones en el período"
                                description="Ajusta el rango de fechas o los filtros para ver movimientos."
                            />
                        </div>
                    )}
                </div>
                {filtered.length > PAGE_SIZE && (
                    <div className="flex items-center justify-between px-10 py-5 border-t bg-muted/30">
                        <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">
                            {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} de {filtered.length}
                        </p>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" className="h-9 rounded-xl text-xs font-black uppercase" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0}>
                                ← Anterior
                            </Button>
                            <span className="text-[10px] font-black text-muted-foreground px-2">Pág. {safePage + 1} / {pageCount}</span>
                            <Button variant="outline" size="sm" className="h-9 rounded-xl text-xs font-black uppercase" onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))} disabled={safePage >= pageCount - 1}>
                                Siguiente →
                            </Button>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
}
