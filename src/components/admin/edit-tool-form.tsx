'use client';

import React, { useEffect } from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save, QrCode } from 'lucide-react';
import { Tool } from '@/modules/core/lib/data';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

const FormSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres.').max(100),
});

type FormData = z.infer<typeof FormSchema>;

interface EditToolFormProps {
  tool: Tool | null;
  isOpen: boolean;
  onClose: () => void;
}

export function EditToolForm({ tool, isOpen, onClose }: EditToolFormProps) {
  const { updateTool } = useAppState();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
  });

  useEffect(() => {
    if (tool) {
      setValue('name', tool.name);
    }
  }, [tool, setValue]);

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    if (!tool) return;

    try {
      await updateTool(tool.id, data);
      toast({
        title: 'Herramienta actualizada',
        description: `Se ha cambiado el nombre a "${data.name}".`,
      });
      onClose();
      reset();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo actualizar la herramienta.',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Herramienta</DialogTitle>
          <DialogDescription>
            Solo puedes modificar el nombre. El código QR permanece igual.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre de la herramienta</Label>
            <Input
              id="name"
              placeholder="Ej: Taladro percutor 18V"
              {...register('name')}
              autoFocus
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Código QR (no editable)</Label>
            <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
              <QrCode className="h-5 w-5 text-muted-foreground" />
              <code className="text-sm font-mono">{tool?.qrCode}</code>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Guardar cambios
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}