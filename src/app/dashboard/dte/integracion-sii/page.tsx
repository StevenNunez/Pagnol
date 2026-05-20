"use client";

import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
import { XCircle, Clock, Loader2, RefreshCw, Link2 } from "lucide-react";
import Link from "next/link";

export default function IntegracionSIIPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integración SII en Tiempo Real"
        description="Estado de conexión, cola de envío y trazabilidad de documentos con el Servicio de Impuestos Internos."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="shadow-sm">
          <CardContent className="pt-5 pb-4">
            <p className="text-sm font-medium mb-2">Conexión SII</p>
            <Badge variant="destructive" className="text-xs">Desconectado</Badge>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="pt-5 pb-4">
            <p className="text-sm font-medium mb-2">Ambiente</p>
            <Badge variant="secondary" className="text-xs">No configurado</Badge>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="pt-5 pb-4">
            <p className="text-3xl font-bold text-slate-600">0</p>
            <p className="text-sm font-medium mt-1">Cola de Envío</p>
            <p className="text-xs text-muted-foreground">documentos</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="pt-5 pb-4">
            <p className="text-3xl font-bold text-slate-400">—</p>
            <p className="text-sm font-medium mt-1">Último Sincronizado</p>
            <p className="text-xs text-muted-foreground">sin datos</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-l-4 border-l-red-500 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <XCircle className="h-5 w-5 text-red-500" />
            <div>
              <CardTitle className="text-base">Estado de Conexión</CardTitle>
              <CardDescription className="text-xs mt-0.5">Comunicación con los servidores del SII</CardDescription>
            </div>
          </div>
          <Button disabled className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Reconectar SII
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
            <div className="flex items-center gap-3">
              <XCircle className="h-5 w-5 text-red-500 shrink-0" />
              <p className="text-sm text-red-800 dark:text-red-300">
                Sin conexión — configura primero la Localización Chilena para habilitar la comunicación con el SII.
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-2 shrink-0 ml-4" asChild>
              <Link href="/dashboard/dte/localizacion">
                <Link2 className="h-4 w-4" />
                Ir a Localización
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-slate-300 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Cola de Documentos</CardTitle>
          <CardDescription className="text-xs">Documentos pendientes de envío al SII</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID Documento</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Folio</TableHead>
                <TableHead className="text-center">Intentos</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Último Intento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <Loader2 className="h-10 w-10 opacity-20" />
                    <p className="text-sm">Cola vacía.</p>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-slate-300 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Log de Eventos</CardTitle>
          <CardDescription className="text-xs">Historial de comunicaciones con el SII</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Folio</TableHead>
                <TableHead>Detalle</TableHead>
                <TableHead>Resultado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <Clock className="h-10 w-10 opacity-20" />
                    <p className="text-sm">Sin eventos registrados.</p>
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
