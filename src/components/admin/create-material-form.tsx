'use client';
import React, { useState } from 'react';
import { useForm, SubmitHandler, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, PackagePlus, ChevronsUpDown, Check, Calendar as CalendarIcon } from 'lucide-react';
import { Supplier, MaterialCategory, Unit } from '@/modules/core/lib/data';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { Calendar } from '../ui/calendar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { ScrollArea } from '@/components/ui/scroll-area';

const FormSchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  description: z.string().optional(),
  stock: z.coerce.number().min(0, 'El stock no puede ser negativo.'),
  unit: z.string({ required_error: 'La unidad no puede estar vacía.' }).min(1, 'La unidad no puede estar vacía.'),
  categoryId: z.string({ required_error: 'Debes seleccionar una categoría.' }),
  supplierId: z.string().nullable(),
  class: z.enum(['A', 'B', 'C'], { required_error: 'Debes seleccionar la clase.' }),
  usageType: z.enum(['Consumible', 'Reutilizable Controlado', 'Herramienta Menor', 'Repuesto Crítico', 'Activo Fijo', 'IT Controlado'], { required_error: 'Debes seleccionar el tipo de uso.' }),
  unitCost: z.coerce.number().optional(),
  acquisitionDate: z.date().optional().nullable(),
  serialNumber: z.string().optional(),
  photos: z.string().optional(), // Textarea for comma-separated URLs
  justification: z.string().optional(),
});

type FormData = z.infer<typeof FormSchema>;

