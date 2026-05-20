
'use client';

import React, { useMemo } from 'react';
import { useForm, Controller, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, PlusCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { WorkItem } from '@/modules/core/lib/data';

const FormSchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  unit: z.string().min(1, 'La unidad es requerida.'),
  quantity: z.coerce.number().min(0, 'La cantidad no puede ser negativa.'),
  unitPrice: z.coerce.number().min(0, 'El precio no puede ser negativo.'),
  type: z.enum(['project', 'task'], { required_error: 'Debes seleccionar un tipo.' }),
  parentId: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
});

type FormData = z.infer<typeof FormSchema>;

const UNITS = ['m', 'm2', 'm3', 'kg', 'ton', 'und', 'global'];

interface CreateWorkItemFormProps {
  workItems: WorkItem[];
}

export function CreateWorkItemForm({ workItems }: CreateWorkItemFormProps) {
  const { addWorkItem, users } = useAppState();
  const { user } = useAuth();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: '',
      quantity: 0,
      unitPrice: 0,
      unit: 'und',
      type: 'task',
      parentId: null,
      assignedTo: null,
    },
  });

  const selectedType = watch('type');

  // Todos los contratos raíz del tenant (para asignar partidas)
  const rootContracts = useMemo(() =>
    (workItems || []).filter(item => item.parentId === null),
    [workItems]
  );

  // Usuarios del tenant (para asignar el contrato)
  const assignableUsers = useMemo(() =>
    (users || []).filter(u => u.id !== undefined).sort((a, b) => a.name.localeCompare(b.name)),
    [users]
  );

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    if (!user) {
      toast({ variant: 'destructive', title: 'Error', description: 'Debes iniciar sesión.' });
      return;
    }
    if (data.type === 'task' && !data.parentId) {
      toast({ variant: 'destructive', title: 'Error', description: 'Debes seleccionar un Contrato para la partida.' });
      return;
    }

    try {
      const fullData = {
        ...data,
        assignedTo: data.assignedTo || user.id,
        status: 'in-progress' as const,
        projectId: user.tenantId,
        parentId: data.type === 'project' ? null : (data.parentId ?? null),
      };

      await addWorkItem(fullData);

      toast({
        title: `${data.type === 'project' ? 'Contrato' : 'Partida'} Creado`,
        description: `Se ha añadido "${data.name}" correctamente.`,
      });
      reset();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al crear',
        description: error.message || 'No se pudo añadir el ítem.',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="type">Tipo de Ítem</Label>
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <Select onValueChange={field.onChange} value={field.value}>
              <SelectTrigger id="type"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="project">Nuevo Contrato / Obra</SelectItem>
                <SelectItem value="task">Nueva Partida / Actividad</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {/* Al crear un CONTRATO: seleccionar el contratista responsable */}
      {selectedType === 'project' && (
        <div className="space-y-2">
          <Label htmlFor="assignedTo">Asignar Contratista Responsable</Label>
          <Controller
            name="assignedTo"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <SelectTrigger id="assignedTo">
                  <SelectValue placeholder={`Por defecto: ${user?.name || 'yo'}`} />
                </SelectTrigger>
                <SelectContent>
                  {assignableUsers.map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                      {u.role === 'contratista' && (
                        <span className="ml-2 text-xs text-muted-foreground">(Contratista)</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <p className="text-xs text-muted-foreground">
            Este usuario verá el contrato en su módulo &quot;Estado de Pago&quot;.
          </p>
        </div>
      )}

      {/* Al crear una PARTIDA: seleccionar el contrato padre */}
      {selectedType === 'task' && (
        <div className="space-y-2">
          <Label htmlFor="parentId">Asignar a Contrato</Label>
          <Controller
            name="parentId"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <SelectTrigger id="parentId"><SelectValue placeholder="Seleccionar Contrato..." /></SelectTrigger>
                <SelectContent>
                  {rootContracts.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.parentId && <p className="text-xs text-destructive">{errors.parentId.message}</p>}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="name">Nombre del {selectedType === 'project' ? 'Contrato' : 'Partida'}</Label>
        <Input
          id="name"
          placeholder={selectedType === 'project' ? 'Ej: Remodelación Oficinas Centrales' : 'Ej: Instalación de cerámicas'}
          {...register('name')}
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="quantity">Cantidad</Label>
          <Input id="quantity" type="number" step="any" {...register('quantity')} />
          {errors.quantity && <p className="text-xs text-destructive">{errors.quantity.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="unit">Unidad</Label>
          <Controller
            name="unit"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger id="unit"><SelectValue placeholder="..." /></SelectTrigger>
                <SelectContent>
                  {UNITS.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          />
          {errors.unit && <p className="text-xs text-destructive">{errors.unit.message}</p>}
        </div>

        <div className="space-y-2 col-span-2">
          <Label htmlFor="unitPrice">Precio Unitario</Label>
          <Input id="unitPrice" type="number" step="any" {...register('unitPrice')} />
          {errors.unitPrice && <p className="text-xs text-destructive">{errors.unitPrice.message}</p>}
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
        Añadir {selectedType === 'project' ? 'Contrato' : 'Partida'}
      </Button>
    </form>
  );
}
