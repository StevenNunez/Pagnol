'use client';
import React, { useState } from 'react';
import { useForm, SubmitHandler, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, FolderPlus } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const FormSchema = z.object({
  lotName: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
});

type FormData = z.infer<typeof FormSchema>;

export function CreateLotForm() {
  const { createLot } = useAppState();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      lotName: "",
    }
  });

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
      await createLot(data.lotName);
      toast({
        title: 'Lote Listo para Asignación',
        description: `El lote "${data.lotName}" ha sido creado. Ahora puedes asignar solicitudes a este lote.`,
      });
      reset();
    } catch (error: any) {
       toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo procesar la creación del lote.',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
       <div className="space-y-2">
        <Label htmlFor="lotName">Nombre del Lote</Label>
        <Input 
            id="lotName" 
            placeholder="Ej: Cemento semanal, Eléctricos Torre A" 
            {...register('lotName')} 
        />
        {errors.lotName && <p className="text-xs text-destructive">{errors.lotName.message}</p>}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FolderPlus className="mr-2 h-4 w-4" />
        )}
        Crear Lote Personalizado
      </Button>
    </form>
  );
}
