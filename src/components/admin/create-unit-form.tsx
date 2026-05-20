'use client';
import React from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Ruler } from 'lucide-react';

const FormSchema = z.object({
  name: z.string().min(1, 'El nombre no puede estar vacío.'),
});

type FormData = z.infer<typeof FormSchema>;

export function CreateUnitForm() {
  const { addUnit } = useAppState();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
  });

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
      await addUnit(data.name);
      toast({
        title: 'Unidad Creada',
        description: `La unidad "${data.name}" ha sido añadida.`,
      });
      reset();
    } catch (error) {
       toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo crear la unidad.',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="unit-name">Nombre de la Unidad</Label>
        <Input id="unit-name" placeholder="Ej: m2, caja, litro" {...register('name')} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>
      
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Ruler className="mr-2 h-4 w-4" />
        )}
        Crear Unidad
      </Button>
    </form>
  );
}
