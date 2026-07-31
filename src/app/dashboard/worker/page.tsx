"use client";

import React, { useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Wallet,
  CalendarCheck,
  ChevronRight,
  Edit,
  ArrowRight,
} from 'lucide-react';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import { formatDistanceToNow, isToday } from 'date-fns';
import { es } from 'date-fns/locale';

// El flujo de adelantos que vivía en esta página quedó RETIRADO.
//
// Era una copia de `/dashboard/wallet` con la lógica financiera duplicada, y la
// copia tenía el candado suelto: `advancesTaken` estaba fijo en 0 con un
// comentario `// Placeholder`, así que el cupo del 50% ignoraba lo ya
// solicitado. Se podía pedir el máximo tantas veces como se quisiera desde acá,
// mientras la billetera —la misma tabla, el mismo trabajador— sí lo descontaba.
//
// También se retiró la lista "Últimas Liquidaciones": eran dos montos
// inventados en el código (Enero 2024 $850.000, Diciembre 2023 $820.000) con un
// botón de descarga que no descargaba nada. Las liquidaciones reales están en
// `payroll_lines` desde F3 y se muestran en la billetera.
//
// Regla: el saldo, el cupo y los adelantos se calculan en UN solo lugar.

export default function WorkerDashboard() {
  const { user } = useAuth();
  const { dailyTalks } = useAppState();

  const pendingTalks = useMemo(() => {
    if (!user || !dailyTalks) return [];
    return dailyTalks.filter(talk =>
      talk.asistentes.some(a => a.id === user.id && !a.signed)
    ).sort((a, b) => (b.fecha as any) - (a.fecha as any));
  }, [dailyTalks, user]);

  const formatRelativeDate = (date: any) => {
    const d = date instanceof Date ? date : new Date(date);
    if (isToday(d)) return "Hoy";
    return formatDistanceToNow(d, { addSuffix: true, locale: es });
  };

  return (
    <div className="max-w-md mx-auto space-y-6 pb-10 animate-in fade-in duration-500">

      {/* Header Saludo */}
      <div className="flex justify-between items-center pt-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Hola, {user?.name?.split(' ')[0]} 👋</h2>
          <p className="text-muted-foreground">{user?.cargo || 'Trabajador'}</p>
        </div>
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
          {(user?.name?.split(' ').map(n => n[0]).join('') || 'U')}
        </div>
      </div>

      {/* --- TARJETA DE FIRMAS PENDIENTES --- */}
      {pendingTalks.length > 0 && (
        <Card className="border-warning border-l-4">
          <CardHeader>
            <CardTitle className="text-warning-subtle-foreground flex items-center gap-2">
              <Edit className="h-5 w-5" /> Tienes Firmas Pendientes
            </CardTitle>
            <CardDescription>
              Debes firmar las charlas de seguridad a las que asististe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingTalks.map(talk => (
              <Link key={talk.id} href={`/dashboard/worker/sign-talk/${talk.id}`}>
                <div className="flex justify-between items-center p-3 rounded-xl hover:bg-muted/50 transition-colors border">
                  <div>
                    <p className="font-semibold text-sm">Charla del {formatRelativeDate(talk.fecha)}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-[200px]">{talk.temas}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* --- ACCESO A LA BILLETERA (fuente única de saldo y adelantos) --- */}
      <Card className="rounded-[1.5rem] overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg font-bold">
            <Wallet className="h-5 w-5 text-primary" /> Mi Billetera
          </CardTitle>
          <CardDescription>
            Tu saldo acumulado del mes, tus liquidaciones y la solicitud de adelanto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full rounded-xl font-semibold">
            <Link href="/dashboard/wallet" className="flex items-center justify-center gap-2">
              Abrir mi billetera <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* --- MENU DE ACCESOS RÁPIDOS --- */}
      <div className="grid grid-cols-2 gap-4">
        <Link href="/dashboard/attendance">
          <Card className="hover:bg-muted/50 transition-colors h-full">
            <CardContent className="p-4 flex flex-col items-center justify-center text-center gap-2">
              <div className="p-3 rounded-full bg-info-subtle text-info-subtle-foreground">
                <CalendarCheck className="h-6 w-6" />
              </div>
              <span className="font-semibold text-sm">Mi Asistencia</span>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/wallet">
          <Card className="hover:bg-muted/50 transition-colors h-full">
            <CardContent className="p-4 flex flex-col items-center justify-center text-center gap-2">
              <div className="p-3 rounded-full bg-primary/10 text-primary">
                <Wallet className="h-6 w-6" />
              </div>
              <span className="font-semibold text-sm">Adelantos</span>
            </CardContent>
          </Card>
        </Link>
      </div>

    </div>
  );
}
