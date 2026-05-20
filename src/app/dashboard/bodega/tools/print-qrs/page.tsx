"use client";

import React, { useState, useMemo } from "react";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import QRCode from "react-qr-code";
import { Printer, ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tool as ToolType, ToolLog, User } from "@/modules/core/lib/data";

export default function PrintToolsQrPage() {
  const { tools, users, toolLogs, isLoading, can } = useAppState();
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");

  const handlePrint = () => {
    window.print();
  };
  
  const checkedOutTools = useMemo(() => new Map<string, ToolLog>((toolLogs || []).filter((log: ToolLog) => log.returnDate === null).map((log: ToolLog) => [log.toolId, log])), [toolLogs]);

  const getToolCheckoutInfo = useMemo(() => {
    const workerMap = new Map((users || []).map((u: User) => [u.id, u.name]));
    return (toolId: string) => {
      const log = checkedOutTools.get(toolId) as ToolLog | undefined;
      if (!log) return { status: "Disponible" as const, workerName: null };
      
      const workerName = workerMap.get(log.userId) ?? (log as any).userName ?? "N/A";
      
      return { status: "Ocupado" as const, workerName };
    };
  }, [checkedOutTools, users]);
  
  const filteredTools = useMemo(() => {
    const safeTools: ToolType[] = tools || [];
    if (!searchTerm) {
        return safeTools;
    }
    return safeTools.filter((tool: ToolType) => 
        tool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (getToolCheckoutInfo(tool.id).workerName || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [tools, searchTerm, getToolCheckoutInfo]);
  
  
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
            title="Imprimir Credenciales de Herramientas"
            description="Usa el buscador para filtrar por nombre de herramienta o trabajador y luego 'Imprimir'."
        />
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
             <Button onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" />
                Imprimir Credenciales
            </Button>
             <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver
            </Button>
        </div>
        <div className="mb-8">
            <Input 
                placeholder="Buscar por nombre de herramienta o trabajador..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
            />
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
                    filteredTools.map((tool: ToolType) => {
                        const checkoutInfo = getToolCheckoutInfo(tool.id);
                        return (
                             <div key={tool.id} className="flex qr-item flex-col items-center justify-between text-center p-3 border-2 border-dashed rounded-lg aspect-[54/86] break-inside-avoid bg-background">
                                <div className='text-center'>
                                    <h3 className="font-bold text-base leading-tight">{tool.name}</h3>
                                    {checkoutInfo.status === 'Ocupado' ? (
                                        <p className="text-xs text-red-500 font-semibold">{checkoutInfo.status} por {checkoutInfo.workerName}</p>
                                    ) : (
                                        <p className="text-xs text-green-600 font-semibold">{checkoutInfo.status}</p>
                                    )}
                                </div>
                                <div className="p-1 bg-white rounded-md my-2">
                                    <QRCode value={tool.qrCode} size={128} style={{ height: "auto", maxWidth: "100%", width: "100%" }} />
                                </div>
                                <div className='text-center'>
                                    <p className="text-xs font-mono text-muted-foreground">{tool.id}</p>
                                    <p className="text-xs font-bold text-primary">CONSTRUCTORA FERROACTIVA</p>
                                </div>
                            </div>
                        )
                    })
                )}
                 {filteredTools.length === 0 && !isLoading && (
                    <div className="col-span-full text-center text-muted-foreground py-10">
                        No se encontraron herramientas con ese criterio de búsqueda.
                    </div>
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
          .qr-item svg { width: 4cm; height: 4cm; }
          .print-content { padding: 0 !important; background-color: #fff !important; }
          .card { background-color: #fff !important; box-shadow: none !important; border: none !important; }
        }
      `}</style>
    </div>
  );
}
