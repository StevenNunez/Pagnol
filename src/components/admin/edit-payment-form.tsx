
'use client';
import React, { useEffect } from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save } from 'lucide-react';
import { SupplierPayment } from '@/modules/core/lib/data';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';

const FormSchema = z.object({
  work: z.string().optional(),
  purchaseOrderNumber: z.string().optional(),
});

type FormData = z.infer<typeof FormSchema>;

interface EditPaymentFormProps {
    payment: SupplierPayment;
    isOpen: boolean;
    onClose: () => void;
}

export function EditPaymentForm({ payment, isOpen, onClose }: EditPaymentFormProps) {
  const { updateSupplierPayment } = useAppState();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
  });

  useEffect(() => {
      if(payment) {
          reset({
            work: payment.work || '',
            purchaseOrderNumber: payment.purchaseOrderNumber || '',
          });
      }
  }, [payment, reset]);

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
      await updateSupplierPayment(payment.id, data);
      toast({
        title: 'Factura Actualizada',
        description: `La información de la factura ha sido guardada.`,
      });
      onClose();
    } catch (error) {
       toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo actualizar la factura.',
      });
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Editar Factura</DialogTitle>
                <DialogDescription>
                    Añade o modifica la obra y la orden de compra asociadas a esta factura.
                </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="work">Obra</Label>
                    <Input id="work" placeholder="Ej: File 721" {...register('work')} />
                    {errors.work && <p className="text-xs text-destructive">{errors.work.message}</p>}
                </div>
                
                <div className="space-y-2">
                    <Label htmlFor="purchaseOrderNumber">Orden de Compra (OC)</Label>
                    <Input id="purchaseOrderNumber" placeholder="Ej: OC-00123" {...register('purchaseOrderNumber')} />
                    {errors.purchaseOrderNumber && <p className="text-xs text-destructive">{errors.purchaseOrderNumber.message}</p>}
                </div>
                
                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                        <Save className="mr-2 h-4 w-4" />
                        )}
                        Guardar Cambios
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
  );
}
