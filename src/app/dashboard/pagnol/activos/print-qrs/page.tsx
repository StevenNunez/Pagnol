"use client";

// Credenciales QR en lote para CUALQUIER activo del inventario (generalización
// de la antigua página de herramientas). El QR imprime serial_number (lo que
// reconoce el escáner de pagnol/movimientos) y cae a internal_code / id.

import React, { useState, useMemo } from "react";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import QRCode from "react-qr-code";
import { Printer, ArrowLeft, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Material, MaterialCategory } from "@/modules/core/lib/data";

const USAGE_TYPES = [
  'Consumible',
  'Reutilizable Controlado',
  'Herramienta Menor',
  'Repuesto Crítico',
  'Activo Fijo',
  'IT Controlado',
] as const;

export default function PrintAssetsQrPage() {
  const { materials, materialCategories, isLoading, can, currentTenant } = useAppState();
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [usageFilter, setUsageFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL"); // ALL | categoryId

  const tenantLabel = (currentTenant?.name || "PAGNOL").toUpperCase();

  const handlePrint = () => {
    window.print();
  };

  // Jerarquía Familia → Subcategoría para el filtro (una familia incluye hijas).
  const categoryTree = useMemo(() => {
    const all = (materialCategories || []) as MaterialCategory[];
    const byName = (a: MaterialCategory, b: MaterialCategory) => a.name.localeCompare(b.name);
    const rows: { category: MaterialCategory; depth: 0 | 1 }[] = [];
    all.filter(c => !c.parentId).sort(byName).forEach(f => {
      rows.push({ category: f, depth: 0 });
      all.filter(c => c.parentId === f.id).sort(byName)
        .forEach(child => rows.push({ category: child, depth: 1 }));
    });
    return rows;
  }, [materialCategories]);

  const categoryNamesForFilter = useMemo(() => {
    if (categoryFilter === 'ALL') return null;
    const all = (materialCategories || []) as MaterialCategory[];
    const cat = all.find(c => c.id === categoryFilter);
    if (!cat) return null;
    const names = new Set<string>([cat.name]);
    all.filter(c => c.parentId === cat.id).forEach(child => names.add(child.name));
    return names;
  }, [materialCategories, categoryFilter]);

  const filteredAssets = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return (materials || [])
      .filter((m: Material) => !m.archived)
      .filter((m: Material) => usageFilter === 'ALL' || m.usageType === usageFilter)
      .filter((m: Material) => categoryNamesForFilter === null || categoryNamesForFilter.has(m.category || ''))
      .filter((m: Material) => !term
        || m.name.toLowerCase().includes(term)
        || (m.serialNumber || "").toLowerCase().includes(term)
        || (m.internalCode || "").toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [materials, searchTerm, usageFilter, categoryNamesForFilter]);

  const getStatusLabel = (m: Material): { label: string; cls: string } => {
    if (m.status === "En Mantenimiento") return { label: "En Mantenimiento", cls: "text-red-500" };
    if ((m.inUse || 0) > 0 || m.status === "En Uso") return { label: "En Uso", cls: "text-red-500" };
    return { label: "Disponible", cls: "text-green-600" };
  };

  if (!can('users:print_qr')) {
    return (
        <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Acceso Denegado</AlertTitle>
            <AlertDescription>
                No tienes los permisos necesarios para acceder a esta sección.
            </AlertDescription>
        </Alert>
    );
  }

  return (
    <div className="print-container flex flex-col gap-8">
      {/* Controles solo visibles en pantalla */}
      <div className="print-hide">
         <PageHeader
            title="Imprimir Credenciales QR de Activos"
            description="Filtra por tipo de uso, categoría o texto y luego 'Imprimir'. Se imprime todo lo listado."
        />
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
             <Button onClick={handlePrint} disabled={filteredAssets.length === 0}>
                <Printer className="mr-2 h-4 w-4" />
                Imprimir Credenciales ({filteredAssets.length})
            </Button>
             <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver
            </Button>
        </div>
        <div className="mb-8 flex flex-col sm:flex-row gap-4">
            <Input
                placeholder="Buscar por nombre, serie o ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
            />
            <Select value={usageFilter} onValueChange={setUsageFilter}>
              <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los tipos de uso</SelectItem>
                {USAGE_TYPES.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-72"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas las categorías</SelectItem>
                {categoryTree.map(({ category, depth }) => (
                  <SelectItem key={category.id} value={category.id} className={depth === 0 ? 'font-bold' : ''}>
                    {depth === 1 ? `— ${category.name}` : category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
        </div>
      </div>

      {/* Área imprimible */}
      <Card>
        <CardContent className="p-4 md:p-6 print-content">
            <div className="grid print-grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {isLoading ? (
                    Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="flex flex-col items-center justify-center p-4 border rounded-lg aspect-[54/86] bg-muted animate-pulse" />
                    ))
                ) : (
                    filteredAssets.map((m: Material) => {
                        const status = getStatusLabel(m);
                        return (
                             <div key={m.id} className="flex qr-item flex-col items-center justify-between text-center p-3 border-2 border-dashed rounded-lg aspect-[54/86] break-inside-avoid bg-background">
                                <div className='text-center'>
                                    <h3 className="font-bold text-base leading-tight">{m.name}</h3>
                                    <p className={`text-xs font-semibold ${status.cls}`}>{status.label}</p>
                                </div>
                                <div className="p-1 bg-white rounded-md my-2">
                                    <QRCode value={m.serialNumber || m.internalCode || m.id} size={128} style={{ height: "auto", maxWidth: "100%", width: "100%" }} />
                                </div>
                                <div className='text-center'>
                                    <p className="text-xs font-mono text-muted-foreground">{m.serialNumber || m.internalCode || m.id}</p>
                                    <p className="text-xs font-bold text-primary">{tenantLabel}</p>
                                </div>
                            </div>
                        )
                    })
                )}
                 {filteredAssets.length === 0 && !isLoading && (
                    <EmptyState className="col-span-full border-0" title="No se encontraron activos con esos filtros." />
                )}
            </div>
        </CardContent>
      </Card>

      {/* Estilos para impresión */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0.5cm;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print-hide { display: none !important; }
          .print-container { gap: 0 !important; }
          .print-grid {
             display: grid;
             grid-template-columns: repeat(3, 1fr) !important;
             gap: 0.2rem;
          }
          .qr-item {
             border: 1px dashed #999;
             padding: 0.5rem;
             page-break-inside: avoid;
             height: 8.6cm;
             width: 5.4cm;
             justify-content: space-between;
             align-items: center;
             background-color: #fff !important;
             color: #000 !important;
          }
          .qr-item h3 { font-size: 11pt; font-weight: bold; color: #000 !important; }
          .qr-item p { font-size: 8pt; color: #333 !important; }
          .qr-item .text-muted-foreground { color: #555 !important; }
          .qr-item .text-primary { color: #f97316 !important; }
          .qr-item .text-red-500 { color: #ef4444 !important; }
          .qr-item .text-green-600 { color: #16a34a !important; }
          .qr-item .bg-white { padding: 2px; }
          .print-content { padding: 0 !important; background-color: #fff !important; }
          .card { background-color: #fff !important; box-shadow: none !important; border: none !important; }
        }
      `}</style>
    </div>
  );
}
