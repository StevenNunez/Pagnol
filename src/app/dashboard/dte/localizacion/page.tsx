"use client";

import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle, MapPin, Shield, Building2 } from "lucide-react";

const tiposDTE = [
  { tipo: "Factura Electrónica", codigo: "33", folios: 0, proximo: "—" },
  { tipo: "Factura Exenta", codigo: "34", folios: 0, proximo: "—" },
  { tipo: "Boleta Electrónica", codigo: "39", folios: 0, proximo: "—" },
  { tipo: "Liquidación Factura", codigo: "46", folios: 0, proximo: "—" },
  { tipo: "Guía de Despacho", codigo: "52", folios: 0, proximo: "—" },
  { tipo: "Nota de Débito", codigo: "56", folios: 0, proximo: "—" },
  { tipo: "Nota de Crédito", codigo: "61", folios: 0, proximo: "—" },
  { tipo: "Factura de Exportación", codigo: "110", folios: 0, proximo: "—" },
];

export default function LocalizacionPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Localización Chilena"
        description="Configura los datos fiscales de tu empresa para operar conforme a la normativa del SII."
      />

      <Alert className="border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-900/20">
        <AlertCircle className="h-5 w-5 text-amber-500" />
        <AlertTitle className="text-amber-800 dark:text-amber-300">Configuración requerida</AlertTitle>
        <AlertDescription className="text-amber-800 dark:text-amber-300">
          Sin completar esta configuración no podrás emitir ningún Documento Tributario Electrónico (DTE). Debes ingresar el RUT de la empresa, subir el certificado digital del SII y tener folios autorizados antes de comenzar a facturar.
        </AlertDescription>
      </Alert>

      <Card className="border-l-4 border-l-emerald-500 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-emerald-600" />
            <div>
              <CardTitle className="text-base">Datos de la Empresa</CardTitle>
              <CardDescription className="text-xs mt-0.5">Información tributaria registrada en el SII</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rut-empresa">RUT Empresa</Label>
              <Input
                id="rut-empresa"
                disabled
                placeholder="76.543.210-K"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="razon-social">Razón Social</Label>
              <Input
                id="razon-social"
                disabled
                placeholder="Constructora Atacama SpA"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nombre-fantasia">Nombre de Fantasía</Label>
              <Input
                id="nombre-fantasia"
                disabled
                placeholder="Constructora Atacama"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="giro">Giro Comercial</Label>
              <Input
                id="giro"
                disabled
                placeholder="Construcción de obras de ingeniería civil"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="codigo-actividad">Código de Actividad SII</Label>
              <Input
                id="codigo-actividad"
                disabled
                placeholder="421010"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="direccion">Dirección</Label>
              <Input
                id="direccion"
                disabled
                placeholder="Av. El Bosque Norte 500, Oficina 801"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="comuna">Comuna</Label>
              <Input
                id="comuna"
                disabled
                placeholder="Las Condes"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ciudad">Ciudad</Label>
              <Input
                id="ciudad"
                disabled
                placeholder="Santiago"
              />
            </div>
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label htmlFor="region">Región</Label>
              <Select disabled>
                <SelectTrigger id="region">
                  <SelectValue placeholder="Región Metropolitana de Santiago" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rm">Región Metropolitana de Santiago</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button disabled>Guardar Datos de Empresa</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-blue-500 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-blue-600" />
            <div>
              <CardTitle className="text-base">Certificado Digital SII</CardTitle>
              <CardDescription className="text-xs mt-0.5">Archivo .p12 o .pfx emitido por una entidad acreditada</CardDescription>
            </div>
          </div>
          <Badge variant="destructive" className="text-xs">No configurado</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="certificado">Archivo de Certificado (.p12 / .pfx)</Label>
              <Input
                id="certificado"
                type="file"
                disabled
                accept=".p12,.pfx"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cert-password">Contraseña del Certificado</Label>
              <Input
                id="cert-password"
                type="password"
                disabled
                placeholder="••••••••••••"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-3">
            <AlertCircle className="h-4 w-4 text-slate-400 shrink-0" />
            <p className="text-xs text-muted-foreground">Sin certificado configurado. El certificado digital es necesario para firmar electrónicamente todos los documentos tributarios.</p>
          </div>
          <div className="flex justify-end">
            <Button disabled>Guardar Certificado</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-violet-500 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <MapPin className="h-5 w-5 text-violet-600" />
            <div>
              <CardTitle className="text-base">Configuración de Folios</CardTitle>
              <CardDescription className="text-xs mt-0.5">Folios autorizados por el SII por tipo de documento</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo DTE</TableHead>
                <TableHead className="text-center">Código</TableHead>
                <TableHead className="text-center">Folios Disponibles</TableHead>
                <TableHead className="text-center">Próximo Folio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiposDTE.map((row) => (
                <TableRow key={row.codigo}>
                  <TableCell className="text-sm">{row.tipo}</TableCell>
                  <TableCell className="text-center font-mono text-xs">{row.codigo}</TableCell>
                  <TableCell className="text-center text-muted-foreground">{row.folios}</TableCell>
                  <TableCell className="text-center text-muted-foreground">{row.proximo}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end">
            <Button disabled>Guardar Configuración de Folios</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
