"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useForm, SubmitHandler, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty, CommandGroup } from "@/components/ui/command";
import { ChevronsUpDown, Check, Loader2, Save, Calendar as CalendarIcon } from "lucide-react";
import { useToast } from "@/modules/core/hooks/use-toast";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { cn } from "@/lib/utils";
import { Material, Unit, MaterialCategory, Supplier } from "@/modules/core/lib/data";
import { Textarea } from "../ui/textarea";
import { Calendar } from "../ui/calendar";
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { ScrollArea } from "@/components/ui/scroll-area";

const formSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  stock: z.coerce.number().min(0, "El stock no puede ser negativo"),
  unit: z.string().min(1, "Selecciona una unidad"),
  categoryId: z.string().optional(),
  supplierId: z.string().nullable(),
  class: z.enum(['A', 'B', 'C'], { required_error: 'Debes seleccionar la clase.' }),
  usageType: z.enum(['Consumible', 'Reutilizable Controlado', 'Herramienta Menor', 'Repuesto Crítico', 'Activo Fijo', 'IT Controlado'], { required_error: 'Debes seleccionar el tipo de uso.' }),
  description: z.string().optional(),
  unitCost: z.coerce.number().optional(),
  acquisitionDate: z.date().optional().nullable(),
  serialNumber: z.string().optional(),
  photos: z.string().optional(), // Textarea for comma-separated URLs
});

type FormData = z.infer<typeof formSchema>;

interface EditMaterialFormProps {
  isOpen: boolean;
  onClose: () => void;
  material: Material;
}

