"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  Wallet, 
  CalendarCheck, 
  FileText, 
  ChevronRight, 
  TrendingUp, 
  AlertCircle,
  Download,
  Edit
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import { startOfMonth, getDaysInMonth, formatDistanceToNow, isToday } from 'date-fns';
import { es } from 'date-fns/locale';
import { DailyTalk } from '@/modules/core/lib/data';

export default function WorkerDashboard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { attendanceLogs, addSalaryAdvanceRequest, dailyTalks } = useAppState();
  const [isAdvanceModalOpen, setAdvanceModalOpen] = useState(false);
  
  const workerData = useMemo(() => {
    if (!user || !attendanceLogs) {
      return { baseSalary: 0, daysWorked: 0, totalWorkingDays: 30, advancesTaken: 0 };
    }

    const today = new Date();
    const start = startOfMonth(today);
    const totalWorkingDays = getDaysInMonth(today);

    const workedDaysSet = new Set<string>();
    attendanceLogs.forEach(log => {
      if (log.userId === user.id) {
        const logDate = log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp);
        if (logDate >= start && logDate <= today) {
          workedDaysSet.add(logDate.toDateString());
        }
      }
    });

    return {
      name: user.name,
      baseSalary: user.baseSalary || 0,
      daysWorked: workedDaysSet.size,
      totalWorkingDays,
      advancesTaken: 0, // Placeholder, needs salaryAdvances collection
    };
  }, [user, attendanceLogs]);

  const {
    baseSalary, daysWorked, totalWorkingDays, advancesTaken, name
  } = workerData;
  
  const pendingTalks = useMemo(() => {
    if (!user || !dailyTalks) return [];
    return dailyTalks.filter(talk => 
      talk.asistentes.some(a => a.id === user.id && !a.signed)
    ).sort((a,b) => (b.fecha as any) - (a.fecha as any));
  }, [dailyTalks, user]);

  // --- Cálculos Financieros ---
  const dailyRate = baseSalary / 30;
  const currentEarnings = Math.floor(dailyRate * daysWorked);
  
  // Política: Máximo adelanto es 50% de lo ganado menos lo ya pedido
  const maxAdvanceLimit = Math.max(0, Math.floor(currentEarnings * 0.50) - advancesTaken);
  const canRequestAdvance = maxAdvanceLimit > 10000; // Mínimo 10k para pedir

  const [requestedAmount, setRequestedAmount] = useState(canRequestAdvance ? Math.min(50000, maxAdvanceLimit) : 10000);

   React.useEffect(() => {
    setRequestedAmount(canRequestAdvance ? Math.min(50000, maxAdvanceLimit) : 10000);
  }, [maxAdvanceLimit, canRequestAdvance]);

  const handleRequestAdvance = async () => {
    if (!user) return;
    try {
        await addSalaryAdvanceRequest({
            workerId: user.id,
            workerName: user.name,
            amount: requestedAmount,
        });
        toast({
            title: "Solicitud enviada 💸",
            description: `Se ha solicitado un adelanto de ${formatCLP(requestedAmount)}. Recibirás confirmación pronto.`,
        });
        setAdvanceModalOpen(false);
    } catch(e) {
        toast({
            variant: "destructive",
            title: "Error al solicitar",
            description: "No se pudo procesar tu solicitud de adelanto."
        });
    }
  };

  const formatCLP = (amount: number) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };
  
    const formatRelativeDate = (date: any) => {
        const d = date instanceof Date ? date : new Date(date);
        if (isToday(d)) return "Hoy";
        return formatDistanceToNow(d, { addSuffix: true, locale: es });
    }

  return (
    <div className="max-w-md mx-auto space-y-6 pb-10 fade-in">
      
      {/* Header Saludo */}
      <div className="flex justify-between items-center pt-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Hola, {name?.split(' ')[0]} 👋</h2>
          <p className="text-muted-foreground">{user?.cargo || 'Trabajador'}</p>
        </div>
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
            {(user?.name.split(' ').map(n => n[0]).join('') || 'U')}
        </div>
      </div>

      {/* --- TARJETA DE FIRMAS PENDIENTES --- */}
      {pendingTalks.length > 0 && (
          <Card className="border-amber-500 border-l-4">
              <CardHeader>
                  <CardTitle className="text-amber-600 flex items-center gap-2">
                      <Edit className="h-5 w-5"/> Tienes Firmas Pendientes
                  </CardTitle>
                  <CardDescription>
                      Debes firmar las charlas de seguridad a las que asististe.
                  </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                  {pendingTalks.map(talk => (
                      <Link key={talk.id} href={`/dashboard/worker/sign-talk/${talk.id}`}>
                        <div className="flex justify-between items-center p-3 rounded-lg hover:bg-muted/50 transition-colors border">
                            <div>
                                <p className="font-semibold text-sm">Charla del {formatRelativeDate(talk.fecha)}</p>
                                <p className="text-xs text-muted-foreground truncate max-w-[200px]">{talk.temas}</p>
                            </div>
                            <ChevronRight className="h-5 w-5 text-muted-foreground"/>
                        </div>
                      </Link>
                  ))}
              </CardContent>
          </Card>
      )}

      {/* --- TARJETA PRINCIPAL: BILLETERA --- */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-slate-900 to-slate-800 text-white overflow-hidden relative">
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-primary/20 rounded-full blur-2xl"></div>

        <CardHeader className="pb-2">
          <CardDescription className="text-slate-300 flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Tu Saldo Acumulado (Estimado)
          </CardDescription>
          <div className="text-4xl font-extrabold tracking-tight">
            {formatCLP(currentEarnings)}
          </div>
        </CardHeader>
        
        <CardContent>
           <div className="flex justify-between text-sm mb-2 text-slate-300">
              <span>Días trabajados: {daysWorked}</span>
              <span>Meta mes: {totalWorkingDays}</span>
           </div>
           <Progress value={(daysWorked / totalWorkingDays) * 100} className="h-2 bg-slate-700 [&>div]:bg-green-400" />
           
           <div className="mt-6 p-3 bg-white/10 rounded-lg backdrop-blur-sm border border-white/5">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-slate-200">Disponible para Adelanto</span>
                <Badge variant="secondary" className="bg-green-500/20 text-green-300 border-0">
                    Disponible
                </Badge>
              </div>
              <div className="text-2xl font-bold text-green-400">
                  {formatCLP(maxAdvanceLimit)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                 Ya has solicitado: {formatCLP(advancesTaken)}
              </p>
           </div>
        </CardContent>

        <CardFooter>
          <Button 
            onClick={() => setAdvanceModalOpen(true)}
            disabled={!canRequestAdvance}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-md"
          >
            {canRequestAdvance ? 'Solicitar Adelanto Ahora' : 'Saldo insuficiente para adelanto'}
          </Button>
        </CardFooter>
      </Card>

      {/* --- MENU DE ACCESOS RÁPIDOS --- */}
      <div className="grid grid-cols-2 gap-4">
          <Card className="hover:bg-muted/50 cursor-pointer transition-colors">
             <CardContent className="p-4 flex flex-col items-center justify-center text-center gap-2">
                <div className="p-3 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                    <CalendarCheck className="h-6 w-6" />
                </div>
                <span className="font-semibold text-sm">Mi Asistencia</span>
             </CardContent>
          </Card>

          <Card className="hover:bg-muted/50 cursor-pointer transition-colors">
             <CardContent className="p-4 flex flex-col items-center justify-center text-center gap-2">
                <div className="p-3 rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                    <FileText className="h-6 w-6" />
                </div>
                <span className="font-semibold text-sm">Liquidaciones</span>
             </CardContent>
          </Card>
      </div>

      {/* --- LISTA DE LIQUIDACIONES RECIENTES --- */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
            Últimas Liquidaciones <ChevronRight className="h-4 w-4 text-muted-foreground"/>
        </h3>
        {[
            { month: 'Enero 2024', amount: 850000, date: '30/01/2024' },
            { month: 'Diciembre 2023', amount: 820000, date: '30/12/2023' }
        ].map((pay, i) => (
            <div key={i} className="flex items-center justify-between p-4 border rounded-xl bg-card shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                        <p className="font-medium">{pay.month}</p>
                        <p className="text-xs text-muted-foreground">Pagado el {pay.date}</p>
                    </div>
                </div>
                <div className="text-right">
                    <p className="font-bold text-sm">{formatCLP(pay.amount)}</p>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 mt-1">
                        <Download className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        ))}
      </div>

      {/* --- MODAL DE SOLICITUD DE ADELANTO --- */}
      <Dialog open={isAdvanceModalOpen} onOpenChange={setAdvanceModalOpen}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Solicitar Adelanto de Sueldo</DialogTitle>
                <DialogDescription>
                    El monto se descontará de tu liquidación a fin de mes.
                </DialogDescription>
            </DialogHeader>

            <div className="py-6 space-y-6">
                <div className="text-center">
                    <span className="text-4xl font-bold text-primary">
                        {formatCLP(requestedAmount)}
                    </span>
                    <p className="text-sm text-muted-foreground mt-1">Monto a recibir</p>
                </div>

                <div className="space-y-4">
                    <Slider 
                        value={[requestedAmount]} 
                        min={10000} 
                        max={maxAdvanceLimit} 
                        step={5000}
                        onValueChange={(val) => setRequestedAmount(val[0])}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Mín: {formatCLP(10000)}</span>
                        <span>Máx: {formatCLP(maxAdvanceLimit)}</span>
                    </div>
                </div>

                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-md flex gap-3 items-start border border-yellow-200 dark:border-yellow-800">
                    <AlertCircle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-700 dark:text-yellow-400">
                        La transferencia puede tardar hasta 24 horas hábiles. Al aceptar, autorizas el descuento en tu próxima liquidación.
                    </p>
                </div>
            </div>

            <DialogFooter>
                <Button variant="outline" onClick={() => setAdvanceModalOpen(false)}>Cancelar</Button>
                <Button onClick={handleRequestAdvance}>Confirmar Solicitud</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
