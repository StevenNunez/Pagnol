'use client';
import React from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/modules/auth/useAuth';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';


const FormSchema = z.object({
  newEmail: z.string().email('El correo electrónico no es válido.'),
  currentPassword: z.string().min(1, 'Debes ingresar tu contraseña actual para confirmar.'),
});

type FormData = z.infer<typeof FormSchema>;

interface ChangeEmailDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ChangeEmailDialog({ isOpen, onClose }: ChangeEmailDialogProps) {
  const { reauthenticateAndChangeEmail, user } = useAuth();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      newEmail: user?.email || '',
    }
  });

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
        await reauthenticateAndChangeEmail(data.currentPassword, data.newEmail);
        toast({
            title: 'Correo Actualizado',
            description: 'Tu correo electrónico ha sido cambiado exitosamente.',
        });
        handleClose();
    } catch (error: any) {
       let errorMessage = 'No se pudo cambiar el correo.';
        if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            errorMessage = 'La contraseña actual es incorrecta.';
        } else if (error.code === 'auth/email-already-in-use') {
            errorMessage = 'El nuevo correo electrónico ya está en uso por otra cuenta.';
        }
       toast({
            variant: 'destructive',
            title: 'Error',
            description: errorMessage,
       });
    }
  };

  const handleClose = () => {
      reset({ newEmail: user?.email || '', currentPassword: '' });
      onClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
                <DialogTitle>Cambiar mi Correo Electrónico</DialogTitle>
                <DialogDescription>
                    Para cambiar tu correo, por seguridad, primero debes ingresar tu contraseña actual.
                </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="newEmail">Nuevo Correo Electrónico</Label>
                    <Input id="newEmail" type="email" {...register('newEmail')} />
                    {errors.newEmail && <p className="text-xs text-destructive">{errors.newEmail.message}</p>}
                </div>
                
                <div className="space-y-2">
                    <Label htmlFor="currentPassword">Contraseña Actual</Label>
                    <Input id="currentPassword" type="password" {...register('currentPassword')} />
                    {errors.currentPassword && <p className="text-xs text-destructive">{errors.currentPassword.message}</p>}
                </div>

                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={handleClose}>Cancelar</Button>
                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                        <Save className="mr-2 h-4 w-4" />
                        )}
                        Guardar Correo
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
  );
}
