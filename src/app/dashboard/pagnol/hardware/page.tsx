"use client";

import React from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QrCode, Fingerprint, Printer, FileText, ArrowRight, CheckCircle2, Clock, AlertCircle, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/modules/core/contexts/app-provider";

const HardwareIntegrationPage: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super-admin';

  const hardwareItems = [
    {
      id: "qr-readers",
      href: "/dashboard/pagnol/hardware/qr-readers",
      icon: QrCode,
      title: "Lectores de Códigos QR/Barras",
      description: "Pistola láser USB/Bluetooth para identificación de activos y personal en tiempo real. Compatible con emulación de teclado HID.",
      status: "Activo",
      statusColor: "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300",
    },
    {
      id: "label-printing",
      href: "/dashboard/pagnol/hardware/label-printing",
      icon: Printer,
      title: "Impresión de Etiquetas QR",
      description: "Genera e imprime etiquetas adhesivas 22×32mm con código QR único por activo y logo corporativo.",
      status: "Activo",
      statusColor: "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300",
    },
    {
      id: "biometric-verification",
      href: "/dashboard/pagnol/hardware/biometric-verification",
      icon: Fingerprint,
      title: "Verificación Biométrica Facial",
      description: "Estación de prueba del sistema de reconocimiento facial. Verifica enrolamientos y hardware de cámara antes del turno.",
      status: "Activo",
      statusColor: "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300",
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Integración de Hardware"
        description="Módulos de integración con hardware especializado para la faena."
      />

      {/* Hardware Items Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {hardwareItems.map((item) => (
          <Link key={item.id} href={item.href}>
            <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-100 dark:bg-card overflow-hidden group hover:shadow-2xl transition-all h-full cursor-pointer">
              <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center gap-6 p-8">
                <div className="p-4 bg-primary/10 rounded-[1.5rem] text-primary group-hover:scale-110 transition-transform shrink-0">
                  <item.icon className="h-7 w-7" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <CardTitle className="text-base font-black uppercase leading-tight">{item.title}</CardTitle>
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  </div>
                  <CardDescription className="text-xs font-medium text-muted-foreground leading-relaxed">{item.description}</CardDescription>
                  <Badge className={`mt-3 text-[9px] font-black uppercase rounded-lg ${item.statusColor} border-none`}>
                    {item.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="px-8 pb-8">
                <Button className="w-full bg-primary hover:bg-primary/90 text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all">
                  Acceder <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Super-admin only: Contrato de Responsabilidad */}
      {isSuperAdmin && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <ShieldCheck size={16} className="text-pagnol-orange" />
            <p className="text-[10px] font-black uppercase tracking-widest text-pagnol-orange">Solo Visible para Super-Admin</p>
          </div>
          <Link href="/dashboard/pagnol/hardware/liability-contract">
            <Card className="rounded-[2.5rem] border-2 border-pagnol-orange/20 bg-pagnol-orange/5 dark:bg-pagnol-orange/5 overflow-hidden group hover:border-pagnol-orange/40 hover:shadow-xl transition-all cursor-pointer">
              <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center gap-6 p-8">
                <div className="p-4 bg-pagnol-orange/10 rounded-[1.5rem] text-pagnol-orange group-hover:scale-110 transition-transform shrink-0">
                  <FileText className="h-7 w-7" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <CardTitle className="text-base font-black uppercase">Contratos de Responsabilidad</CardTitle>
                    <Badge className="text-[9px] font-black uppercase rounded-lg bg-pagnol-orange/10 text-pagnol-orange border-none">Super-Admin</Badge>
                  </div>
                  <CardDescription className="text-xs font-medium text-muted-foreground leading-relaxed">
                    Gestión y auditoría de contratos de responsabilidad del hardware entregado a cada empresa. Visible únicamente desde el panel de Pagnol.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="px-8 pb-8">
                <Button className="w-full bg-pagnol-orange hover:bg-orange-600 text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all">
                  Gestionar Contratos <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </Link>
        </div>
      )}

      {/* Estado de integración */}
      <Card className="rounded-[2.5rem] border-none shadow-xl bg-pagnol-teal text-white overflow-hidden">
        <CardHeader className="p-8 sm:p-10">
          <CardTitle className="text-xl font-black uppercase">Estado de Integración</CardTitle>
        </CardHeader>
        <CardContent className="px-8 sm:px-10 pb-8 sm:pb-10 space-y-3">
          {[
            { label: "Lectores QR/Barras", detail: "Operativo. Compatible con emulación de teclado HID." },
            { label: "Impresión de Etiquetas", detail: "Operativo. Etiquetas 22×32mm con soporte multi-impresora." },
            { label: "Verificación Biométrica Facial", detail: "Operativo. Reconocimiento facial 1:N con Face-API.js." },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-3 text-sm text-white/80">
              <CheckCircle2 size={16} className="text-pagnol-orange mt-0.5 shrink-0" />
              <p><strong className="text-white">{item.label}:</strong> {item.detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default HardwareIntegrationPage;