export function CreateMaterialForm() {
  const { addMaterial, suppliers, materialCategories, units, can } = useAppState();
  const { toast } = useToast();
  const [unitPopoverOpen, setUnitPopoverOpen] = useState(false);

  const canSetInitialStock = can('stock:add_manual');

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      stock: 0,
      supplierId: null,
      justification: "",
      unitCost: 0,
      serialNumber: "",
      description: "",
      photos: ""
    }
  });

  const stockWatcher = watch('stock');

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    if (data.stock > 0 && !data.justification && canSetInitialStock) {
      toast({
        variant: 'destructive',
        title: 'Justificación Requerida',
        description: 'Debes añadir una justificación si el stock inicial es mayor a 0.'
      });
      return;
    }
    try {
      const category = (materialCategories || []).find(c => c.id === data.categoryId);

      const photosArray = data.photos ? data.photos.split(',').map(p => p.trim()).filter(p => p) : [];

      await addMaterial({
        ...data,
        photos: photosArray,
        category: category?.name,
        stock: canSetInitialStock ? data.stock : 0,
        supplierId: data.supplierId === 'ninguno' ? null : data.supplierId
      });
      toast({
        title: 'Activo Creado',
        description: `${data.name} ha sido añadido y su ingreso ha sido registrado.`,
      });
      reset();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo crear el activo.',
      });
    }
  };

  const sortedCategories = React.useMemo(() => {
    return [...(materialCategories || [])].sort((a, b) => a.name.localeCompare(b.name));
  }, [materialCategories]);

  const sortedSuppliers = React.useMemo(() => {
    return [...(suppliers || [])].sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="material-name">Nombre del Activo</Label>
        <Input id="material-name" placeholder="Ej: Taladro Percutor Makita HP1630" {...register('name')} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Descripción (Marca, modelo, certificaciones)</Label>
        <Textarea id="description" placeholder="Ej: 710W, 13mm, 2.1kg, doble aislación..." {...register('description')} />
        {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="categoryId">Categoría Principal</Label>
          <Controller
            name="categoryId"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger id="categoryId"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                <SelectContent><ScrollArea className="h-48">
                  {sortedCategories.map((cat: MaterialCategory) => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </ScrollArea></SelectContent>
              </Select>
            )}
          />
          {errors.categoryId && <p className="text-xs text-destructive">{errors.categoryId.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="class">Clase (Criticidad)</Label>
          <Controller
            name="class"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger id="class"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">Clase A (Crítico)</SelectItem>
                  <SelectItem value="B">Clase B (Importante)</SelectItem>
                  <SelectItem value="C">Clase C (Fungible)</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          {errors.class && <p className="text-xs text-destructive">{errors.class.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="usageType">Tipo de Uso</Label>
          <Controller
            name="usageType"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger id="usageType"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Consumible">Consumible</SelectItem>
                  <SelectItem value="Reutilizable Controlado">Reutilizable Controlado</SelectItem>
                  <SelectItem value="Herramienta Menor">Herramienta Menor</SelectItem>
                  <SelectItem value="Repuesto Crítico">Repuesto Crítico</SelectItem>
                  <SelectItem value="Activo Fijo">Activo Fijo</SelectItem>
                  <SelectItem value="IT Controlado">IT Controlado</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          {errors.usageType && <p className="text-xs text-destructive">{errors.usageType.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="serialNumber">N° de Serie (Opcional)</Label>
          <Input id="serialNumber" {...register('serialNumber')} />
          {errors.serialNumber && <p className="text-xs text-destructive">{errors.serialNumber.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="stock">Stock Inicial</Label>
          <Input id="stock" type="number" placeholder="0" {...register('stock')} disabled={!canSetInitialStock} />
          {!canSetInitialStock && <p className="text-xs text-muted-foreground">El stock inicial es 0. Use 'Ingreso Manual' para añadir stock.</p>}
          {errors.stock && <p className="text-xs text-destructive">{errors.stock.message}</p>}
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
                      value={field.value || ''}
                      onValueChange={(currentValue) => setValue('unit', currentValue, { shouldValidate: true })}
                    />
                    <CommandList>
                      <CommandEmpty>
                        <Button className="w-full" variant="outline" onClick={() => setUnitPopoverOpen(false)}>
                          Usar "{field.value}" como nueva unidad
                        </Button>
                      </CommandEmpty>
                      <CommandGroup>
                        {(units || []).map((unit: Unit) => (
                          <CommandItem
                            key={unit.id}
                            value={unit.name}
                            onSelect={() => { setValue("unit", unit.name, { shouldValidate: true }); setUnitPopoverOpen(false); }}
                          >
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

      {stockWatcher > 0 && canSetInitialStock && (
        <div className="space-y-2">
          <Label htmlFor="justification">Justificación del Ingreso Inicial</Label>
          <Textarea id="justification" placeholder="Ej: Inventario inicial, sobrante de obra X..." {...register('justification')} />
          {errors.justification && <p className="text-xs text-destructive">{errors.justification.message}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="unitCost">Costo Unitario (Opcional)</Label>
          <Input id="unitCost" type="number" placeholder="0" {...register('unitCost')} />
          {errors.unitCost && <p className="text-xs text-destructive">{errors.unitCost.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="acquisitionDate">Fecha de Adquisición (Opcional)</Label>
          <Controller
            name="acquisitionDate"
            control={control}
            render={({ field }) => (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {field.value ? format(field.value, "PPP", { locale: es }) : <span>Selecciona fecha</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={field.value || undefined} onSelect={field.onChange} initialFocus />
                </PopoverContent>
              </Popover>
            )}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="photos">Fotografías (URLs separadas por comas)</Label>
        <Textarea id="photos" placeholder="https://ejemplo.com/foto1.jpg, https://ejemplo.com/foto2.jpg" {...register('photos')} />
        {errors.photos && <p className="text-xs text-destructive">{errors.photos.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="supplierId">Proveedor Preferido (Opcional)</Label>
        <Controller
          name="supplierId"
          control={control}
          render={({ field }) => (
            <Select onValueChange={field.onChange} value={field.value || ''}>
              <SelectTrigger id="supplierId"><SelectValue placeholder="Selecciona un proveedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ninguno">Ninguno</SelectItem>
                {sortedSuppliers.map((s: Supplier) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>


      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <PackagePlus className="mr-2 h-4 w-4" />
        )}
        Crear Activo
      </Button>
    </form>
  );
}
