"use client";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Globe, AlertCircle, PlusCircle } from "lucide-react";

export default function ExportacionPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Documentos de Exportación"
        description="Gestión de documentos para operaciones de exportación (Tipos 110, 111 y 112 SII)."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Emitidos (mes)", value: "0", sub: "documentos" },
          { label: "Pendientes Aduana", value: "0", sub: "en trámite" },
          { label: "Anulados", value: "0", sub: "este mes" },
          { label: "Monto USD", value: "$ 0", sub: "este mes" },
        ].map(({ label, value, sub }) => (
          <Card key={label} className="shadow-sm">
            <CardContent className="pt-5 pb-4">
              <p className="text-3xl font-bold text-cyan-600">{value}</p>
              <p className="text-sm font-medium mt-1">{label}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-l-4 border-l-cyan-500 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Documentos de Exportación — Tipos 110-112 SII</CardTitle>
            <Badge variant="outline" className="font-mono text-xs">Tipos 110-112</Badge>
          </div>
          <Button disabled className="gap-2">
            <PlusCircle className="h-4 w-4" />
            Nuevo Doc. Exportación
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4">
            <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Módulo en Desarrollo</p>
              <p className="text-sm text-amber-800 dark:text-amber-300">
                La emisión de Documentos de Exportación (Tipos 110, 111 y 112) estará disponible próximamente. Requiere habilitación especial en el SII.
              </p>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Folio</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>RUT/ID Receptor</TableHead>
                <TableHead>País Destino</TableHead>
                <TableHead>Moneda</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Estado SII</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={7} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <Globe className="h-14 w-14 opacity-20" />
                    <p className="text-sm">No hay documentos de exportación registrados.</p>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
