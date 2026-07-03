'use client';
import React, { useEffect, useMemo } from 'react';
import { useForm, SubmitHandler, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save } from 'lucide-react';
import { MaterialCategory } from '@/modules/core/lib/data';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';

const FormSchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  parentId: z.string().optional(),
});

type FormData = z.infer<typeof FormSchema>;

interface EditCategoryFormProps {
    category: MaterialCategory;
    isOpen: boolean;
    onClose: () => void;
}

export function EditCategoryForm({ category, isOpen, onClose }: EditCategoryFormProps) {
  const { updateMaterialCategory, materialCategories } = useAppState();
  const { toast } = useToast();

  // Padres elegibles: familias (sin padre), excluyéndose a sí misma. Una
  // categoría que ya tiene hijas no puede volverse subcategoría (solo 2 niveles).
  const hasChildren = useMemo(
    () => (materialCategories || []).some((c: MaterialCategory) => c.parentId === category.id),
    [materialCategories, category.id]
  );
  const families = useMemo(
    () => (materialCategories || [])
      .filter((c: MaterialCategory) => !c.parentId && c.id !== category.id)
      .sort((a: MaterialCategory, b: MaterialCategory) => a.name.localeCompare(b.name)),
    [materialCategories, category.id]
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
        name: category.name,
        parentId: category.parentId || 'none',
    }
  });

  useEffect(() => {
      if(category) {
          reset({
            name: category.name,
            parentId: category.parentId || 'none',
          });
      }
  }, [category, reset]);

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
      const parentId = data.parentId && data.parentId !== 'none' ? data.parentId : null;
      await updateMaterialCategory(category.id, { name: data.name, parentId });
      toast({
        title: 'Categoría Actualizada',
        description: `Los cambios de la categoría han sido guardados.`,
      });
      onClose();
    } catch (error) {
       toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo actualizar la categoría.',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
                <DialogTitle>Editar Categoría</DialogTitle>
                <DialogDescription>
                    Modifica el nombre o la familia. Los materiales y proveedores existentes se actualizarán automáticamente.
                </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="category-name">Nombre de la Categoría</Label>
                    <Input id="category-name" {...register('name')} />
                    {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="category-parent">Familia</Label>
                    <Controller name="parentId" control={control} render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || 'none'} disabled={hasChildren}>
                        <SelectTrigger id="category-parent"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Ninguna — es una familia</SelectItem>
                          {families.map((f: MaterialCategory) => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )} />
                    {hasChildren && (
                      <p className="text-xs text-muted-foreground">
                        Esta familia tiene subcategorías; muévelas primero si quieres convertirla en subcategoría.
                      </p>
                    )}
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
