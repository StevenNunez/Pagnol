"use client";

import React, { useState, useMemo } from "react";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import QRCode from "react-qr-code";
import { Printer, ArrowLeft, Loader2, AlertCircle, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { User, UserRole } from "@/modules/core/lib/data";
import { ROLES } from "@/modules/core/lib/permissions";

export default function PrintUserQrPage() {
  const { users, isLoading } = useAppState();
  const { can } = useAuth();
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");

  const handlePrint = () => {
    window.print();
  };

  const filteredUsers = useMemo(() => {
    const safeUsers: User[] = users || [];
    if (!searchTerm) {
      return safeUsers;
    }
    return safeUsers.filter((user: User) =>
      user.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [users, searchTerm]);

  const getRoleDisplayName = (role: UserRole) => {
    return ROLES[role]?.label || role;
  }

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
    <div className="print-container flex flex-col gap-8 min-h-screen bg-slate-50/50">
      {/* Controles solo visibles en pantalla */}
      <div className="print-hide max-w-7xl mx-auto w-full px-6 py-8 space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <PageHeader
            title="Centro de Impresión de Credenciales"
            description="Genera tarjetas operativas de alta visibilidad con códigos QR para el control de acceso y activos Pagnol."
          />
          <div className="flex gap-4 shrink-0">
            <Button variant="outline" onClick={() => router.back()} className="h-12 px-6 rounded-xl font-black text-[10px] uppercase tracking-widest border-slate-200">
              <ArrowLeft className="mr-3 h-4 w-4" />
              Panel de Usuarios
            </Button>
            <Button onClick={handlePrint} className="h-12 px-8 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-slate-900/10">
              <Printer className="mr-3 h-4 w-4" />
              Lanzar Impresión
            </Button>
          </div>
        </div>

        <Card className="rounded-[2.5rem] border-none shadow-2xl bg-card overflow-hidden">
          <div className="p-8 space-y-6">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filtrar colaboradores por nombre..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-12 h-14 bg-slate-50 border-none rounded-2xl focus-visible:ring-primary/20 font-medium"
                />
              </div>
              <div className="px-6 py-3 bg-primary/5 rounded-2xl border border-primary/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-primary">Total Seleccionados: {filteredUsers.length}</p>
              </div>
            </div>

            <Alert className="rounded-2xl bg-orange-50 border-orange-100">
              <AlertCircle className="h-4 w-4 text-orange-600" />
              <AlertTitle className="text-orange-900 font-black text-[10px] uppercase tracking-widest">Recomendación de Impresión</AlertTitle>
              <AlertDescription className="text-orange-800/80 text-xs">
                Para mejores resultados, imprimir en papel Opalina o PVC con escala de color al 100%. Las dimensiones están ajustadas a estándar de credencial CR80.
              </AlertDescription>
            </Alert>
          </div>
        </Card>
      </div>

      {/* Área imprimible */}
      <div className="max-w-7xl mx-auto w-full px-6 pb-20 print-content">
        <div className="grid print-grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center justify-center p-4 border rounded-[2rem] aspect-[54/86] bg-muted animate-pulse" />
            ))
          ) : (
            filteredUsers.filter((u: User) => u.qrCode && u.qrCode.trim() !== '').map((user: User) => (
              <div key={user.id} className="qr-item-container group flex flex-col items-center bg-white rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-2xl hover:border-primary/20 transition-all duration-300 overflow-hidden aspect-[54/86] relative">
                {/* Header de la Credencial */}
                <div className="w-full industrial-gradient p-5 flex flex-col items-center gap-1 shrink-0">
                  <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center mb-1">
                    <span className="text-white font-black text-[10px]">P</span>
                  </div>
                  <h3 className="font-black text-white text-[11px] uppercase tracking-widest leading-none text-center truncate w-full">{user.name}</h3>
                  <p className="text-[8px] font-black text-white/60 uppercase tracking-[0.2em]">{getRoleDisplayName(user.role)}</p>
                </div>

                {/* Cuerpo de la Credencial */}
                <div className="flex-1 w-full flex flex-col items-center justify-center p-6 bg-white gap-4">
                  <div className="p-3 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 group-hover:border-primary/30 transition-colors">
                    <QRCode value={user.qrCode} size={130} fgColor="#0f172a" />
                  </div>

                  <div className="space-y-1 text-center">
                    <p className="text-[10px] font-black text-slate-900 uppercase tracking-widest">{user.internalId || 'S/N'}</p>
                    {user.rut && <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">RUT: {user.rut}</p>}
                  </div>
                </div>

                {/* Footer de la Credencial */}
                <div className="w-full h-8 bg-slate-50 border-t flex items-center justify-center px-4 shrink-0">
                  <p className="text-[7px] font-black text-muted-foreground uppercase tracking-[0.3em]">Validación de Activos Pagnol</p>
                </div>

                {/* Badge flotante solo en pantalla */}
                <div className="absolute top-4 right-4 print-hide opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="bg-primary text-white text-[8px] font-black px-2 py-1 rounded-full shadow-lg uppercase tracking-widest">Listo</div>
                </div>
              </div>
            ))
          )}
          {filteredUsers.length === 0 && !isLoading && (
            <div className="col-span-full text-center py-20 bg-white rounded-[3rem] border-2 border-dashed border-slate-100">
              <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="text-slate-300" />
              </div>
              <p className="text-muted-foreground font-bold uppercase text-xs tracking-widest">No hay resultados para la búsqueda actual</p>
            </div>
          )}
        </div>
      </div>

      {/* Estilos para impresión actualizados */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 1cm;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            background-color: white !important;
          }
          .print-hide { display: none !important; }
          .print-container { background: white !important; padding: 0 !important; margin: 0 !important; }
          .print-content { padding: 0 !important; margin: 0 !important; max-width: 100% !important; }
          .print-grid {
             display: grid !important;
             grid-template-columns: repeat(3, 1fr) !important;
             gap: 15px !important;
          }
          .qr-item-container {
             border: 1px solid #e2e8f0 !important;
             box-shadow: none !important;
             border-radius: 12px !important;
             page-break-inside: avoid;
             height: 8.6cm !important; 
             width: 5.4cm !important;
             background-color: white !important;
          }
          .industrial-gradient {
             background: #0f172a !important;
             color: white !important;
             padding: 12px !important;
          }
        }
      `}</style>
    </div>
  );
}
