"use client";

import React, { useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { Contract, Material, MaterialStock, StockMovement, Warehouse } from "@/modules/core/lib/data";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ClientContractFilter, contractIdsOfClient, CC_ALL, CC_POOL } from "@/components/client-contract-filter";
import {
    ArrowDownRight, ArrowLeftRight, ArrowUpRight, FileDown, Loader2, Package, PieChart, Search, Warehouse as WarehouseIcon,
} from "lucide-react";
import * as ExcelJS from "exceljs";

const POOL = "__pool__"; // valor del filtro para pool central / sin pañol
const ALL = "__all__";

const fmtCLP = (v: number) => `$${Math.round(v).toLocaleString("es-CL")}`;
const fmtQty = (v: number) => Number(v).toLocaleString("es-CL");
const isoDay = (d: Date) => d.toISOString().split("T")[0];

const MOVEMENT_TYPE_LABEL: Record<string, string> = {
    "manual-entry": "Ingreso manual",
    "initial": "Alta inicial",
    "request-delivery": "Entrega",
    "return-reentry": "Devolución",
    "adjustment": "Ajuste",
    "contract-transfer": "Transferencia",
};

export default function ContractStockReportPage() {
    const { materialStocks, contracts, warehouses, materials, stockMovements } = useAppState();
    const { toast } = useToast();

    const [clientFilter, setClientFilter] = useState(CC_ALL);
    const [contractFilter, setContractFilter] = useState(CC_ALL);
    const [warehouseFilter, setWarehouseFilter] = useState(ALL);
    const [searchTerm, setSearchTerm] = useState("");
    const [dateFrom, setDateFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 24 * 3600 * 1000)));
    const [dateTo, setDateTo] = useState(() => isoDay(new Date()));
    const [isExporting, setIsExporting] = useState(false);

    const materialsMap = useMemo(
        () => new Map(((materials || []) as Material[]).map((m) => [m.id, m])),
        [materials],
    );
    const contractsMap = useMemo(
        () => new Map(((contracts || []) as Contract[]).map((c) => [c.id, c])),
        [contracts],
    );
    const warehousesMap = useMemo(
        () => new Map(((warehouses || []) as Warehouse[]).map((w) => [w.id, w])),
        [warehouses],
    );

    const contractLabel = (cid: string | null) =>
        cid === null ? "Pool central" : contractsMap.get(cid)?.name || "Contrato eliminado";
    const warehouseLabel = (wid: string | null) =>
        wid === null ? "Sin pañol" : warehousesMap.get(wid)?.name || "Pañol eliminado";

    // Predicado de la cascada Cliente→Contrato: contrato puntual (o pool) manda;
    // si solo hay cliente, la unión de sus contratos. null = sin filtro.
    const allowedContract = useMemo(() => {
        if (contractFilter !== CC_ALL) {
            return contractFilter === CC_POOL
                ? (cid: string | null) => cid === null
                : (cid: string | null) => cid === contractFilter;
        }
        if (clientFilter !== CC_ALL) {
            const ids = contractIdsOfClient((contracts || []) as Contract[], clientFilter);
            return (cid: string | null) => cid !== null && ids.has(cid);
        }
        return null;
    }, [contractFilter, clientFilter, contracts]);

    // Filas del ledger con qty > 0 (base de matriz, detalle y valorización).
    // Escopadas por la cascada: la página entera pasa a ser "vista general /
    // por cliente / por contrato" (tarjetas de valorización y matriz incluidas).
    const ledger = useMemo(
        () => ((materialStocks || []) as MaterialStock[])
            .filter((s) => Number(s.qty) > 0 && (!allowedContract || allowedContract(s.contractId))),
        [materialStocks, allowedContract],
    );

    // Columnas de contrato presentes en el ledger (contratos con existencias + pool).
    const contractColumns = useMemo(() => {
        const ids = new Set<string | null>();
        for (const s of ledger) ids.add(s.contractId);
        const withStock = [...ids].filter((id): id is string => id !== null)
            .sort((a, b) => contractLabel(a).localeCompare(contractLabel(b)));
        return { contracts: withStock, hasPool: ids.has(null) };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ledger, contractsMap]);

    // ── Valorización por contrato ─────────────────────────────────────────────
    const valuation = useMemo(() => {
        const byContract = new Map<string | null, { qty: number; value: number; unpriced: number }>();
        let totalValue = 0;
        const unpricedMaterials = new Set<string>();
        for (const s of ledger) {
            const mat = materialsMap.get(s.materialId);
            const entry = byContract.get(s.contractId) || { qty: 0, value: 0, unpriced: 0 };
            entry.qty += Number(s.qty);
            if (mat?.unitCost) {
                const v = Number(s.qty) * mat.unitCost;
                entry.value += v;
                totalValue += v;
            } else {
                entry.unpriced += Number(s.qty);
                if (mat) unpricedMaterials.add(mat.id);
            }
            byContract.set(s.contractId, entry);
        }
        const rows = [...byContract.entries()]
            .map(([cid, e]) => ({ contractId: cid, label: contractLabel(cid), ...e }))
            .sort((a, b) => b.value - a.value || b.qty - a.qty);
        return { rows, totalValue, unpricedCount: unpricedMaterials.size };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ledger, materialsMap, contractsMap]);

    // ── Matriz material × contrato ────────────────────────────────────────────
    interface MatrixRow {
        materialId: string;
        name: string;
        unit: string;
        byContract: Map<string | null, number>;
        total: number;
        value: number | null; // null = sin costo unitario
    }
    const matrixRows = useMemo(() => {
        const map = new Map<string, MatrixRow>();
        for (const s of ledger) {
            const mat = materialsMap.get(s.materialId);
            const row = map.get(s.materialId) || {
                materialId: s.materialId,
                name: mat?.name || "Material eliminado",
                unit: mat?.unit || "und",
                byContract: new Map<string | null, number>(),
                total: 0,
                value: mat?.unitCost ? 0 : null,
            };
            row.byContract.set(s.contractId, (row.byContract.get(s.contractId) || 0) + Number(s.qty));
            row.total += Number(s.qty);
            if (mat?.unitCost && row.value !== null) row.value += Number(s.qty) * mat.unitCost;
            map.set(s.materialId, row);
        }
        let rows = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            rows = rows.filter((r) => r.name.toLowerCase().includes(q));
        }
        return rows;
    }, [ledger, materialsMap, searchTerm]);

    // ── Detalle por pañol (filas planas material × contrato × pañol) ─────────
    const detailRows = useMemo(() => {
        let rows = ledger.map((s) => {
            const mat = materialsMap.get(s.materialId);
            return {
                id: s.id,
                name: mat?.name || "Material eliminado",
                unit: mat?.unit || "und",
                contractId: s.contractId,
                warehouseId: s.warehouseId,
                qty: Number(s.qty),
                value: mat?.unitCost ? Number(s.qty) * mat.unitCost : null,
            };
        });
        // El filtro Cliente/Contrato ya viene aplicado en `ledger`.
        if (warehouseFilter !== ALL) {
            const target = warehouseFilter === POOL ? null : warehouseFilter;
            rows = rows.filter((r) => r.warehouseId === target);
        }
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            rows = rows.filter((r) => r.name.toLowerCase().includes(q));
        }
        return rows.sort((a, b) => a.name.localeCompare(b.name) || (b.qty - a.qty));
    }, [ledger, materialsMap, warehouseFilter, searchTerm]);

    // ── Kardex por contrato (período) ─────────────────────────────────────────
    const kardex = useMemo(() => {
        const from = new Date(dateFrom + "T00:00:00");
        const to = new Date(dateTo + "T23:59:59.999");
        let rows = ((stockMovements || []) as StockMovement[]).filter((m) => {
            const d = new Date(m.date);
            return d >= from && d <= to;
        });
        if (allowedContract) {
            rows = rows.filter((m) => allowedContract(m.contractId ?? null));
        }
        if (warehouseFilter !== ALL) {
            const target = warehouseFilter === POOL ? null : warehouseFilter;
            rows = rows.filter((m) => (m.warehouseId ?? null) === target);
        }
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            rows = rows.filter((m) => m.materialName.toLowerCase().includes(q));
        }
        rows = [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const inflow = rows.filter((m) => m.quantityChange > 0).reduce((a, m) => a + m.quantityChange, 0);
        const outflow = rows.filter((m) => m.quantityChange < 0).reduce((a, m) => a + Math.abs(m.quantityChange), 0);
        return { rows, inflow, outflow, net: inflow - outflow };
    }, [stockMovements, allowedContract, warehouseFilter, searchTerm, dateFrom, dateTo]);

    // ── Export Excel (3 hojas) ────────────────────────────────────────────────
    const handleExport = async () => {
        setIsExporting(true);
        try {
            const wb = new ExcelJS.Workbook();
            const header = { font: { bold: true }, fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEFEFEF" } } };

            const wsVal = wb.addWorksheet("Valorización");
            wsVal.columns = [
                { header: "Contrato", key: "c", width: 34 },
                { header: "Unidades", key: "q", width: 14 },
                { header: "Valorización (CLP)", key: "v", width: 20 },
                { header: "Unidades sin costo", key: "u", width: 18 },
            ];
            wsVal.getRow(1).eachCell((c) => Object.assign(c, header));
            for (const r of valuation.rows) wsVal.addRow({ c: r.label, q: r.qty, v: Math.round(r.value), u: r.unpriced });
            wsVal.addRow({ c: "TOTAL", q: valuation.rows.reduce((a, r) => a + r.qty, 0), v: Math.round(valuation.totalValue) }).font = { bold: true };

            const wsMx = wb.addWorksheet("Matriz por contrato");
            const cols = [
                { header: "Material", key: "name", width: 40 },
                { header: "Unidad", key: "unit", width: 10 },
                ...contractColumns.contracts.map((cid, i) => ({ header: contractLabel(cid), key: `c${i}`, width: 18 })),
                ...(contractColumns.hasPool ? [{ header: "Pool central", key: "pool", width: 14 }] : []),
                { header: "Total", key: "total", width: 12 },
                { header: "Valorización (CLP)", key: "value", width: 20 },
            ];
            wsMx.columns = cols;
            wsMx.getRow(1).eachCell((c) => Object.assign(c, header));
            for (const r of matrixRows) {
                const row: Record<string, unknown> = { name: r.name, unit: r.unit, total: r.total, value: r.value === null ? "—" : Math.round(r.value) };
                contractColumns.contracts.forEach((cid, i) => { row[`c${i}`] = r.byContract.get(cid) || 0; });
                if (contractColumns.hasPool) row.pool = r.byContract.get(null) || 0;
                wsMx.addRow(row);
            }

            const wsKx = wb.addWorksheet("Kardex del período");
            wsKx.columns = [
                { header: "Fecha", key: "d", width: 18 },
                { header: "Tipo", key: "t", width: 16 },
                { header: "Material", key: "m", width: 40 },
                { header: "Cambio", key: "q", width: 10 },
                { header: "Contrato", key: "c", width: 26 },
                { header: "Pañol", key: "w", width: 20 },
                { header: "Usuario", key: "u", width: 24 },
                { header: "Justificación", key: "j", width: 60 },
            ];
            wsKx.getRow(1).eachCell((c) => Object.assign(c, header));
            for (const m of kardex.rows) {
                wsKx.addRow({
                    d: new Date(m.date).toLocaleString("es-CL"),
                    t: MOVEMENT_TYPE_LABEL[m.type] || m.type,
                    m: m.materialName,
                    q: m.quantityChange,
                    c: contractLabel(m.contractId ?? null),
                    w: m.warehouseId ? warehouseLabel(m.warehouseId) : "—",
                    u: m.userName,
                    j: m.justification,
                });
            }

            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `stock_por_contrato_${isoDay(new Date())}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            toast({ title: "Reporte exportado", description: "Se descargó el Excel con valorización, matriz y kardex." });
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error al exportar", description: error?.message || "No se pudo generar el Excel." });
        } finally {
            setIsExporting(false);
        }
    };

    // ── Columnas de tablas ────────────────────────────────────────────────────
    const matrixColumns: DataTableColumn<MatrixRow>[] = [
        {
            key: "name",
            header: "Material",
            cell: (r) => (
                <div>
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.unit}</p>
                </div>
            ),
        },
        ...contractColumns.contracts.map((cid): DataTableColumn<MatrixRow> => ({
            key: cid,
            header: contractLabel(cid),
            headerClassName: "text-right",
            className: "text-right",
            cell: (r) => {
                const qty = r.byContract.get(cid) || 0;
                return qty > 0
                    ? <span className="font-semibold">{fmtQty(qty)}</span>
                    : <span className="text-muted-foreground/50">—</span>;
            },
        })),
        ...(contractColumns.hasPool ? [{
            key: "pool",
            header: "Pool central",
            headerClassName: "text-right",
            className: "text-right",
            cell: (r: MatrixRow) => {
                const qty = r.byContract.get(null) || 0;
                return qty > 0
                    ? <span className="text-warning-subtle-foreground font-semibold">{fmtQty(qty)}</span>
                    : <span className="text-muted-foreground/50">—</span>;
            },
        }] : []),
        {
            key: "total",
            header: "Total",
            headerClassName: "text-right",
            className: "text-right",
            cell: (r) => <span className="font-bold">{fmtQty(r.total)}</span>,
        },
        {
            key: "value",
            header: "Valorización",
            headerClassName: "text-right",
            className: "text-right",
            cell: (r) => r.value === null
                ? <span className="text-xs text-muted-foreground">Sin costo unit.</span>
                : <span className="font-semibold">{fmtCLP(r.value)}</span>,
        },
    ];

    const detailColumns: DataTableColumn<(typeof detailRows)[number]>[] = [
        {
            key: "name",
            header: "Material",
            cell: (r) => (
                <div>
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.unit}</p>
                </div>
            ),
        },
        {
            key: "contract",
            header: "Contrato",
            cell: (r) => r.contractId
                ? <Badge variant="outline" className="rounded-xl text-[10px] font-bold">{contractLabel(r.contractId)}</Badge>
                : <span className="badge-warning">Pool central</span>,
        },
        {
            key: "warehouse",
            header: "Pañol",
            cell: (r) => r.warehouseId
                ? <span className="text-sm">{warehouseLabel(r.warehouseId)}</span>
                : <span className="text-sm text-muted-foreground">Sin pañol</span>,
        },
        {
            key: "qty",
            header: "Cantidad",
            headerClassName: "text-right",
            className: "text-right",
            cell: (r) => <span className="font-bold">{fmtQty(r.qty)}</span>,
        },
        {
            key: "value",
            header: "Valorización",
            headerClassName: "text-right",
            className: "text-right",
            cell: (r) => r.value === null
                ? <span className="text-xs text-muted-foreground">Sin costo unit.</span>
                : <span className="font-semibold">{fmtCLP(r.value)}</span>,
        },
    ];

    const kardexColumns: DataTableColumn<StockMovement>[] = [
        {
            key: "date",
            header: "Fecha",
            cell: (m) => <span className="text-xs whitespace-nowrap">{new Date(m.date).toLocaleString("es-CL")}</span>,
        },
        {
            key: "type",
            header: "Tipo",
            cell: (m) => {
                const label = MOVEMENT_TYPE_LABEL[m.type] || m.type;
                if (m.type === "contract-transfer") return <span className="badge-info">{label}</span>;
                return m.quantityChange >= 0
                    ? <span className="badge-success">{label}</span>
                    : <span className="badge-warning">{label}</span>;
            },
        },
        {
            key: "material",
            header: "Material",
            cell: (m) => <span className="font-semibold text-sm">{m.materialName}</span>,
        },
        {
            key: "qty",
            header: "Cambio",
            headerClassName: "text-right",
            className: "text-right",
            cell: (m) => (
                <span className={`font-bold ${m.quantityChange >= 0 ? "text-success" : "text-destructive"}`}>
                    {m.quantityChange > 0 ? `+${fmtQty(m.quantityChange)}` : fmtQty(m.quantityChange)}
                </span>
            ),
        },
        {
            key: "contract",
            header: "Contrato",
            cell: (m) => m.contractId
                ? <Badge variant="outline" className="rounded-xl text-[10px] font-bold">{m.contractName || contractLabel(m.contractId)}</Badge>
                : <span className="text-xs text-muted-foreground">Pool central</span>,
        },
        {
            key: "warehouse",
            header: "Pañol",
            cell: (m) => m.warehouseId
                ? <span className="text-sm">{warehouseLabel(m.warehouseId)}</span>
                : <span className="text-sm text-muted-foreground">—</span>,
        },
        {
            key: "user",
            header: "Usuario",
            cell: (m) => <span className="text-xs">{m.userName}</span>,
        },
    ];

    // Ofrece también contratos cerrados que aún tienen existencias en el ledger.
    const contractHasStock = useMemo(() => {
        const ids = new Set<string>();
        for (const s of (materialStocks || []) as MaterialStock[]) {
            if (Number(s.qty) > 0 && s.contractId) ids.add(s.contractId);
        }
        return ids;
    }, [materialStocks]);

    return (
        <PageShell
            title="Stock por Contrato"
            description="Existencias, valorización y movimientos de materiales desglosados por contrato y pañol."
            toolbar={
                <>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative w-full max-w-[220px]">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar material..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-9 rounded-xl"
                            />
                        </div>
                        <ClientContractFilter
                            clientId={clientFilter}
                            contractId={contractFilter}
                            onClientChange={setClientFilter}
                            onContractChange={setContractFilter}
                            includePool
                            poolLabel="Pool central"
                            triggerClassName="w-[200px] rounded-xl"
                            contractPredicate={(c) => c.status === "active" || contractHasStock.has(c.id)}
                        />
                        <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                            <SelectTrigger className="w-[190px] rounded-xl">
                                <SelectValue placeholder="Pañol" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL}>Todos los pañoles</SelectItem>
                                <SelectItem value={POOL}>Sin pañol</SelectItem>
                                {((warehouses || []) as Warehouse[]).map((w) => (
                                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="rounded-[1.5rem] shadow-lg shadow-primary/10 hover:scale-105 active:scale-95"
                    >
                        {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
                        Exportar Excel
                    </Button>
                </>
            }
        >
            {/* Valorización por contrato */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <Card className="rounded-[1.5rem] border-l-4 border-l-primary shadow-sm">
                    <CardContent className="p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                            <PieChart size={11} /> Valorización total
                        </p>
                        <p className="text-2xl font-black mt-1">{fmtCLP(valuation.totalValue)}</p>
                        {valuation.unpricedCount > 0 && (
                            <p className="text-[10px] text-muted-foreground mt-1">
                                {valuation.unpricedCount} material(es) sin costo unitario no se valorizan
                            </p>
                        )}
                    </CardContent>
                </Card>
                {valuation.rows.map((r) => (
                    <Card
                        key={r.contractId ?? POOL}
                        className={`rounded-[1.5rem] shadow-sm ${r.contractId === null ? "border-l-4 border-l-warning" : ""}`}
                    >
                        <CardContent className="p-5">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                                {r.contractId === null ? <Package size={11} /> : <WarehouseIcon size={11} />} {r.label}
                            </p>
                            <p className="text-2xl font-black mt-1">{fmtCLP(r.value)}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                                {fmtQty(r.qty)} unidad(es)
                                {valuation.totalValue > 0 && r.value > 0 && ` · ${Math.round((r.value / valuation.totalValue) * 100)}% del total`}
                                {r.contractId === null && " · sin asignar a contrato"}
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Tabs defaultValue="matrix" className="space-y-6">
                <TabsList className="rounded-xl">
                    <TabsTrigger value="matrix" className="rounded-lg">Matriz por contrato</TabsTrigger>
                    <TabsTrigger value="detail" className="rounded-lg">Detalle por pañol</TabsTrigger>
                    <TabsTrigger value="kardex" className="rounded-lg">Kardex del período</TabsTrigger>
                </TabsList>

                <TabsContent value="matrix">
                    {matrixRows.length === 0 ? (
                        <EmptyState
                            icon={<Package size={22} />}
                            title={searchTerm ? "Sin resultados" : "No hay existencias registradas en el desglose"}
                            description={searchTerm ? `No se encontró "${searchTerm}".` : "Cuando entre stock (compras, ingresos, devoluciones) aparecerá aquí desglosado."}
                        />
                    ) : (
                        <DataTable
                            columns={matrixColumns}
                            data={matrixRows}
                            rowKey={(r) => r.materialId}
                            maxHeight="560px"
                            minWidth="820px"
                        />
                    )}
                </TabsContent>

                <TabsContent value="detail">
                    <DataTable
                        columns={detailColumns}
                        data={detailRows}
                        rowKey={(r) => r.id}
                        maxHeight="560px"
                        minWidth="760px"
                        empty={{
                            icon: <WarehouseIcon size={22} />,
                            title: "Sin existencias para los filtros elegidos",
                            description: "Ajusta el contrato, pañol o búsqueda.",
                        }}
                    />
                </TabsContent>

                <TabsContent value="kardex" className="space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Desde</p>
                            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-xl w-[170px]" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Hasta</p>
                            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-xl w-[170px]" />
                        </div>
                        <div className="flex flex-wrap gap-3 sm:ml-auto">
                            <div className="px-4 py-2 rounded-xl bg-success-subtle text-success-subtle-foreground flex items-center gap-2">
                                <ArrowDownRight size={14} />
                                <span className="text-xs font-bold">Entradas: {fmtQty(kardex.inflow)}</span>
                            </div>
                            <div className="px-4 py-2 rounded-xl bg-warning-subtle text-warning-subtle-foreground flex items-center gap-2">
                                <ArrowUpRight size={14} />
                                <span className="text-xs font-bold">Salidas: {fmtQty(kardex.outflow)}</span>
                            </div>
                            <div className="px-4 py-2 rounded-xl bg-info-subtle text-info-subtle-foreground flex items-center gap-2">
                                <ArrowLeftRight size={14} />
                                <span className="text-xs font-bold">Neto: {kardex.net > 0 ? `+${fmtQty(kardex.net)}` : fmtQty(kardex.net)}</span>
                            </div>
                        </div>
                    </div>
                    <DataTable
                        columns={kardexColumns}
                        data={kardex.rows}
                        rowKey={(m) => m.id}
                        maxHeight="560px"
                        minWidth="980px"
                        empty={{
                            icon: <ArrowLeftRight size={22} />,
                            title: "Sin movimientos en el período",
                            description: "Amplía el rango de fechas o cambia los filtros.",
                        }}
                    />
                </TabsContent>
            </Tabs>
        </PageShell>
    );
}
