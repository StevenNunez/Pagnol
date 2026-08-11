
"use client";

import React, { useState, useMemo } from "react";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Loader2,
    FileDown,
    Warehouse,
    Package,
    Inbox,
    CheckCircle,
    AlertTriangle,
    Search,
    Wrench,
    Edit,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Material } from "@/modules/core/lib/data";
import { computeToolHolderMap } from "@/modules/core/lib/tool-loans";
import { EditMaterialForm } from "@/components/admin/edit-material-form";
import * as ExcelJS from 'exceljs';


/**
 * Cifra de una tarjeta de resumen. Mientras el estado global carga, todas estas
 * cuentas valen 0 — y "0 materiales agotados" es una afirmación falsa, no un
 * dato que aún no llega (ADR-014). El esqueleto no afirma nada.
 */
const StatValue = ({ value, isLoading, className }: { value: number; isLoading?: boolean; className?: string }) =>
    isLoading
        ? <Skeleton className="h-8 w-20" />
        : <div className={cn('text-2xl font-bold', className)}>{value}</div>;

export default function InventoryReportPage() {
    const { materials, requests, returnRequests, users, isLoading } = useAppState();
    const { user } = useAuth();
    const [isExporting, setIsExporting] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [availableSearchTerm, setAvailableSearchTerm] = useState("");
    const [activeTab, setActiveTab] = useState<"materials" | "tools">(
        "materials"
    );
    const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);

    const isPrivilegedUser = user?.role === 'super-admin' || user?.role === 'administrador';

    // Herramientas = activos 'Herramienta Menor' (tools legacy quedó migrado).
    // Quién tiene cada una se deriva de entregas + devoluciones, igual que en
    // pagnol/herramientas.
    const toolMaterials = useMemo(
        () => (materials || [])
            .filter((m: Material) => m.usageType === "Herramienta Menor" && !m.archived)
            .sort((a, b) => a.name.localeCompare(b.name)),
        [materials]
    );
    const holderMap = useMemo(
        () => computeToolHolderMap(requests, returnRequests, users),
        [requests, returnRequests, users]
    );

    const availableMaterials = useMemo(() => {
        if (!materials) return [];
        let filtered = materials.filter((m: Material) => m.stock > 0);
        if (availableSearchTerm) {
          filtered = filtered.filter((m) =>
            m.name.toLowerCase().includes(availableSearchTerm.toLowerCase())
          );
        }
        return filtered.sort((a, b) => a.name.localeCompare(b.name));
    }, [materials, availableSearchTerm]);

    const stats = useMemo(() => {
        const totalMaterials = (materials || []).length;
        const outOfStock = totalMaterials - (materials || []).filter(m => m.stock > 0).length;
        return {
            totalMaterials,
            totalTools: toolMaterials.length,
            available: totalMaterials - outOfStock,
            outOfStock,
        };
    }, [materials, toolMaterials]);

    const filteredMaterials = useMemo(() => {
        if (!materials) return [];
        const filtered = searchTerm
            ? materials.filter((m: Material) =>
                m.name.toLowerCase().includes(searchTerm.toLowerCase())
              )
            : materials;
        return filtered.sort((a, b) => a.name.localeCompare(b.name));
    }, [materials, searchTerm]);

    const filteredTools = useMemo(() => {
        if (!searchTerm) return toolMaterials;
        return toolMaterials.filter((m) =>
            m.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [toolMaterials, searchTerm]);

    const materialColumns: DataTableColumn<Material>[] = [
        {
            key: "name", header: "Nombre",
            cell: (m) => (
                <>
                    <p className="font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.category}</p>
                </>
            ),
        },
        {
            key: "stock", header: "Stock", headerClassName: "text-right",
            // El color del stock depende de la fila, así que va en la celda.
            cell: (m) => (
                <span className={m.stock === 0 ? "text-red-500" : m.stock < 10 ? "text-amber-500" : ""}>
                    {m.stock.toLocaleString()}{" "}
                    <span className="text-xs text-muted-foreground">{m.unit}</span>
                </span>
            ),
            className: "text-right font-mono font-medium",
        },
        // Columna sólo para quien puede editar (antes era un `&&` en el <TableHead>).
        ...(isPrivilegedUser ? [{
            key: "actions", header: "Acciones", headerClassName: "text-right", className: "text-right",
            cell: (m: Material) => (
                <Button variant="ghost" size="icon" onClick={() => setEditingMaterial(m)}>
                    <Edit className="h-4 w-4" />
                </Button>
            ),
        }] : []),
    ];

    const toolColumns: DataTableColumn<Material>[] = [
        {
            key: "name", header: "Nombre",
            cell: (m) => {
                const holder = holderMap.get(m.id);
                return (
                    <>
                        <p className="font-medium">{m.name}</p>
                        {holder && <p className="text-xs text-muted-foreground">En poder de {holder.name}</p>}
                    </>
                );
            },
        },
        {
            key: "status", header: "Estado", headerClassName: "text-right", className: "text-right",
            cell: (m) => {
                const holder = holderMap.get(m.id);
                if (m.status === "En Mantenimiento") return <Badge variant="destructive">Mantenimiento</Badge>;
                if (holder || (m.inUse || 0) > 0 || m.status === "En Uso") return <Badge variant="secondary">En Uso</Badge>;
                return <Badge className="badge-success">Disponible</Badge>;
            },
        },
    ];

    const availableColumns: DataTableColumn<Material>[] = [
        {
            key: "name", header: "Material",
            cell: (m) => (
                <>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.category}</div>
                </>
            ),
        },
        {
            key: "stock", header: "Stock", headerClassName: "text-right", className: "text-right",
            cell: (m) => (
                <Badge variant="outline" className="font-mono font-bold text-base">
                    {m.stock.toLocaleString()}
                    <span className="text-xs ml-1 font-normal opacity-70 uppercase">{m.unit}</span>
                </Badge>
            ),
        },
    ];

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Inventario Disponible');

            // --- Estilos ---
            const headerStyle: Partial<ExcelJS.Style> = {
                font: { bold: true, color: { argb: 'FFFFFFFF' } },
                fill: {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FF00528B' } // Azul Ferroactiva
                },
                alignment: { vertical: 'middle', horizontal: 'center' },
                border: {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                }
            };

            const cellStyle: Partial<ExcelJS.Style> = {
                border: {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                }
            };
            
            // --- Cabecera ---
            worksheet.columns = [
                { header: "ID", key: "ID", width: 35 },
                { header: "Material", key: "Material", width: 50 },
                { header: "Stock Disponible", key: "Stock Disponible", width: 20 },
                { header: "Unidad", key: "Unidad", width: 15 },
                { header: "Categoría", key: "Categoría", width: 30 },
            ];
            
            worksheet.getRow(1).eachCell(cell => {
                cell.style = headerStyle;
            });
            worksheet.getRow(1).height = 20;

            // --- Datos ---
            availableMaterials.forEach((m) => {
                const row = worksheet.addRow({
                    ID: m.id,
                    Material: m.name,
                    "Stock Disponible": m.stock,
                    Unidad: m.unit,
                    Categoría: m.category,
                });
                
                row.eachCell(cell => {
                    cell.style = cellStyle;
                });
                
                // Alineación específica para columnas
                const stockCell = row.getCell('Stock Disponible');
                stockCell.alignment = { vertical: 'middle', horizontal: 'center' };
                stockCell.numFmt = '#,##0';
                
                const unitCell = row.getCell('Unidad');
                unitCell.alignment = { vertical: 'middle', horizontal: 'center' };
            });

            // --- Generar Archivo ---
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `inventario_disponible_${new Date()
                .toISOString()
                .split("T")[0]}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            
        } catch (error) {
            console.error("Error al exportar:", error);
            alert("Error al generar el archivo Excel.");
        } finally {
            setTimeout(() => setIsExporting(false), 800);
        }
    };


    return (
        <div className="flex flex-col gap-8">
            {editingMaterial && (
                <EditMaterialForm
                    material={editingMaterial}
                    isOpen={!!editingMaterial}
                    onClose={() => setEditingMaterial(null)}
                />
            )}
            <PageHeader
                title="Reporte de Inventario"
                description="Consulta el estado completo de tu inventario y descarga reportes de disponibilidad."
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">
                            Total Materiales
                        </CardTitle>
                        <Package className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <StatValue value={stats.totalMaterials} isLoading={isLoading} />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">
                            Total Herramientas
                        </CardTitle>
                        <Wrench className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <StatValue value={stats.totalTools} isLoading={isLoading} />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-green-600">
                            Materiales en Stock
                        </CardTitle>
                        <CheckCircle className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <StatValue value={stats.available} isLoading={isLoading} />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-destructive">
                            Materiales Agotados
                        </CardTitle>
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                    </CardHeader>
                    <CardContent>
                        <StatValue value={stats.outOfStock} isLoading={isLoading} className="text-destructive" />
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                <Card className="flex flex-col">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Warehouse /> Inventario Total
                        </CardTitle>
                        <CardDescription>
                            Vista completa de todos los ítems registrados, incluyendo
                            los agotados.
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="flex-1 flex flex-col">
                        <Tabs
                            value={activeTab}
                            onValueChange={(value) =>
                                setActiveTab(value as "materials" | "tools")
                            }
                        >
                            {/* El contador va entre paréntesis sólo cuando ya se sabe:
                                "Materiales (0)" durante la carga afirma un inventario
                                vacío igual que lo haría la tabla (ADR-014). */}
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="materials">
                                    Materiales{isLoading ? '' : ` (${stats.totalMaterials})`}
                                </TabsTrigger>
                                <TabsTrigger value="tools">
                                    Herramientas{isLoading ? '' : ` (${stats.totalTools})`}
                                </TabsTrigger>
                            </TabsList>

                            <div className="relative my-4">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar por nombre..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-9"
                                />
                            </div>
                            <TabsContent value="materials" className="mt-0">
                                <DataTable
                                    data={filteredMaterials}
                                    rowKey={(m) => m.id}
                                    maxHeight="400px"
                                    columns={materialColumns}
                                    empty={{ icon: <Inbox size={24} />, title: 'Sin materiales que coincidan.' }}
                                />
                            </TabsContent>
                            <TabsContent value="tools" className="mt-0">
                                <DataTable
                                    data={filteredTools}
                                    rowKey={(m) => m.id}
                                    maxHeight="400px"
                                    columns={toolColumns}
                                    empty={{ icon: <Inbox size={24} />, title: 'Sin herramientas que coincidan.' }}
                                />
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </Card>

                <Card className="flex flex-col border-primary/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Package /> Inventario Disponible de Stock
                        </CardTitle>
                        <CardDescription>
                            Materiales con stock mayor a cero, listos para ser
                            solicitados.
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="flex-1 flex flex-col pt-6">
                        <Button
                            onClick={handleExport}
                            disabled={
                                isExporting || availableMaterials.length === 0
                            }
                            className="w-full mb-4 bg-green-600 hover:bg-green-700"
                        >
                            {isExporting ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <FileDown className="mr-2 h-4 w-4" />
                            )}
                            Descargar Inventario Disponible
                        </Button>
                         <div className="relative my-4">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar en disponibles..."
                                value={availableSearchTerm}
                                onChange={(e) => setAvailableSearchTerm(e.target.value)}
                                className="pl-9"
                            />
                        </div>

                        <div className="flex-1 min-h-[380px]">
                            <DataTable
                                data={availableMaterials}
                                rowKey={(m) => m.id}
                                maxHeight="380px"
                                columns={availableColumns}
                                empty={{
                                    icon: <Inbox size={24} />,
                                    title: "No hay materiales con stock disponible.",
                                    description: "Todo el inventario está en 0.",
                                }}
                            />
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
