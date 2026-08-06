'use client';

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import {
  Briefcase, DollarSign, TrendingUp, ChevronRight,
  FileText, Clock, CheckCircle2, AlertCircle, History, ArrowRight
} from 'lucide-react';
import { LoadingState } from '@/components/loading-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { WorkItem } from '@/modules/core/lib/data';
import { cn } from '@/lib/utils';

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(v);

type WorkItemStatus = WorkItem['status'];

const statusConfig: Record<WorkItemStatus, { label: string; bg: string; text: string; Icon: React.ComponentType<any> }> = {
  'in-progress': { label: 'En Ejecución', bg: 'bg-info-subtle', text: 'text-info-subtle-foreground', Icon: Clock },
  'pending-quality-review': { label: 'Rev. Calidad', bg: 'bg-warning-subtle', text: 'text-warning-subtle-foreground', Icon: AlertCircle },
  'completed': { label: 'Completado', bg: 'bg-success-subtle', text: 'text-success-subtle-foreground', Icon: CheckCircle2 },
  'rejected': { label: 'Rechazado', bg: 'bg-destructive/10', text: 'text-destructive', Icon: AlertCircle },
};

const calcContractTotals = (rootId: string, allItems: WorkItem[]) => {
  const children: WorkItem[] = [];
  const collect = (parentId: string) => {
    allItems.filter(i => i.parentId === parentId).forEach(child => {
      children.push(child);
      collect(child.id);
    });
  };
  collect(rootId);

  const totalValue = children.reduce((acc, i) => acc + (i.quantity || 0) * (i.unitPrice || 0), 0);
  const earnedValue = children.reduce((acc, i) => acc + (i.quantity || 0) * (i.unitPrice || 0) * (i.progress || 0) / 100, 0);
  const progress = totalValue > 0 ? (earnedValue / totalValue) * 100 : 0;

  return { totalValue, earnedValue, progress, itemCount: children.length };
};

export default function MisContratosPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { workItems, isLoading } = useAppState();

  const myContracts = useMemo(() => {
    if (!user || !workItems) return [];
    return workItems.filter(
      item => item.parentId === null && (item.assignedTo === user.id || item.createdBy === user.id)
    );
  }, [workItems, user]);

  if (isLoading) {
    return <LoadingState fullHeight />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Mis Contratos"
          description="Selecciona un contrato para ver su avance y generar estados de pago."
          className="mb-0 border-0 pb-0"
        />
        <Button variant="outline" onClick={() => router.push('/dashboard/estado-pago/historial')} className="shrink-0">
          <History className="mr-2 h-4 w-4" />
          Historial EP
        </Button>
      </div>

      {myContracts.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-64 border-2 border-dashed rounded-xl text-muted-foreground gap-4 py-16 px-6">
          <div className="p-4 bg-muted/50 rounded-full">
            <Briefcase className="h-10 w-10 opacity-40" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="text-lg font-semibold text-foreground">Sin contratos asignados</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Para que aparezca un contrato aquí, un administrador debe crearlo en
              <strong className="text-foreground"> Control de Obra → Partidas (EDT)</strong> y
              asignarlo a tu usuario como responsable.
            </p>
          </div>
          <Button variant="outline" onClick={() => router.push('/dashboard/construction-control/wbs')}>
            Ir a Partidas (EDT)
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {myContracts.map(contract => {
            const { totalValue, earnedValue, progress, itemCount } = calcContractTotals(contract.id, workItems);
            const s = statusConfig[contract.status] ?? statusConfig['in-progress'];
            const { Icon } = s;

            return (
              <Card
                key={contract.id}
                className="cursor-pointer hover:shadow-md transition-all hover:border-primary/30 group"
                onClick={() => router.push(`/dashboard/estado-pago/contratos/${contract.id}`)}
              >
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0 space-y-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground text-base">{contract.name}</h3>
                        <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full', s.bg, s.text)}>
                          <Icon className="h-2.5 w-2.5" />
                          {s.label}
                        </span>
                      </div>

                      <p className="text-xs text-muted-foreground font-mono -mt-3">
                        #{contract.id.substring(0, 8).toUpperCase()} &bull; {itemCount} partida{itemCount !== 1 ? 's' : ''}
                      </p>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-info-subtle rounded-md text-info shrink-0">
                            <DollarSign className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <p className="text-[10px] uppercase text-muted-foreground font-bold leading-tight">Monto Total</p>
                            <p className="text-sm font-bold">{formatCurrency(totalValue)}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-success-subtle rounded-md text-success shrink-0">
                            <TrendingUp className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <p className="text-[10px] uppercase text-muted-foreground font-bold leading-tight">Valor Ganado</p>
                            <p className="text-sm font-bold text-success">{formatCurrency(earnedValue)}</p>
                          </div>
                        </div>

                        <div className="col-span-2 md:col-span-1">
                          <p className="text-[10px] uppercase text-muted-foreground font-bold mb-1.5">Avance General</p>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className={cn('h-full rounded-full transition-all', progress >= 100 ? 'bg-success' : 'bg-info')}
                                style={{ width: `${Math.min(100, progress)}%` }}
                              />
                            </div>
                            <span className="text-xs font-mono font-bold w-10 text-right shrink-0">
                              {progress.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
