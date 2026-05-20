
"use client";

import React, { useState, useMemo } from "react";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import type { Material, Tool, ToolLog } from "@/modules/core/lib/data";
import { EditMaterialForm } from "@/components/admin/edit-material-form";
import * as ExcelJS from 'exceljs';


export default function InventoryReportPage() {
    const { materials, tools, toolLogs, isLoading } = useAppState();
    const { user } = useAuth();
    const [isExporting, setIsExporting] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [availableSearchTerm, setAvailableSearchTerm] = useState("");
    const [activeTab, setActiveTab] = useState<"materials" | "tools">(
        "materials"
    );
    const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);

    const isPrivilegedUser = user?.role === 'super-admin' || user?.role === 'administrador';

    const checkedOutToolIds = useMemo(() => {
        return new Set(
            (toolLogs || [])
                .filter((log: ToolLog) => log.returnDate === null)
                .map((log) => log.toolId)
        );
    }, [toolLogs]);

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
        const totalTools = (tools || []).length;
        const outOfStock = totalMaterials - (materials || []).filter(m => m.stock > 0).length;
        return {
            totalMaterials,
            totalTools,
            available: totalMaterials - outOfStock,
            outOfStock,
        };
    }, [materials, tools]);

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
        if (!tools) return [];
        const filtered = searchTerm
            ? tools.filter((t: Tool) =>
                t.name.toLowerCase().includes(searchTerm.toLowerCase())
              )
            : tools;
        return filtered.sort((a, b) => a.name.localeCompare(b.name));
    }, [tools, searchTerm]);

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


    if (isLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center min-h-[50vh]">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

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
                        <div className="text-2xl font-bold">
                            {stats.totalMaterials}
                        </div>
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
                        <div className="text-2xl font-bold">
                            {stats.totalTools}
                        </div>
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
                        <div className="text-2xl font-bold">{stats.available}</div>
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
                        <div className="text-2xl font-bold text-destructive">
                            {stats.outOfStock}
                        </div>
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
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="materials">
                                    Materiales ({stats.totalMaterials})
                                </TabsTrigger>
                                <TabsTrigger value="tools">
                                    Herramientas ({stats.totalTools})
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
                                <ScrollArea className="h-[400px] border rounded-md">
                                    <Table>
                                        <TableHeader className="sticky top-0 bg-card">
                                            <TableRow>
                                                <TableHead>Nombre</TableHead>
                                                <TableHead className="text-right">
                                                    Stock
                                                </TableHead>
                                                {isPrivilegedUser && <TableHead className="text-right">Acciones</TableHead>}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {filteredMaterials.map((m) => (
                                                <TableRow key={m.id}>
                                                    <TableCell>
                                                        <p className="font-medium">{m.name}</p>
                                                        <p className="text-xs text-muted-foreground">
                                                            {m.category}
                                                        </p>
                                                    </TableCell>

                                                    <TableCell
                                                        className={`text-right font-mono font-medium ${
                                                            m.stock === 0
                                                                ? "text-red-500"
                                                                : m.stock < 10
                                                                ? "text-amber-500"
                                                                : ""
                                                        }`}
                                                    >
                                                        {m.stock.toLocaleString()}{" "}
                                                        <span className="text-xs text-muted-foreground">
                                                            {m.unit}
                                                        </span>
                                                    </TableCell>
                                                    {isPrivilegedUser && (
                                                        <TableCell className="text-right">
                                                            <Button variant="ghost" size="icon" onClick={() => setEditingMaterial(m)}>
                                                                <Edit className="h-4 w-4" />
                                                            </Button>
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </ScrollArea>
                            </TabsContent>
                            <TabsContent value="tools" className="mt-0">
                                <ScrollArea className="h-[400px] border rounded-md">
                                    <Table>
                                        <TableHeader className="sticky top-0 bg-card">
                                            <TableRow>
                                                <TableHead>Nombre</TableHead>
                                                <TableHead className="text-right">
                                                    Estado
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {filteredTools.map((t) => (
                                                <TableRow key={t.id}>
                                                    <TableCell>
                                                        <p className="font-medium">{t.name}</p>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {t.status === "maintenance" ? (
                                                            <Badge variant="destructive">
                                                                Mantenimiento
                                                            </Badge>
                                                        ) : checkedOutToolIds.has(t.id) ? (
                                                            <Badge variant="secondary">
                                                                En Uso
                                                            </Badge>
                                                        ) : (
                                                            <Badge className="bg-green-600 text-white">
                                                                Disponible
                                                            </Badge>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </ScrollArea>
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

                        <div className="flex-1 overflow-hidden border rounded-md min-h-[380px] bg-background">
                            {availableMaterials.length > 0 ? (
                                <ScrollArea className="h-[380px]">
                                    <Table>
                                        <TableHeader className="sticky top-0 bg-card">
                                            <TableRow>
                                                <TableHead>Material</TableHead>
                                                <TableHead className="text-right">
                                                    Stock
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>

                                        <TableBody>
                                            {availableMaterials.map((m) => (
                                                <TableRow key={m.id}>
                                                    <TableCell>
                                                        <div className="font-medium">
                                                            {m.name}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {m.category}
                                                        </div>
                                                    </TableCell>

                                                    <TableCell className="text-right">
                                                        <Badge
                                                            variant="outline"
                                                            className="font-mono font-bold text-base"
                                                        >
                                                            {m.stock.toLocaleString()}
                                                            <span className="text-xs ml-1 font-normal opacity-70 uppercase">
                                                                {m.unit}
                                                            </span>
                                                        </Badge>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </ScrollArea>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center p-8">
                                    <Inbox className="h-12 w-12 mb-4 opacity-50" />
                                    <p className="font-medium">
                                        No hay materiales con stock disponible.
                                    </p>
                                    <p className="text-xs mt-1">
                                        Todo el inventario está en 0.
                                    </p>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
