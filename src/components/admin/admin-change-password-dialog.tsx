'use client';
import React from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, KeyRound, Eye, EyeOff } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { User } from '@/modules/core/lib/data';

const FormSchema = z.object({
  newPassword: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Las contraseñas no coinciden.',
  path: ['confirmPassword'],
});

type FormData = z.infer<typeof FormSchema>;

interface AdminChangePasswordDialogProps {
  isOpen: boolean;
  onClose: () => void;
  userToEdit: User;
}

export function AdminChangePasswordDialog({ isOpen, onClose, userToEdit }: AdminChangePasswordDialogProps) {
  const { toast } = useToast();
  const [showNew, setShowNew] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(FormSchema) });

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
      const res = await fetch('/api/users/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userToEdit.id, newPassword: data.newPassword }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error desconocido');

      toast({
        title: 'Contraseña actualizada',
        description: `La contraseña de ${userToEdit.name} fue cambiada correctamente.`,
      });
      handleClose();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al cambiar contraseña',
        description: error.message,
      });
    }
  };

  const handleClose = () => { reset(); setShowNew(false); setShowConfirm(false); onClose(); };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md rounded-[2rem] border-none shadow-2xl">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-base font-black uppercase tracking-tight flex items-center gap-2">
            <KeyRound size={16} className="text-pagnol-orange" />
            Cambiar Contraseña
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-600">
            Nueva contraseña para <strong>{userToEdit.name}</strong>. El cambio es inmediato.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 pt-2 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-600">Nueva Contraseña</Label>
            <div className="relative">
              <Input
                {...register('newPassword')}
                type={showNew ? 'text' : 'password'}
                placeholder="Mínimo 6 caracteres"
                className="h-11 rounded-xl pr-10"
              />
              <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-600">
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-600">Confirmar Contraseña</Label>
            <div className="relative">
              <Input
                {...register('confirmPassword')}
                type={showConfirm ? 'text' : 'password'}
                placeholder="Repite la contraseña"
                className="h-11 rounded-xl pr-10"
              />
              <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-600">
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
          </div>

          <DialogFooter className="pt-2 flex gap-3">
            <Button type="button" variant="ghost" onClick={handleClose} className="rounded-xl font-bold text-[10px] uppercase tracking-widest">
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-pagnol-orange hover:bg-orange-600 text-white font-black text-[10px] uppercase tracking-widest px-6"
            >
              {isSubmitting ? <Loader2 className="animate-spin mr-2" size={14} /> : <KeyRound size={14} className="mr-2" />}
              Actualizar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
