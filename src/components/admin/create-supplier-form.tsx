'use client';
import React, { useState } from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Briefcase, PlusCircle, X, Check } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { MaterialCategory } from '@/modules/core/lib/data';

const FormSchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  categories: z.array(z.string()).min(1,'Debes seleccionar al menos una categoría.'),
  rut: z.string().optional(),
  bank: z.string().optional(),
  accountType: z.string().optional(),
  accountNumber: z.string().optional(),
  email: z.string().email('Correo no válido').optional().or(z.literal('')),
});

type FormData = z.infer<typeof FormSchema>;

export function CreateSupplierForm() {
  const { addSupplier, materialCategories } = useAppState();
  const { toast } = useToast();
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      categories: [],
    }
  });

  const handleCategoryToggle = (category: string) => {
    const newCategories = selectedCategories.includes(category)
      ? selectedCategories.filter(c => c !== category)
      : [...selectedCategories, category];
    setSelectedCategories(newCategories);
    setValue('categories', newCategories, { shouldValidate: true });
  };
  
  const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
      await addSupplier(data);
      toast({
        title: 'Proveedor Creado',
        description: `${data.name} ha sido añadido al sistema.`,
      });
      reset();
      setSelectedCategories([]);
    } catch (error: any) {
       toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo crear el proveedor.',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Nombre del Proveedor</Label>
        <Input id="name" placeholder="Ej: Ferretería El Clavo" {...register('name')} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>
      
       <div className="space-y-2">
        <Label htmlFor="rut">RUT del Proveedor (Opcional, para facturación)</Label>
        <Input id="rut" placeholder="Ej: 76.123.456-7" {...register('rut')} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Correo de Cobranza (Opcional)</Label>
        <Input id="email" type="email" placeholder="Ej: cobranza@proveedor.cl" {...register('email')} />
         {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
      </div>
       <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="bank">Banco (Opcional)</Label>
            <Input id="bank" {...register('bank')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="accountType">Tipo de Cuenta (Opcional)</Label>
            <Input id="accountType" placeholder="Corriente, Vista..." {...register('accountType')} />
          </div>
       </div>
       <div className="space-y-2">
            <Label htmlFor="accountNumber">Nº de Cuenta (Opcional)</Label>
            <Input id="accountNumber" {...register('accountNumber')} />
        </div>
      
      <div className="space-y-2">
        <Label htmlFor="categories">Categorías que Maneja</Label>
         <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start font-normal h-auto min-h-10">
                    {selectedCategories.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                            {selectedCategories.map(cat => <Badge key={cat} variant="secondary">{cat}</Badge>)}
                        </div>
                    ) : (
                        "Seleccionar categorías..."
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                    <CommandInput placeholder="Buscar categoría..." />
                    <CommandList>
                        <CommandEmpty>No se encontró la categoría.</CommandEmpty>
                        <CommandGroup>
                            {(materialCategories || []).map((cat: MaterialCategory) => (
                                <CommandItem
                                    key={cat.id}
                                    value={cat.name}
                                    onSelect={() => handleCategoryToggle(cat.name)}
                                    className="flex items-center justify-between"
                                >
                                    <span>{cat.name}</span>
                                    {selectedCategories.includes(cat.name) && <Check className="h-4 w-4 text-primary"/>}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
         </Popover>
         {errors.categories && <p className="text-xs text-destructive">{errors.categories.message}</p>}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Briefcase className="mr-2 h-4 w-4" />
        )}
        Crear Proveedor
      </Button>
    </form>
  );
}
