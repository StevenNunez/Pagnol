"use client";

import React, { useMemo, useState, useCallback } from 'react';
import { PageHeader } from '@/components/page-header';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PurchaseOrder as PurchaseOrderType, Supplier } from '@/modules/core/lib/data';
import { generateOCPDF } from '@/lib/pdf-oc-generator';
import { useToast } from '@/modules/core/hooks/use-toast';

export default function PurchaseOrdersPage() {
  const { purchaseOrders, suppliers } = useAppState();
  const { toast } = useToast();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const officialOrders = useMemo(() => {
    return (purchaseOrders || [])
        .filter(order => order.status === 'issued')
        .sort((a,b) => {
            const dateA = new Date(a.createdAt as any);
            const dateB = new Date(b.createdAt as any);
            return dateB.getTime() - dateA.getTime();
        });
  }, [purchaseOrders]);

  const getDate = (date: Date | string | undefined | null) => {
    if (!date) return new Date();
    return new Date(date as any);
  };
  
  const handleDownloadPDF = async (order: PurchaseOrderType) => {
    setDownloadingId(order.id);
    try {
        const supplier = suppliers.find((s: Supplier) => s.id === order.supplierId);
        if (!supplier) {
            toast({ variant: 'destructive', title: 'Error', description: 'Proveedor no encontrado para esta OC.' });
            return;
        }

        const itemsWithDetails = (order.items || []).map((item, index) => ({
            item: index + 1,
            code: item.id.slice(0, 8).toUpperCase(),
            description: item.name,
            unit: item.unit,
            quantity: item.totalQuantity,
            unitPrice: item.price || 0,
            netValue: (item.price || 0) * item.totalQuantity,
        }));

        const { blob, filename } = await generateOCPDF({
            ocNumber: order.officialOCId || order.id,
            date: getDate(order.createdAt),
            supplierName: supplier.name,
            supplierRut: supplier.rut || 'N/A',
            supplierAddress: supplier.address || 'N/A',
            supplierContact: supplier.phone || 'N/A',
            supplierEmail: supplier.email || 'N/A',
            project: 'CONSTRUCCIÓN TIENDA Y SERVICIOS CORDILLERA, LA SERENA',
            file: '721',
            items: itemsWithDetails,
            totalNet: order.totalAmount || 0,
            paymentTerms: '30 DÍAS',
            createdByName: order.creatorName || 'N/A',
            cotizacion: order.id.slice(0,8).toUpperCase(),
        });
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error(error);
        toast({ variant: "destructive", title: "Error al generar PDF", description: "Ocurrió un problema al crear el documento." });
    } finally {
        setDownloadingId(null);
    }
  };
  
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Historial de Órdenes de Compra" description="Consulta y descarga todas las órdenes de compra oficiales generadas." />

      <Card>
        <CardHeader>
          <CardTitle>Órdenes de Compra Emitidas</CardTitle>
          <CardDescription>
            Esta es la lista de todas las OC que han sido procesadas y están listas para ser enviadas a proveedores y para el pago de facturas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº OC</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Fecha de Emisión</TableHead>
                <TableHead>Monto Total</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {officialOrders.length > 0 ? (
                officialOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono">{order.officialOCId}</TableCell>
                    <TableCell className="font-medium">{order.supplierName}</TableCell>
                    <TableCell>{getDate(order.createdAt).toLocaleDateString('es-CL')}</TableCell>
                    <TableCell className="font-mono">${(order.totalAmount || 0).toLocaleString('es-CL')}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => handleDownloadPDF(order)} disabled={downloadingId === order.id}>
                        <Download className="mr-2 h-4 w-4" />
                        {downloadingId === order.id ? 'Generando...' : 'PDF'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24">
                    No hay órdenes de compra generadas.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
