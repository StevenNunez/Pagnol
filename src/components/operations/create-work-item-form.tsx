
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
import { useActiveProject } from './active-project';

const FormSchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  unit: z.string().min(1, 'La unidad es requerida.'),
  quantity: z.coerce.number().min(0, 'La cantidad no puede ser negativa.'),
  unitPrice: z.coerce.number().min(0, 'El precio no puede ser negativo.'),
  type: z.enum(['phase', 'subphase', 'activity', 'task'], { required_error: 'Debes seleccionar un tipo.' }),
  parentId: z.string().min(1, 'Debes elegir de qué cuelga la partida.'),
  assignedTo: z.string().optional().nullable(),
});

type FormData = z.infer<typeof FormSchema>;

const UNITS = ['m', 'm2', 'm3', 'kg', 'ton', 'und', 'global'];

// Los 5 niveles del dominio. Antes el formulario solo permitía crear 2
// ('project' y 'task'), así que fases y subfases solo podían existir si venían
// de la estructura de ejemplo.
const TYPE_OPTIONS: { value: FormData['type']; label: string }[] = [
  { value: 'phase', label: 'Fase' },
  { value: 'subphase', label: 'Subfase' },
  { value: 'activity', label: 'Actividad' },
  { value: 'task', label: 'Tarea / Partida medible' },
];

interface CreateWorkItemFormProps {
  /** Partidas de la obra activa (ya filtradas por quien renderiza el formulario). */
  workItems: WorkItem[];
}

export function CreateWorkItemForm({ workItems }: CreateWorkItemFormProps) {
  const { addWorkItem, users } = useAppState();
  const { user } = useAuth();
  const { project } = useActiveProject();
  const { toast } = useToast();

  // La raíz de la obra: el padre por defecto de cualquier partida nueva.
  const root = useMemo(() => (workItems || []).find(i => i.parentId === null), [workItems]);

  // Memoizado: react-hook-form re-inicializa el formulario cuando el contenido de
  // `values` cambia, y acá lo único que cambia es la raíz al elegir otra obra —
  // que es justo cuando queremos que el "cuelga de" vuelva a su valor por defecto.
  const blankValues = useMemo<FormData>(() => ({
    name: '',
    quantity: 0,
    unitPrice: 0,
    unit: 'und',
    type: 'task' as const,
    parentId: root?.id ?? '',
    assignedTo: null,
  }), [root?.id]);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: blankValues,
    values: blankValues,
  });

  // Posibles padres: cualquier ítem de la obra activa, ordenado por su código
  // de EDT y sangrado según su profundidad para que el árbol se lea.
  const parentOptions = useMemo(() => {
    return [...(workItems || [])]
      .sort((a, b) => (a.path || '').localeCompare(b.path || ''))
      .map(item => ({
        id: item.id,
        depth: (item.path || '').split('/').length - 1,
        label: `${item.path}  ${item.name}`,
      }));
  }, [workItems]);

  const assignableUsers = useMemo(
    () => (users || []).filter(u => u.id !== undefined).sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    if (!user) {
      toast({ variant: 'destructive', title: 'Error', description: 'Debes iniciar sesión.' });
      return;
    }
    if (!project) {
      toast({ variant: 'destructive', title: 'Sin obra', description: 'Primero crea o elige una obra.' });
      return;
    }

    try {
      await addWorkItem({
        ...data,
        assignedTo: data.assignedTo || user.id,
        status: 'in-progress' as const,
        projectId: user.tenantId,
        // La obra se hereda del padre en la mutación; se manda igual para que
        // el dato no dependa de un solo camino.
        workProjectId: project.id,
        contractId: null,
      });

      toast({ title: 'Partida creada', description: `Se añadió "${data.name}" a ${project.name}.` });
      reset(blankValues);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al crear',
        description: error.message || 'No se pudo añadir la partida.',
      });
    }
  };

  if (!project) {
    return (
      <p className="text-sm text-muted-foreground">
        Crea una obra para empezar a cargar partidas.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="type">Nivel en la estructura</Label>
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <Select onValueChange={field.onChange} value={field.value}>
              <SelectTrigger id="type"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="parentId">Cuelga de</Label>
        <Controller
          name="parentId"
          control={control}
          render={({ field }) => (
            <Select onValueChange={field.onChange} value={field.value || ''}>
              <SelectTrigger id="parentId"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                {parentOptions.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    <span style={{ paddingLeft: `${p.depth * 0.75}rem` }} className="font-mono text-xs">
                      {p.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.parentId && <p className="text-xs text-destructive">{errors.parentId.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Nombre de la partida</Label>
        <Input id="name" placeholder="Ej: Instalación de cerámicas" {...register('name')} />
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

      <div className="space-y-2">
        <Label htmlFor="assignedTo">Responsable (opcional)</Label>
        <Controller
          name="assignedTo"
          control={control}
          render={({ field }) => (
            <Select onValueChange={(v) => field.onChange(v === '__none__' ? null : v)} value={field.value || '__none__'}>
              <SelectTrigger id="assignedTo">
                <SelectValue placeholder={`Por defecto: ${user?.name || 'yo'}`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{user?.name || 'Yo'}</SelectItem>
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
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
        Añadir Partida
      </Button>
    </form>
  );
}
