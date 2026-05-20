"use client";

import React, { useState, useMemo } from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, UserSearch, FileDown } from 'lucide-react';
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

    const aprDeliveries = useMemo(() => {
        return approvedRequests.filter(req => {
            const user = userMap.get(req.supervisorId);
            return user?.role === 'apr';
        });
    }, [approvedRequests, userMap]);

    const formatDate = (date: Date | string) => {
        if (!date) return 'N/A';
        const d = typeof date === 'string' ? new Date(date) : date;
        return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

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


    if (isLoading) {
        return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin"/></div>;
    }
    
    return (
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Reporte de Entregas de Bodega"
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
                             <ScrollArea className="h-[60vh]">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Material</TableHead>
                                            <TableHead>Cantidad</TableHead>
                                            <TableHead>Área / Trabajador</TableHead>
                                            <TableHead>Solicitante</TableHead>
                                            <TableHead>Fecha Aprobación</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredDeliveries.length > 0 ? (
                                            filteredDeliveries.map((item, index) => (
                                                <TableRow key={`${item.requestId}-${item.materialId}-${index}`}>
                                                    <TableCell>{item.materialName}</TableCell>
                                                    <TableCell>{item.quantity}</TableCell>
                                                    <TableCell>{item.area}</TableCell>
                                                    <TableCell>{item.supervisorName}</TableCell>
                                                    <TableCell>{formatDate(item.approvedAt)}</TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow>
                                                <TableCell colSpan={5} className="h-24 text-center">
                                                    <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-12">
                                                        <UserSearch className="h-12 w-12 mb-4" />
                                                        <p>No se encontraron entregas para la búsqueda actual.</p>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
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
                            <ScrollArea className="h-[60vh]">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Material</TableHead>
                                            <TableHead>Cantidad</TableHead>
                                            <TableHead>Solicitante (APR)</TableHead>
                                            <TableHead>Área</TableHead>
                                            <TableHead>Fecha Aprobación</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {aprDeliveries.length > 0 ? (
                                           aprDeliveries.flatMap(req => {
                                                const itemsToProcess = Array.isArray(req.items) 
                                                    ? req.items 
                                                    : (req.materialId && req.quantity ? [{ materialId: req.materialId, quantity: req.quantity }] : []);

                                                return itemsToProcess.map(item => {
                                                    const aprUser = userMap.get(req.supervisorId);
                                                    const material = materialMap.get(item.materialId);
                                                    return (
                                                        <TableRow key={`${req.id}-${item.materialId}`}>
                                                            <TableCell>{material?.name || 'Desconocido'}</TableCell>
                                                            <TableCell>{item.quantity}</TableCell>
                                                            <TableCell>{aprUser?.name || 'Desconocido'}</TableCell>
                                                            <TableCell>{req.area}</TableCell>
                                                            <TableCell>{formatDate(req.createdAt)}</TableCell>
                                                        </TableRow>
                                                    )
                                                })
                                            })
                                        ) : (
                                            <TableRow>
                                                <TableCell colSpan={5} className="h-24 text-center">
                                                    No hay entregas registradas por usuarios con rol de APR.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
