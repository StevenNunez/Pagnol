'use client';
import React, { useState, useEffect } from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Check, X } from 'lucide-react';
import { Supplier, MaterialCategory } from '@/modules/core/lib/data';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Badge } from '../ui/badge';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';

const FormSchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  categories: z.array(z.string()).min(1, 'Debes seleccionar al menos una categoría.'),
  rut: z.string().optional(),
  bank: z.string().optional(),
  accountType: z.string().optional(),
  accountNumber: z.string().optional(),
  email: z.string().email('Correo no válido').optional().or(z.literal('')),
});

type FormData = z.infer<typeof FormSchema>;

interface EditSupplierFormProps {
    supplier: Supplier;
    isOpen: boolean;
    onClose: () => void;
}

export function EditSupplierForm({ supplier, isOpen, onClose }: EditSupplierFormProps) {
  const { updateSupplier, materialCategories } = useAppState();
  const { toast } = useToast();
  const [selectedCategories, setSelectedCategories] = useState<string[]>(supplier.categories);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
  });

  useEffect(() => {
    if(supplier) {
        const defaultValues = {
            name: supplier.name,
            categories: supplier.categories,
            rut: supplier.rut || '',
            bank: supplier.bank || '',
            accountType: supplier.accountType || '',
            accountNumber: supplier.accountNumber || '',
            email: supplier.email || '',
        };
        reset(defaultValues);
        setSelectedCategories(supplier.categories);
    }
  }, [supplier, reset]);

  const handleCategoryToggle = (category: string) => {
    const newCategories = selectedCategories.includes(category)
      ? selectedCategories.filter(c => c !== category)
      : [...selectedCategories, category];
    setSelectedCategories(newCategories);
    setValue('categories', newCategories, { shouldValidate: true });
  };

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
      await updateSupplier(supplier.id, data);
      toast({
        title: 'Proveedor Actualizado',
        description: `Los datos de ${data.name} han sido guardados.`,
      });
      onClose();
    } catch (error) {
       toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo actualizar el proveedor.',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-xl">
            <DialogHeader>
                <DialogTitle>Editar Proveedor</DialogTitle>
                <DialogDescription>
                    Modifica los datos del proveedor.
                </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto px-6">
                <div className="space-y-2">
                    <Label htmlFor="supplier-name">Nombre del Proveedor</Label>
                    <Input id="supplier-name" {...register('name')} />
                    {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="rut">RUT (Opcional)</Label>
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
                    <Label>Categorías que Maneja</Label>
                     <div className="space-y-2">
                        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="w-full justify-start font-normal h-auto min-h-10">
                                   <div className="flex flex-wrap gap-1">
                                        {selectedCategories.length > 0 ? (
                                            selectedCategories.map(cat => (
                                                <Badge key={cat} variant="secondary" className="pl-2 pr-1 py-1 text-sm rounded-md">
                                                    {cat}
                                                    <div 
                                                        role="button" tabIndex={0}
                                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCategoryToggle(cat); }}
                                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); handleCategoryToggle(cat); }}}
                                                        className="ml-1 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:bg-black/10 dark:hover:bg-white/20 p-0.5"
                                                    >
                                                        <X className="h-3 w-3" />
                                                        <span className="sr-only">Quitar {cat}</span>
                                                    </div>
                                                </Badge>
                                            ))
                                        ) : ("Seleccionar categorías...")}
                                    </div>
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                <Command>
                                    <CommandInput placeholder="Buscar categoría..." />
                                    <CommandList>
                                        <CommandEmpty>No se encontró la categoría.</CommandEmpty>
                                        <CommandGroup>
                                            {(materialCategories || []).map((cat: MaterialCategory) => (
                                                <CommandItem key={cat.id} value={cat.name} onSelect={() => handleCategoryToggle(cat.name)} className="flex items-center justify-between">
                                                    <span>{cat.name}</span>
                                                    {selectedCategories.includes(cat.name) && <Check className="h-4 w-4 text-primary"/>}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                         <p className="text-xs text-muted-foreground">Haz clic en una categoría para agregarla o quitarla.</p>
                         {errors.categories && <p className="text-xs text-destructive">{errors.categories.message}</p>}
                    </div>
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
