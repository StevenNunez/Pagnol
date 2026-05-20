
'use client';
import React, { useEffect, useState } from 'react';
import { useForm, SubmitHandler, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save, ThumbsDown, ThumbsUp, ChevronsUpDown, Check, User, Calendar, Edit, MessageSquare } from 'lucide-react';
import { PurchaseRequest, Unit, User as UserType } from '@/modules/core/lib/data';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '../ui/command';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';


const FormSchema = z.object({
  materialName: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  quantity: z.coerce.number().min(1, 'La cantidad debe ser al menos 1.'),
  unit: z.string({ required_error: 'La unidad no puede estar vacía.' }).min(1, 'La unidad no puede estar vacía.'),
  justification: z.string().optional(),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof FormSchema>;

interface EditPurchaseRequestFormProps {
    request: PurchaseRequest;
    isOpen: boolean;
    onClose: () => void;
}

type ActionType = 'save' | 'approve' | 'reject';

export function EditPurchaseRequestForm({ request, isOpen, onClose }: EditPurchaseRequestFormProps) {
  const { updatePurchaseRequestStatus, units, users } = useAppState();
  const { toast } = useToast();
  const [unitPopoverOpen, setUnitPopoverOpen] = useState(false);
  const [action, setAction] = useState<ActionType>('save');

  const requester = React.useMemo(() => (users || []).find((u: UserType) => u.id === request.supervisorId), [users, request.supervisorId]);

  const {
    register,
    handleSubmit,
    control,
    reset,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
  });

  useEffect(() => {
      if(request) {
          reset({
            materialName: request.materialName,
            quantity: request.quantity,
            unit: request.unit,
            justification: request.justification,
            notes: request.notes || '',
          });
      }
  }, [request, reset]);
  
  const handleActionSubmit = async (status: PurchaseRequest['status']) => {
     try {
      await updatePurchaseRequestStatus(request.id, status, getValues());
      
      let toastMessage = 'Cambios guardados.';
      if (status === 'approved') toastMessage = 'Solicitud Aprobada.';
      if (status === 'rejected') toastMessage = 'Solicitud Rechazada.';
      
      toast({
        title: 'Éxito',
        description: toastMessage,
      });
      onClose();
    } catch (error) {
       toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'No se pudo completar la acción.',
      });
    }
  }


  const onSubmit: SubmitHandler<FormData> = async (data) => {
     try {
      await updatePurchaseRequestStatus(request.id, request.status, data);
      toast({
        title: 'Cambios Guardados',
        description: `La solicitud de compra ha sido actualizada.`,
      });
      onClose();
    } catch (error) {
       toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron guardar los cambios.',
      });
    }
  };

  const formatDate = (date: Date | undefined | null) => {
    if (!date) return 'N/A';
    return format(date, "d 'de' MMMM, yyyy", { locale: es });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-4xl" onInteractOutside={(e) => { e.preventDefault(); }}>
            <DialogHeader>
                <DialogTitle>Gestionar Solicitud de Compra</DialogTitle>
                <DialogDescription>
                    Revisa, ajusta y aprueba o rechaza la solicitud de compra. Los cambios se guardarán con la acción que elijas.
                </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-4 max-h-[70vh] overflow-y-auto px-1">
                    
                    {/* Columna de Información */}
                    <div className="space-y-6">
                        <h3 className="font-semibold text-lg text-primary border-b pb-2">Detalles de la Solicitud</h3>
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <User className="h-5 w-5 text-muted-foreground"/>
                                <div>
                                    <p className="text-xs text-muted-foreground">Solicitante</p>
                                    <p className="font-medium">{requester?.name || 'No encontrado'}</p>
                                </div>
                            </div>
                             <div className="flex items-center gap-3">
                                <Calendar className="h-5 w-5 text-muted-foreground"/>
                                <div>
                                    <p className="text-xs text-muted-foreground">Fecha de Solicitud</p>
                                    <p className="font-medium">{formatDate(request.createdAt)}</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <MessageSquare className="h-5 w-5 text-muted-foreground mt-1"/>
                                <div>
                                    <p className="text-xs text-muted-foreground">Justificación Original</p>
                                    <p className="font-medium text-sm bg-muted/50 p-2 rounded-md mt-1">{request.justification}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Columna de Edición */}
                    <div className="space-y-6">
                        <h3 className="font-semibold text-lg text-primary border-b pb-2 flex items-center gap-2"><Edit/> Gestionar Solicitud</h3>
                        <div className="space-y-4">
                             <div className="space-y-2">
                                <Label htmlFor="materialName">Nombre del Material</Label>
                                <Input id="materialName" {...register('materialName')} />
                                {errors.materialName && <p className="text-xs text-destructive">{errors.materialName.message}</p>}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="quantity">Cantidad</Label>
                                    <Input id="quantity" type="number" {...register('quantity')} />
                                    {errors.quantity && <p className="text-xs text-destructive">{errors.quantity.message}</p>}
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="unit">Unidad</Label>
                                    <Controller
                                        name="unit"
                                        control={control}
                                        render={({ field }) => (
                                            <Popover open={unitPopoverOpen} onOpenChange={setUnitPopoverOpen}>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" role="combobox" className="w-full justify-between">
                                                <span className="truncate">{field.value || "Selecciona..."}</span>
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                                <Command>
                                                <CommandInput 
                                                    placeholder="Buscar o crear unidad..."
                                                    onValueChange={(currentValue) => setValue('unit', currentValue, { shouldValidate: true })}
                                                    value={field.value || ''}
                                                />
                                                <CommandList>
                                                    <CommandEmpty>
                                                    <Button className="w-full" variant="outline" onClick={() => setUnitPopoverOpen(false)}>
                                                        Usar "{field.value}" como nueva unidad
                                                    </Button>
                                                    </CommandEmpty>
                                                    <CommandGroup>
                                                    {(units || []).map((unit: Unit) => (
                                                        <CommandItem key={unit.id} value={unit.name} onSelect={() => { setValue("unit", unit.name, { shouldValidate: true }); setUnitPopoverOpen(false); }}>
                                                        <Check className={cn("mr-2 h-4 w-4", field.value === unit.name ? "opacity-100" : "opacity-0")} />
                                                        {unit.name}
                                                        </CommandItem>
                                                    ))}
                                                    </CommandGroup>
                                                </CommandList>
                                                </Command>
                                            </PopoverContent>
                                            </Popover>
                                        )}
                                    />
                                    {errors.unit && <p className="text-xs text-destructive">{errors.unit.message}</p>}
                                </div>
                            </div>
                            
                            <div className="space-y-2">
                                <Label htmlFor="notes">Notas de Aprobación (Opcional)</Label>
                                <Textarea id="notes" placeholder="Ej: Ajustado a cantidad por caja, cambiado a marca XXX." {...register('notes')} />
                                <p className="text-xs text-muted-foreground">Esta nota será visible para el solicitante.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <Separator className="my-4"/>

                <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between w-full pt-4">
                     <Button type="submit" variant="secondary" disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Guardar Cambios sin Aprobar
                    </Button>
                     <div className="flex gap-2">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button type="button" variant="destructive" className="w-full sm:w-auto" disabled={isSubmitting || request.status === 'rejected'}>
                                    <ThumbsDown className="mr-2 h-4 w-4"/> Rechazar
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>¿Confirmar Rechazo?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Esta acción marcará la solicitud de compra como rechazada. ¿Estás seguro?
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleActionSubmit('rejected')} className="bg-destructive hover:bg-destructive/90">
                                    Sí, Rechazar
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button type="button" className="w-full sm:w-auto bg-green-600 hover:bg-green-700" disabled={isSubmitting || request.status === 'approved'}>
                                    <ThumbsUp className="mr-2 h-4 w-4"/> Aprobar
                                </Button>
                            </AlertDialogTrigger>
                             <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>¿Aprobar Solicitud?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                       Se guardarán los cambios que hayas hecho y la solicitud pasará al siguiente estado para ser agrupada en un lote de compra.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleActionSubmit('approved')} className="bg-green-600 hover:bg-green-700">
                                        Sí, Aprobar
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                     </div>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
  );
}