export function EditMaterialForm({
  isOpen,
  onClose,
  material,
}: EditMaterialFormProps) {
  const { toast } = useToast();
  const { updateMaterial, units, materialCategories, suppliers } = useAppState();
  const { user } = useAuth();
  const [unitPopoverOpen, setUnitPopoverOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canEditStock = user?.role === 'super-admin' || user?.role === 'administrador';

  const {
    register,
    handleSubmit,
    setValue,
    control,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
  });

  useEffect(() => {
    if (material) {
      const category = (materialCategories || []).find((c: MaterialCategory) => c.name === material.category);
      const acquisitionDate = material.acquisitionDate
        ? new Date(material.acquisitionDate as any)
        : null;

      reset({
        name: material.name || "",
        description: material.description || "",
        stock: material.stock || 0,
        unit: material.unit || "",
        categoryId: category?.id,
        supplierId: material.supplierId || null,
        class: material.class || undefined,
        usageType: material.usageType || undefined,
        unitCost: material.unitCost || 0,
        acquisitionDate: acquisitionDate,
        serialNumber: material.serialNumber || "",
        photos: (material.photos || []).join(', '),
      });
    }
  }, [material, materialCategories, reset]);

  const onSubmit: SubmitHandler<FormData> = useCallback(
    async (data) => {
      setIsSubmitting(true);
      try {
        const photosArray = data.photos ? data.photos.split(',').map(p => p.trim()).filter(p => p) : [];
        const updateData: Partial<Omit<Material, "id" | 'category'>> & { categoryId?: string } = {
          name: data.name,
          description: data.description,
          unit: data.unit,
          categoryId: data.categoryId,
          supplierId: data.supplierId === 'ninguno' ? null : data.supplierId,
          class: data.class,
          usageType: data.usageType,
          unitCost: data.unitCost,
          acquisitionDate: data.acquisitionDate || undefined,
          serialNumber: data.serialNumber,
          photos: photosArray,
        };

        if (canEditStock) {
          updateData.stock = data.stock;
        }

        if (updateData.categoryId === undefined) {
          delete updateData.categoryId;
        }

        await updateMaterial(material.id, updateData);
        toast({
          title: "Activo actualizado",
          description: "Los cambios fueron guardados correctamente.",
        });
        onClose();
      } catch (error) {
        console.error(error);
        toast({
          title: "Error",
          description: "No se pudo actualizar el activo.",
          variant: "destructive",
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [material.id, toast, onClose, updateMaterial, canEditStock]
  );

  const handleClose = () => {
    reset();
    onClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-xl"
        onInteractOutside={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Editar Activo</DialogTitle>
          <DialogDescription>
            Modifica los detalles del activo. Solo los roles autorizados pueden cambiar el stock aquí.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2 max-h-[70vh] overflow-y-auto px-6">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre del Activo</Label>
            <Input id="name" {...register("name")} />
            {errors.name && <p className="text-destructive text-sm mt-1">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descripción (Marca, modelo, certificaciones)</Label>
            <Textarea id="description" {...register('description')} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="categoryId">Categoría Principal</Label>
              <Controller
                name="categoryId"
                control={control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value || ''}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent><ScrollArea className="h-48">
                      {(materialCategories || []).map((cat: MaterialCategory) => (
                        <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                      ))}
                    </ScrollArea></SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="class">Clase (Criticidad)</Label>
              <Controller
                name="class"
                control={control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">Clase A (Crítico)</SelectItem>
                      <SelectItem value="B">Clase B (Importante)</SelectItem>
                      <SelectItem value="C">Clase C (Fungible)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.class && <p className="text-destructive text-sm mt-1">{errors.class.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="usageType">Tipo de Uso</Label>
              <Controller
                name="usageType"
                control={control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
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
              {errors.usageType && <p className="text-destructive text-sm mt-1">{errors.usageType.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="serialNumber">N° de Serie (Opcional)</Label>
              <Input id="serialNumber" {...register('serialNumber')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="stock">Stock Actual</Label>
              <Input id="stock" type="number" {...register('stock')} disabled={!canEditStock} />
              {!canEditStock && <p className="text-xs text-muted-foreground">No tienes permiso para editar el stock.</p>}
            </div>
            <div className="space-y-2">
              <Label>Unidad</Label>
              <Controller name="unit" control={control} render={({ field }) => (
                <Popover open={unitPopoverOpen} onOpenChange={setUnitPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between">{field.value || "Seleccionar..."}<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" /></Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                    <Command><CommandInput value={field.value || ''} onValueChange={(val) => setValue('unit', val, { shouldValidate: true })} placeholder="Buscar o crear..." />
                      <CommandList><CommandEmpty><Button className="w-full" variant="outline" onClick={() => setUnitPopoverOpen(false)}>Usar "{field.value}"</Button></CommandEmpty>
                        <CommandGroup>
                          {(units || []).map((unit: Unit) => (
                            <CommandItem key={unit.id} value={unit.name} onSelect={() => { setValue("unit", unit.name); setUnitPopoverOpen(false); }}>
                              <Check className={cn("mr-2 h-4 w-4", field.value === unit.name ? "opacity-100" : "opacity-0")} />{unit.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList></Command>
                  </PopoverContent>
                </Popover>
              )} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="unitCost">Costo Unitario (Opcional)</Label>
              <Input id="unitCost" type="number" {...register('unitCost')} />
            </div>
            <div className="space-y-2">
              <Label>Fecha de Adquisición</Label>
              <Controller name="acquisitionDate" control={control} render={({ field }) => (
                <Popover>
                  <PopoverTrigger asChild><Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4" />{field.value ? format(field.value, "PPP", { locale: es }) : <span>Selecciona fecha</span>}</Button></PopoverTrigger>
                  <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value || undefined} onSelect={field.onChange} initialFocus /></PopoverContent>
                </Popover>
              )} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="photos">Fotografías (URLs separadas por comas)</Label>
            <Textarea id="photos" {...register('photos')} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="supplierId">Proveedor Preferido</Label>
            <Controller name="supplierId" control={control} render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value || 'ninguno'}>
                <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ninguno">Ninguno</SelectItem>
                  {(suppliers || []).map((sup: Supplier) => (<SelectItem key={sup.id} value={sup.id}>{sup.name}</SelectItem>))}
                </SelectContent>
              </Select>
            )} />
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={handleClose}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar Cambios</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
