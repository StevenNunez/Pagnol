'use client';

import React from 'react';
import { useForm, Controller, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { WORK_PROJECT_STATUS_LABELS, type WorkProject } from '@/modules/core/lib/data';
import { useActiveProject } from './active-project';

const FormSchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  location: z.string().optional().nullable(),
  status: z.enum(['planning', 'active', 'suspended', 'closed']),
  contractId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

type FormData = z.infer<typeof FormSchema>;

const toInputDate = (d: Date | null | undefined) => {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

interface WorkProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Obra a editar. Sin ella, el diálogo crea una nueva. */
  project?: WorkProject | null;
}

export function WorkProjectDialog({ open, onOpenChange, project }: WorkProjectDialogProps) {
  const { addWorkProject, updateWorkProject, contracts, users } = useAppState();
  const { setProjectId } = useActiveProject();
  const { toast } = useToast();
  const isEdit = !!project;

  const {
    register, handleSubmit, control, formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    // `values` y no `defaultValues`: el diálogo se monta una vez y cambia la obra
    // que edita, así que el formulario tiene que seguir a la prop.
    values: {
      name: project?.name ?? '',
      location: project?.location ?? '',
      status: project?.status ?? 'active',
      contractId: project?.contractId ?? null,
      managerId: project?.managerId ?? null,
      startDate: toInputDate(project?.startDate),
      endDate: toInputDate(project?.endDate),
      description: project?.description ?? '',
    },
  });

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
      const payload = {
        name: data.name,
        location: data.location || null,
        status: data.status,
        contractId: data.contractId || null,
        managerId: data.managerId || null,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        description: data.description || null,
      };

      if (isEdit && project) {
        await updateWorkProject(project.id, payload);
        toast({ title: 'Obra actualizada', description: data.name });
      } else {
        const created = await addWorkProject(payload);
        // Quien crea una obra quiere trabajar en ella: queda activa.
        setProjectId(created.id);
        toast({
          title: 'Obra creada',
          description: `${created.code ? created.code + ' · ' : ''}${created.name}. Ya puedes cargarle partidas.`,
        });
      }
      onOpenChange(false);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: isEdit ? 'Error al actualizar' : 'Error al crear',
        description: error?.message || 'No se pudo guardar la obra.',
      });
    }
  };

  const activeContracts = React.useMemo(
    () => (contracts || []).filter(c => c.status === 'active'),
    [contracts],
  );
  const assignableUsers = React.useMemo(
    () => [...(users || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar obra' : 'Nueva obra'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Los cambios de nombre se reflejan también en la estructura de partidas.'
              : 'La obra nace con su estructura de partidas vacía, lista para cargarle la programación.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wp-name">Nombre de la obra</Label>
            <Input id="wp-name" placeholder="Ej: Planta Concentradora — Fase 2" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="wp-location">Ubicación</Label>
              <Input id="wp-location" placeholder="Ej: Faena Los Bronces" {...register('location')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wp-status">Estado</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger id="wp-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(WORK_PROJECT_STATUS_LABELS).map(([v, label]) => (
                        <SelectItem key={v} value={v}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="wp-start">Inicio</Label>
              <Input id="wp-start" type="date" {...register('startDate')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wp-end">Término</Label>
              <Input id="wp-end" type="date" {...register('endDate')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wp-contract">Contrato comercial</Label>
            <Controller
              name="contractId"
              control={control}
              render={({ field }) => (
                <Select
                  onValueChange={(v) => field.onChange(v === '__none__' ? null : v)}
                  value={field.value || '__none__'}
                >
                  <SelectTrigger id="wp-contract"><SelectValue placeholder="Sin imputar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin imputar</SelectItem>
                    {activeContracts.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}{c.clientName ? ` — ${c.clientName}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-xs text-muted-foreground">
              Por acá entra el costo real de la obra y salen los ingresos de sus estados de pago.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wp-manager">Responsable de obra</Label>
            <Controller
              name="managerId"
              control={control}
              render={({ field }) => (
                <Select
                  onValueChange={(v) => field.onChange(v === '__none__' ? null : v)}
                  value={field.value || '__none__'}
                >
                  <SelectTrigger id="wp-manager"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin asignar</SelectItem>
                    {assignableUsers.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-xs text-muted-foreground">
              Verá la obra en su módulo Estado de Pago.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wp-desc">Descripción</Label>
            <Textarea id="wp-desc" rows={3} placeholder="Alcance, mandante, observaciones…" {...register('description')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? 'Guardar cambios' : 'Crear obra'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
