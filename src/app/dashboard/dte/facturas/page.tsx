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
import { FileText, AlertCircle, Plus } from "lucide-react";

export default function FacturasPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Facturas Electrónicas"
        description="Emisión y gestión de facturas afectas a IVA (Tipo 33 SII)."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Emitidos (mes)", value: "0", sub: "facturas" },
          { label: "Pendientes SII", value: "0", sub: "en cola" },
          { label: "Anulados", value: "0", sub: "este mes" },
          { label: "Monto Total", value: "$0", sub: "este mes" },
        ].map(({ label, value, sub }) => (
          <Card key={label} className="shadow-sm">
            <CardContent className="pt-5 pb-4">
              <p className="text-3xl font-bold text-blue-600">{value}</p>
              <p className="text-sm font-medium mt-1">{label}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-l-4 border-l-emerald-500 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Facturas Electrónicas — Tipo 33</CardTitle>
            <Badge variant="outline" className="font-mono text-xs">Tipo 33</Badge>
          </div>
          <Button disabled className="gap-2">
            <Plus className="h-4 w-4" />
            Nueva Factura
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4">
            <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              La emisión de Facturas Electrónicas (Tipo 33) estará disponible próximamente. Configure primero la integración con el SII.
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Folio</TableHead>
                <TableHead>RUT Receptor</TableHead>
                <TableHead>Razón Social</TableHead>
                <TableHead>Fecha Emisión</TableHead>
                <TableHead className="text-right">Monto Neto</TableHead>
                <TableHead className="text-right">IVA (19%)</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Estado SII</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={8} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <FileText className="h-14 w-14 opacity-20" />
                    <p className="text-sm">No hay facturas registradas.</p>
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
