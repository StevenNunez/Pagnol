"use client";

import React, { useState, useMemo } from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { UserSearch, FileDown } from 'lucide-react';
import Papa from 'papaparse';
import type { MaterialRequest } from '@/modules/core/lib/data';

type CompatibleMaterialRequest = MaterialRequest & {
    materialId?: string;
    quantity?: number;
    items?: { materialId: string; quantity: number }[];
};

// New type for our flat list of deliveries
type DeliveryItem = {
    requestId: string;
    materialId: string;
    materialName: string;
    quantity: number;
    supervisorId: string;
    supervisorName: string;
    area: string;
    approvedAt: Date;
}


const formatDate = (date: Date | string) => {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// Las dos pestañas listan lo mismo, pero con las columnas en distinto orden y con
// etiquetas propias. Se dejan explícitas para que la migración no las uniforme.
const workerColumns: DataTableColumn<DeliveryItem>[] = [
    { key: 'material', header: 'Material', cell: (item) => item.materialName },
    { key: 'cantidad', header: 'Cantidad', cell: (item) => item.quantity },
    { key: 'area', header: 'Área / Trabajador', cell: (item) => item.area },
    { key: 'solicitante', header: 'Solicitante', cell: (item) => item.supervisorName },
    { key: 'fecha', header: 'Fecha Aprobación', cell: (item) => formatDate(item.approvedAt) },
];

const aprColumns: DataTableColumn<DeliveryItem>[] = [
    { key: 'material', header: 'Material', cell: (item) => item.materialName },
    { key: 'cantidad', header: 'Cantidad', cell: (item) => item.quantity },
    { key: 'solicitante', header: 'Solicitante (APR)', cell: (item) => item.supervisorName },
    { key: 'area', header: 'Área', cell: (item) => item.area },
    { key: 'fecha', header: 'Fecha Aprobación', cell: (item) => formatDate(item.approvedAt) },
];

export default function DeliveryReportPage() {
    const { requests, users, materials, isLoading } = useAppState();
    const [searchTerm, setSearchTerm] = useState('');

    const approvedRequests = useMemo(() => {
        return (requests || []).filter(req => req.status === 'approved') as CompatibleMaterialRequest[];
    }, [requests]);
    
    const userMap = useMemo(() => new Map((users || []).map(u => [u.id, u])), [users]);
    const materialMap = useMemo(() => new Map((materials || []).map(m => [m.id, m])), [materials]);

    const flatDeliveries = useMemo((): DeliveryItem[] => {
        return approvedRequests.flatMap(req => {
            const supervisor = userMap.get(req.supervisorId);
            if (!supervisor) return [];

            const itemsToProcess = Array.isArray(req.items) 
                ? req.items 
                : (req.materialId && req.quantity ? [{ materialId: req.materialId, quantity: req.quantity }] : []);

            return itemsToProcess.map(item => {
                const material = materialMap.get(item.materialId);
                const approvedAt = new Date(req.createdAt as any);
                return {
                    requestId: req.id,
                    materialId: item.materialId,
                    materialName: material?.name || 'Desconocido',
                    quantity: item.quantity,
                    supervisorId: req.supervisorId,
                    supervisorName: supervisor.name,
                    area: req.area,
                    approvedAt: approvedAt,
                };
            });
        }).sort((a, b) => b.approvedAt.getTime() - a.approvedAt.getTime());
    }, [approvedRequests, userMap, materialMap]);


    const filteredDeliveries = useMemo(() => {
        if (!searchTerm) return flatDeliveries;
        const lowercasedFilter = searchTerm.toLowerCase();
        return flatDeliveries.filter(delivery => 
            delivery.supervisorName.toLowerCase().includes(lowercasedFilter) ||
            delivery.area.toLowerCase().includes(lowercasedFilter)
        );
    }, [flatDeliveries, searchTerm]);

    // Mismo aplanado que `flatDeliveries` pero acotado a solicitantes APR y **sin
    // ordenar**: esta pestaña siempre listó en el orden de `requests`, y ordenarla
    // aquí sería un cambio de comportamiento colado en una migración de tabla.
    const aprDeliveries = useMemo((): DeliveryItem[] => {
        return approvedRequests
            .filter(req => userMap.get(req.supervisorId)?.role === 'apr')
            .flatMap(req => {
                const supervisor = userMap.get(req.supervisorId);
                const itemsToProcess = Array.isArray(req.items)
                    ? req.items
                    : (req.materialId && req.quantity ? [{ materialId: req.materialId, quantity: req.quantity }] : []);

                return itemsToProcess.map(item => ({
                    requestId: req.id,
                    materialId: item.materialId,
                    materialName: materialMap.get(item.materialId)?.name || 'Desconocido',
                    quantity: item.quantity,
                    supervisorId: req.supervisorId,
                    supervisorName: supervisor?.name || 'Desconocido',
                    area: req.area,
                    approvedAt: new Date(req.createdAt as any),
                }));
            });
    }, [approvedRequests, userMap, materialMap]);

    const handleDownloadExcel = () => {
        const dataToExport = filteredDeliveries.map(item => ({
            "Fecha Aprobación": formatDate(item.approvedAt),
            "Material": item.materialName,
            "Cantidad": item.quantity,
            "Área / Trabajador": item.area,
            "Solicitante": item.supervisorName,
        }));
        
        const csv = Papa.unparse(dataToExport);
        // Add BOM for Excel compatibility
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", "reporte_entregas.csv");
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };


    return (
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Reporte de Entregas de Pañol"
                description="Visualiza todas las entregas de materiales por trabajador y por APR."
            />

            <Tabs defaultValue="by-worker">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="by-worker">Entregas por Trabajador</TabsTrigger>
                    <TabsTrigger value="by-apr">Entregas de APR</TabsTrigger>
                </TabsList>
                
                <TabsContent value="by-worker">
                    <Card>
                        <CardHeader>
                            <CardTitle>Entregas de Materiales por Trabajador</CardTitle>
                            <CardDescription>
                                Aquí se listan todos los materiales entregados. Usa el buscador para filtrar y luego descarga el informe.
                            </CardDescription>
                             <div className="pt-4 flex flex-col sm:flex-row gap-4">
                                <Input 
                                    placeholder="Buscar por nombre de trabajador o solicitante..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="max-w-sm"
                                />
                                <Button onClick={handleDownloadExcel} disabled={filteredDeliveries.length === 0}>
                                    <FileDown className="mr-2 h-4 w-4" />
                                    Descargar Excel
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <DataTable
                                columns={workerColumns}
                                data={filteredDeliveries}
                                rowKey={(item, index) => `${item.requestId}-${item.materialId}-${index}`}
                                isLoading={isLoading}
                                maxHeight="60vh"
                                empty={{
                                    icon: <UserSearch size={24} />,
                                    title: 'No se encontraron entregas para la búsqueda actual.',
                                }}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="by-apr">
                    <Card>
                        <CardHeader>
                            <CardTitle>Entregas Solicitadas por APR</CardTitle>
                            <CardDescription>
                                Un registro de todos los materiales cuya solicitud fue generada por un Prevencionista de Riesgos (APR).
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <DataTable
                                columns={aprColumns}
                                data={aprDeliveries}
                                rowKey={(item) => `${item.requestId}-${item.materialId}`}
                                isLoading={isLoading}
                                maxHeight="60vh"
                                empty={{ title: 'No hay entregas registradas por usuarios con rol de APR.' }}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
