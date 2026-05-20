"use client";

import React from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText, FileMinus, FilePlus, ShoppingBag, Building2,
  Truck, FileCheck, Globe, Receipt, MapPin, Link2, HelpCircle,
  AlertCircle, CheckCircle2, ArrowRight,
} from "lucide-react";

const DTE_TYPES = [
  {
    href: "/dashboard/dte/facturas",
    icon: FileText,
    label: "Factura Electrónica",
    code: "Tipo 33",
    description: "Ventas afectas a IVA a empresas y personas.",
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-900/20",
  },
  {
    href: "/dashboard/dte/notas-credito",
    icon: FileMinus,
    label: "Nota de Crédito",
    code: "Tipo 61",
    description: "Corrección o anulación de documentos emitidos.",
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-900/20",
  },
  {
    href: "/dashboard/dte/notas-debito",
    icon: FilePlus,
    label: "Nota de Débito",
    code: "Tipo 56",
    description: "Ajuste o cargo adicional sobre documentos emitidos.",
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-50 dark:bg-orange-900/20",
  },
  {
    href: "/dashboard/dte/facturas-compras",
    icon: ShoppingBag,
    label: "Factura de Compras",
    code: "Tipo 46",
    description: "Compras donde el comprador retiene el IVA.",
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-900/20",
  },
  {
    href: "/dashboard/dte/facturas-proveedores",
    icon: Building2,
    label: "Factura de Proveedores",
    code: "Recibida",
    description: "Registro de facturas recibidas de proveedores.",
    color: "text-slate-600 dark:text-slate-400",
    bg: "bg-slate-50 dark:bg-slate-900/20",
  },
  {
    href: "/dashboard/dte/guias-despacho",
    icon: Truck,
    label: "Guía de Despacho",
    code: "Tipo 52",
    description: "Traslado de mercaderías entre bodegas o a clientes.",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-900/20",
  },
  {
    href: "/dashboard/dte/facturas-exentas",
    icon: FileCheck,
    label: "Factura Exenta",
    code: "Tipo 34",
    description: "Ventas no afectas o exentas de IVA.",
    color: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-50 dark:bg-teal-900/20",
  },
  {
    href: "/dashboard/dte/exportacion",
    icon: Globe,
    label: "Doc. de Exportación",
    code: "Tipos 110-112",
    description: "Facturas, liquidaciones y notas de exportación.",
    color: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-50 dark:bg-cyan-900/20",
  },
  {
    href: "/dashboard/dte/boletas",
    icon: Receipt,
    label: "Boleta Electrónica",
    code: "Tipo 39",
    description: "Ventas al consumidor final con o sin RUT.",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
  },
];

const TOOLS = [
  {
    href: "/dashboard/dte/localizacion",
    icon: MapPin,
    label: "Localización Chilena",
    description: "Configura RUT empresa, giro, dirección y certificado digital.",
  },
  {
    href: "/dashboard/dte/integracion-sii",
    icon: Link2,
    label: "Integración SII",
    description: "Estado de conexión en tiempo real con el SII.",
  },
  {
    href: "/dashboard/dte/soporte",
    icon: HelpCircle,
    label: "Soporte Técnico",
    description: "Documentación, guías y contacto para resolver dudas.",
  },
];

export default function DtePage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Facturación DTE"
        description="Gestión de Documentos Tributarios Electrónicos conforme a la normativa del SII de Chile."
      />

      {/* Estado conexión SII */}
      <Card className="border-l-4 border-l-amber-500 shadow-sm">
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
              <div>
                <p className="font-semibold text-sm">Módulo en Configuración</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Configura los datos de tu empresa y el certificado digital para comenzar a emitir DTE.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800">
                SII: No configurado
              </Badge>
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/dte/localizacion">
                  Configurar ahora <ArrowRight className="ml-2 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Estadísticas globales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Emitidos (mes)", value: "0", sub: "documentos" },
          { label: "Pendientes SII", value: "0", sub: "en cola" },
          { label: "Rechazados SII", value: "0", sub: "con error" },
          { label: "Monto Total", value: "$0", sub: "este mes" },
        ].map(({ label, value, sub }) => (
          <Card key={label} className="shadow-sm">
            <CardContent className="pt-5 pb-4">
              <p className="text-3xl font-bold">{value}</p>
              <p className="text-sm font-medium mt-1">{label}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tipos de documento */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Documentos Tributarios</CardTitle>
          <CardDescription>Selecciona el tipo de documento que deseas emitir o consultar.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {DTE_TYPES.map(({ href, icon: Icon, label, code, description, color, bg }) => (
              <Link key={href} href={href}>
                <div className="group flex items-start gap-4 p-4 rounded-xl border hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer bg-card">
                  <div className={`p-2.5 rounded-lg ${bg} shrink-0`}>
                    <Icon className={`h-5 w-5 ${color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm group-hover:text-emerald-600 transition-colors">{label}</p>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{code}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald-500 shrink-0 mt-0.5 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Herramientas */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Configuración y Soporte</CardTitle>
          <CardDescription>Herramientas para configurar la integración con el SII y resolver problemas.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {TOOLS.map(({ href, icon: Icon, label, description }) => (
              <Link key={href} href={href}>
                <div className="group flex items-start gap-4 p-4 rounded-xl border hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer bg-card">
                  <div className="p-2.5 rounded-lg bg-muted shrink-0">
                    <Icon className="h-5 w-5 text-muted-foreground group-hover:text-emerald-600 transition-colors" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm group-hover:text-emerald-600 transition-colors">{label}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
