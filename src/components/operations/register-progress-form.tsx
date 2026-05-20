
'use client';

import React from 'react';
import { useForm, Controller, SubmitHandler } from 'react-hook-form';
import dynamic from 'next/dynamic';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Calendar as CalendarIcon, Send } from 'lucide-react';
import { WorkItem } from '@/modules/core/lib/data';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Textarea } from '../ui/textarea';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle } from 'lucide-react';


const Calendar = dynamic(() => import('@/components/ui/calendar').then(mod => mod.Calendar), { ssr: false });


const FormSchema = z.object({
  date: z.date({ required_error: 'La fecha es requerida.' }),
  quantity: z.coerce.number().min(0.01, 'La cantidad debe ser mayor a cero.'),
  observations: z.string().optional(),
});

type FormData = z.infer<typeof FormSchema>;

interface RegisterProgressFormProps {
  workItem: WorkItem;
  onSuccess?: () => void;
}

export function RegisterProgressForm({ workItem, onSuccess }: RegisterProgressFormProps) {
  const { toast } = useToast();
  const { addWorkItemProgress, can, submitForQualityReview } = useAppState();
  const [isSubmittingProtocol, setIsSubmittingProtocol] = React.useState(false);


  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      date: new Date(),
      quantity: 0,
      observations: '',
    },
  });

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
        await addWorkItemProgress(workItem.id, data.quantity, data.date, data.observations);
        toast({
            title: 'Avance Registrado',
            description: `Se guardó el avance para "${workItem.name}".`,
        });
        reset({ date: new Date(), quantity: 0, observations: '' });
        if (onSuccess) onSuccess();
    } catch(error: any) {
        toast({
          variant: 'destructive',
          title: 'Error al Registrar',
          description: error.message || 'No se pudo guardar el avance.'
        });
    }
  };
  
  const canRegister = can('construction_control:register_progress');
  const isCompleted = workItem.progress >= 100;
  const isInReview = workItem.status === 'pending-quality-review';

    const handleSendToProtocol = async () => {
        setIsSubmittingProtocol(true);
        try {
            await submitForQualityReview(workItem.id); 
            toast({
                title: 'Enviado a Protocolo',
                description: `La partida "${workItem.name}" ha sido enviada para revisión de calidad.`
            });
        } catch(error: any) {
            toast({
                variant: 'destructive',
                title: 'Error al Enviar',
                description: error.message || 'No se pudo enviar la partida a revisión.'
            });
        } finally {
            setIsSubmittingProtocol(false);
        }
    };


  return (
    <Card className="border-primary/20 mt-4">
        <CardHeader>
            <CardTitle>Registrar Avance Diario</CardTitle>
            <CardDescription>
                Informa el avance realizado para la partida seleccionada.
            </CardDescription>
        </CardHeader>
        <CardContent>
            {isCompleted || isInReview ? (
                 <Alert variant={isInReview ? 'default' : 'destructive'} className={isInReview ? 'bg-blue-50 border-blue-200 text-blue-800 [&>svg]:text-blue-600' : 'bg-green-50 border-green-200 text-green-800 [&>svg]:text-green-600'}>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>{isInReview ? 'Pendiente de Revisión' : 'Partida Completada'}</AlertTitle>
                    <AlertDescription>
                        {isInReview ? 'Esta partida ya fue enviada a Calidad y está esperando aprobación.' : 'Esta partida ya ha alcanzado el 100% de su avance.'}
                    </AlertDescription>
                </Alert>
            ) : (
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="date">Fecha del Avance</Label>
                            <Controller
                                name="date"
                                control={control}
                                render={({ field }) => (
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")} disabled={!canRegister}>
                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                {field.value ? format(field.value, 'PPP', { locale: es }) : "Seleccionar fecha"}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={!canRegister}/></PopoverContent>
                                    </Popover>
                                )}
                            />
                            {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="quantity">Cantidad Avanzada ({workItem.unit})</Label>
                            <Input id="quantity" type="number" step="any" {...register('quantity')} disabled={!canRegister} />
                            {errors.quantity && <p className="text-xs text-destructive">{errors.quantity.message}</p>}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="observations">Observaciones (Opcional)</Label>
                        <Textarea id="observations" placeholder="Ej: Avance correspondiente al sector norte de la losa..." {...register('observations')} disabled={!canRegister}/>
                    </div>
                    
                    <Button type="submit" className="w-full" disabled={isSubmitting || !canRegister}>
                        {isSubmitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                        <Save className="mr-2 h-4 w-4" />
                        )}
                        Guardar Avance
                    </Button>
                    {!canRegister && <p className="text-xs text-center text-muted-foreground mt-2">No tienes permiso para registrar avances.</p>}
                </form>
            )}
             {isCompleted && !isInReview && can('construction_control:register_progress') && (
                <div className="mt-6 border-t pt-6">
                    <h4 className="font-semibold text-center mb-2">¡Partida al 100%!</h4>
                    <p className="text-sm text-muted-foreground text-center mb-4">Esta partida ha alcanzado su meta. ¿Deseas enviarla a revisión de calidad?</p>
                    <Button 
                        className="w-full bg-blue-600 hover:bg-blue-700" 
                        onClick={handleSendToProtocol} 
                        disabled={isSubmittingProtocol}
                    >
                        {isSubmittingProtocol ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Send className="mr-2 h-4 w-4" />
                        )}
                        Finalizar y Enviar a Protocolo
                    </Button>
                </div>
            )}
        </CardContent>
    </Card>
  );
}
