'use client';

import React, { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import {
  AlertCircle, Plus, FileCheck, Clock, CheckCircle2, XCircle,
  BookOpen, ChevronRight, Trash2, Search,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import { Protocol, ProtocolStatus } from '@/modules/core/lib/data';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/modules/core/hooks/use-toast';

const STATUS_CONFIG: Record<ProtocolStatus, { label: string; color: string; icon: React.ReactNode }> = {
  borrador: { label: 'Borrador', color: 'bg-slate-100 text-slate-700', icon: <FileCheck size={12} /> },
  pendiente_revision: { label: 'En Revisión', color: 'bg-amber-100 text-amber-700', icon: <Clock size={12} /> },
  aprobado: { label: 'Aprobado', color: 'bg-green-100 text-green-700', icon: <CheckCircle2 size={12} /> },
  rechazado: { label: 'Rechazado', color: 'bg-red-100 text-red-700', icon: <XCircle size={12} /> },
};

export default function ProtocolosPage() {
  const { user, can } = useAuth();
  const { protocols, deleteProtocol } = useAppState();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<ProtocolStatus | 'todos'>('todos');

  const canReview = can('construction_control:review_protocols');
  const canManageTemplates = can('construction_control:review_protocols');

  const filtered = useMemo(() => {
    const list = (protocols || []).filter(p => {
      if (!canReview) {
        return p.createdBy === user?.id;
      }
      return true;
    });

    const byTab = activeTab === 'todos' ? list : list.filter(p => p.status === activeTab);

    if (!search.trim()) return byTab;
    const q = search.toLowerCase();
    return byTab.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.obra.toLowerCase().includes(q) ||
      p.activityType.toLowerCase().includes(q)
    );
  }, [protocols, user, canReview, activeTab, search]);

  const counts = useMemo(() => {
    const base = (protocols || []).filter(p => !canReview ? p.createdBy === user?.id : true);
    return {
      todos: base.length,
      borrador: base.filter(p => p.status === 'borrador').length,
      pendiente_revision: base.filter(p => p.status === 'pendiente_revision').length,
      aprobado: base.filter(p => p.status === 'aprobado').length,
      rechazado: base.filter(p => p.status === 'rechazado').length,
    };
  }, [protocols, user, canReview]);

  const handleDelete = async (protocol: Protocol) => {
    try {
      await deleteProtocol(protocol.id);
      toast({ title: 'Protocolo eliminado', className: 'border-green-500' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  if (!can('module_construction_control:view')) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Acceso Denegado</AlertTitle>
        <AlertDescription>No tienes permisos para acceder a este módulo.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Protocolos de Calidad"
        description="Gestión de protocolos de inicio y entrega de actividades."
      />

      {/* Acciones superiores */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por título, obra o actividad..."
            className="pl-9 rounded-xl"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {canManageTemplates && (
            <Link href="/dashboard/construction-control/protocolos/plantillas">
              <Button variant="outline" className="gap-2 rounded-xl">
                <BookOpen size={15} /> Plantillas
              </Button>
            </Link>
          )}
          <Link href="/dashboard/construction-control/protocolos/nuevo">
            <Button className="gap-2 rounded-xl">
              <Plus size={15} /> Nuevo Protocolo
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs por estado */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ProtocolStatus | 'todos')}>
        <TabsList className="rounded-xl h-auto flex-wrap">
          <TabsTrigger value="todos" className="rounded-lg text-xs gap-1.5">
            Todos <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{counts.todos}</Badge>
          </TabsTrigger>
          <TabsTrigger value="borrador" className="rounded-lg text-xs gap-1.5">
            Borrador <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{counts.borrador}</Badge>
          </TabsTrigger>
          <TabsTrigger value="pendiente_revision" className="rounded-lg text-xs gap-1.5">
            En Revisión <Badge className="text-[10px] h-4 px-1.5 bg-amber-500 text-white">{counts.pendiente_revision}</Badge>
          </TabsTrigger>
          <TabsTrigger value="aprobado" className="rounded-lg text-xs gap-1.5">
            Aprobados <Badge className="text-[10px] h-4 px-1.5 bg-green-500 text-white">{counts.aprobado}</Badge>
          </TabsTrigger>
          <TabsTrigger value="rechazado" className="rounded-lg text-xs gap-1.5">
            Rechazados <Badge className="text-[10px] h-4 px-1.5 bg-red-500 text-white">{counts.rechazado}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {filtered.length === 0 ? (
            <Card className="rounded-[1.5rem] border-none shadow-lg bg-slate-50">
              <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
                <FileCheck size={40} className="text-muted-foreground/40" />
                <div>
                  <p className="font-semibold text-muted-foreground">Sin protocolos</p>
                  <p className="text-sm text-muted-foreground/70 mt-1">
                    {activeTab === 'todos' ? 'Crea tu primer protocolo de calidad.' : `No hay protocolos en estado "${STATUS_CONFIG[activeTab as ProtocolStatus]?.label ?? activeTab}".`}
                  </p>
                </div>
                <Link href="/dashboard/construction-control/protocolos/nuevo">
                  <Button className="gap-2 rounded-xl mt-2" size="sm">
                    <Plus size={14} /> Crear Protocolo
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {filtered.map(protocol => {
                const sc = STATUS_CONFIG[protocol.status];
                const isRejected = protocol.status === 'rechazado';
                const isDraft = protocol.status === 'borrador';
                return (
                  <Card
                    key={protocol.id}
                    className={`rounded-[1.5rem] border-none shadow-md transition-shadow hover:shadow-lg ${isRejected ? 'bg-red-50 dark:bg-red-900/10' : 'bg-slate-50 dark:bg-slate-800/50'}`}
                  >
                    <CardContent className="p-5 flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${isRejected ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'}`}>
                        <FileCheck size={20} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-sm truncate">{protocol.title}</p>
                          <Badge className={`text-[10px] font-semibold px-2 py-0.5 rounded-full gap-1 flex items-center ${sc.color}`}>
                            {sc.icon} {sc.label}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] rounded-full">
                            {protocol.type === 'inicio' ? 'Inicio' : 'Entrega'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <span className="font-medium">{protocol.obra}</span>
                          {protocol.activityType && ` · ${protocol.activityType}`}
                        </p>
                        {isRejected && protocol.rejectionReason && (
                          <p className="text-xs text-red-600 font-medium mt-1 line-clamp-1">
                            Motivo: {protocol.rejectionReason}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(protocol.createdAt as any), { addSuffix: true, locale: es })}
                          {protocol.completedAt && ` · Enviado ${format(new Date(protocol.completedAt as any), 'dd/MM/yyyy', { locale: es })}`}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isDraft && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl">
                                <Trash2 size={14} />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-[1.5rem]">
                              <AlertDialogHeader>
                                <AlertDialogTitle>Eliminar protocolo</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Esta acción no se puede deshacer. El protocolo &quot;{protocol.title}&quot; será eliminado permanentemente.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  className="rounded-xl bg-red-600 hover:bg-red-700"
                                  onClick={() => handleDelete(protocol)}
                                >
                                  Eliminar
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                        <Link href={`/dashboard/construction-control/protocolos/${protocol.id}`}>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl">
                            <ChevronRight size={16} />
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
