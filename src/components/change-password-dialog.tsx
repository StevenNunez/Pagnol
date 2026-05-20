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
  currentPassword: z.string().min(1, 'Debes ingresar tu contraseña actual.'),
  newPassword: z.string().min(6, 'La nueva contraseña debe tener al menos 6 caracteres.'),
  confirmPassword: z.string()
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Las contraseñas no coinciden.",
  path: ["confirmPassword"],
});

type FormData = z.infer<typeof FormSchema>;

interface ChangePasswordDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ChangePasswordDialog({ isOpen, onClose }: ChangePasswordDialogProps) {
  const { reauthenticateAndChangePassword } = useAuth();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
  });

    const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
        const { isPasswordLeaked } = await import('@/lib/password-security');
        if (await isPasswordLeaked(data.newPassword)) {
            toast({
                variant: 'destructive',
                title: 'Contraseña Comprometida',
                description: 'Esta contraseña fue expuesta en filtraciones conocidas. Elige una diferente.',
            });
            return;
        }

        console.log('[ChangePassword] Initiating re-authentication...');
        await reauthenticateAndChangePassword(data.currentPassword, data.newPassword);
        console.log('[ChangePassword] Success');
        
        toast({
            title: 'Contraseña Actualizada',
            description: 'Tu contraseña ha sido cambiada exitosamente.',
        });
        
        // Dar un pequeño respiro para que el toast se procese antes de cerrar
        setTimeout(() => {
            handleClose();
        }, 100);
    } catch (error: any) {
        console.error('[ChangePassword] Error during password change:', error);
        let errorMessage = error.message || 'No se pudo cambiar la contraseña.';
        
        // Handle common Supabase Auth error codes
        if (error.status === 400 || error.code === 'invalid_credentials' || error.message?.includes('invalid')) {
            errorMessage = 'La contraseña actual es incorrecta.';
        } else if (error.message?.includes('weak')) {
            errorMessage = 'La nueva contraseña es muy débil.';
        }
        
        toast({
            variant: 'destructive',
            title: 'Error de Seguridad',
            description: errorMessage,
        });
    }
  };

  const handleClose = () => {
      reset();
      onClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
                <DialogTitle>Cambiar mi Contraseña</DialogTitle>
                <DialogDescription>
                    Para cambiar tu contraseña, primero ingresa tu contraseña actual.
                </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="currentPassword">Contraseña Actual</Label>
                    <Input id="currentPassword" type="password" {...register('currentPassword')} />
                    {errors.currentPassword && <p className="text-xs text-destructive">{errors.currentPassword.message}</p>}
                </div>
                
                <div className="space-y-2">
                    <Label htmlFor="newPassword">Nueva Contraseña</Label>
                    <Input id="newPassword" type="password" {...register('newPassword')} />
                    {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword.message}</p>}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirmar Nueva Contraseña</Label>
                    <Input id="confirmPassword" type="password" {...register('confirmPassword')} />
                    {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
                </div>

                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={handleClose}>Cancelar</Button>
                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                        <Save className="mr-2 h-4 w-4" />
                        )}
                        Guardar Contraseña
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
  );
}
