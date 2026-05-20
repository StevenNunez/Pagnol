
"use client";

import React, { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertCircle,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  CheckSquare,
  Inbox,
  Clock,
  MessageSquare,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import { WorkItem, User } from '@/modules/core/lib/data';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export default function RevisarProtocolosPage() {
  const { can } = useAuth();
  const { workItems, isLoading, approveWorkItem, rejectWorkItem, users } = useAppState();
  const { toast } = useToast();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  
  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    (users || []).forEach((u: User) => map.set(u.id, u.name));
    return map;
  }, [users]);

  const itemsForReview = useMemo(() => {
    return (workItems || [])
        .filter((item: WorkItem) => item.status === 'pending-quality-review')
        .sort((a,b) => (a.actualEndDate?.getTime() || 0) - (b.actualEndDate?.getTime() || 0));
  }, [workItems]);

  const handleAction = async (itemId: string, action: 'approve' | 'reject') => {
    setProcessingId(itemId);
    try {
        if (action === 'approve') {
            await approveWorkItem(itemId);
            toast({ title: "Partida Aprobada", description: "El estado ha sido actualizado a 'Completado'." });
        } else {
            const reason = rejectionReason.trim() || 'Rechazado por Calidad. Revisar observaciones.';
            await rejectWorkItem(itemId, reason);
            setRejectionReason('');
            toast({ title: "Partida Rechazada", description: "La partida ha sido devuelta al ejecutor para correcciones.", variant: 'destructive' });
        }
    } catch(error: any) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
        setProcessingId(null);
    }
  }

  if (!can('construction_control:review_protocols')) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Acceso Denegado</AlertTitle>
        <AlertDescription>
          No tienes los permisos necesarios para revisar protocolos.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Revisar Protocolos de Calidad"
        description="Bandeja de entrada para la revisión y aprobación de partidas finalizadas."
      />
      
      <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2">
                <CheckSquare className="h-5 w-5 text-primary"/> Partidas Pendientes de Aprobación
            </CardTitle>
            <CardDescription>
                Las siguientes partidas han sido marcadas como 100% completadas y requieren tu revisión final.
            </CardDescription>
        </CardHeader>
        <CardContent>
            <ScrollArea className="h-[calc(80vh-16rem)] border rounded-lg">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 className="h-8 w-8 animate-spin"/>
                    </div>
                ) : itemsForReview.length > 0 ? (
                    <div className="p-4 space-y-3">
                        {itemsForReview.map(item => (
                            <div key={item.id} className="grid grid-cols-12 items-center gap-4 p-4 border rounded-md hover:bg-muted/50 transition-colors">
                                <div className="col-span-8 space-y-1">
                                    <p className="font-semibold text-foreground">{item.path} — {item.name}</p>
                                    <p className="text-sm text-muted-foreground">{item.quantity.toLocaleString()} {item.unit}</p>
                                    <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                            <Clock className="h-3 w-3"/>
                                            {item.actualEndDate ? formatDistanceToNow(item.actualEndDate, { addSuffix: true, locale: es }) : 'recientemente'}
                                        </p>
                                        {item.assignedTo && userMap.get(item.assignedTo) && (
                                            <p className="text-xs text-muted-foreground">
                                                Enviado por <span className="font-semibold text-foreground">{userMap.get(item.assignedTo)}</span>
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className="col-span-4 flex justify-end gap-2">
                                    {processingId === item.id ? (
                                        <Loader2 className="h-5 w-5 animate-spin"/>
                                    ) : (
                                        <>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button size="sm" variant="destructive" className="w-full sm:w-auto">
                                                    <ThumbsDown className="mr-2 h-4 w-4"/> Rechazar
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Rechazar Partida</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        La partida quedará marcada como rechazada. El supervisor podrá corregirla y volver a enviarla a revisión.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <div className="py-2 space-y-2">
                                                    <label className="text-sm font-medium flex items-center gap-2">
                                                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                                                        Motivo del rechazo
                                                    </label>
                                                    <Textarea
                                                        placeholder="Describe los defectos encontrados o correcciones requeridas..."
                                                        value={rejectionReason}
                                                        onChange={e => setRejectionReason(e.target.value)}
                                                        rows={3}
                                                        className="resize-none"
                                                    />
                                                </div>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel onClick={() => setRejectionReason('')}>Cancelar</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleAction(item.id, 'reject')} className="bg-destructive hover:bg-destructive/90">
                                                        Confirmar Rechazo
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                        
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                 <Button size="sm" className="w-full sm:w-auto bg-green-600 hover:bg-green-700">
                                                    <ThumbsUp className="mr-2 h-4 w-4"/> Aprobar
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>¿Aprobar Partida?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Esta acción marcará la partida como 'Completada' y la bloqueará. No se podrá registrar más avance en ella.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleAction(item.id, 'approve')} className="bg-green-600 hover:bg-green-700">
                                                        Sí, Aprobar y Cerrar
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center text-center h-80 text-muted-foreground">
                        <Inbox className="h-16 w-16 mb-4 text-green-500/50"/>
                        <h3 className="text-xl font-semibold">¡Bandeja Limpia!</h3>
                        <p className="mt-1">No hay partidas pendientes de revisión.</p>
                    </div>
                )}
            </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
