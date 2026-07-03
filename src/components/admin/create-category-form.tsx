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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, FolderPlus, FolderTree, CornerDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MaterialCategory } from '@/modules/core/lib/data';

const FormSchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  parentId: z.string().optional(),
});

type FormData = z.infer<typeof FormSchema>;
type Kind = 'familia' | 'subcategoria';

export function CreateCategoryForm() {
  const { addMaterialCategory, materialCategories } = useAppState();
  const { toast } = useToast();
  const [kind, setKind] = useState<Kind>('familia');

  // Solo 2 niveles: únicamente las familias (sin padre) pueden ser padre.
  const families = React.useMemo(
    () => (materialCategories || [])
      .filter((c: MaterialCategory) => !c.parentId)
      .sort((a: MaterialCategory, b: MaterialCategory) => a.name.localeCompare(b.name)),
    [materialCategories]
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: { parentId: '' },
  });

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    const parentId = kind === 'subcategoria' ? (data.parentId || null) : null;
    if (kind === 'subcategoria' && !parentId) {
      toast({ variant: 'destructive', title: 'Falta la familia', description: 'Elige a qué familia pertenece la subcategoría.' });
      return;
    }
    try {
      await addMaterialCategory(data.name, parentId);
      toast({
        title: kind === 'familia' ? 'Familia Creada' : 'Subcategoría Creada',
        description: `"${data.name}" ha sido añadida.`,
      });
      reset({ name: '', parentId: '' });
    } catch (error) {
       toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo crear la categoría.',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label>¿Qué quieres crear?</Label>
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-xl">
          <button
            type="button"
            onClick={() => setKind('familia')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold transition-colors',
              kind === 'familia' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <FolderTree className="h-3.5 w-3.5" /> Familia
          </button>
          <button
            type="button"
            onClick={() => setKind('subcategoria')}
            disabled={families.length === 0}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold transition-colors disabled:opacity-50',
              kind === 'subcategoria' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <CornerDownRight className="h-3.5 w-3.5" /> Subcategoría
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {kind === 'familia'
            ? 'Nivel superior para agrupar (ej: "Herramientas", "EPP", "Vehículos").'
            : 'Cuelga de una familia (ej: Herramientas → "Herramientas Eléctricas").'}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">{kind === 'familia' ? 'Nombre de la Familia' : 'Nombre de la Subcategoría'}</Label>
        <Input
          id="name"
          placeholder={kind === 'familia' ? 'Ej: Herramientas' : 'Ej: Herramientas Eléctricas'}
          {...register('name')}
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      {kind === 'subcategoria' && (
        <div className="space-y-2">
          <Label htmlFor="parentId">Familia a la que pertenece</Label>
          <Controller name="parentId" control={control} render={({ field }) => (
            <Select onValueChange={field.onChange} value={field.value || ''}>
              <SelectTrigger id="parentId"><SelectValue placeholder="Elige la familia..." /></SelectTrigger>
              <SelectContent>
                {families.map((f: MaterialCategory) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )} />
        </div>
      )}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FolderPlus className="mr-2 h-4 w-4" />
        )}
        {kind === 'familia' ? 'Crear Familia' : 'Crear Subcategoría'}
      </Button>
    </form>
  );
}
