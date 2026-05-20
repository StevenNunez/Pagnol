'use client';
import React from 'react';
import { useForm, SubmitHandler, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/modules/core/hooks/use-toast';
import { supabase } from '@/modules/core/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save } from 'lucide-react';
import { Tenant } from '@/modules/core/lib/data';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';

const FormSchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  plan: z.enum(['starter', 'professional', 'enterprise']),
  is_active: z.boolean(),
});

type FormData = z.infer<typeof FormSchema>;

interface EditTenantFormProps {
  tenant: Tenant & { is_active?: boolean };
  onSaved?: () => void;
}

export function EditTenantForm({ tenant, onSaved }: EditTenantFormProps) {
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: tenant.name,
      plan: (tenant.plan as any) ?? 'professional',
      is_active: (tenant as any).is_active ?? true,
    },
  });

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ name: data.name, plan: data.plan, is_active: data.is_active })
        .eq('id', tenant.id);

      if (error) throw error;

      toast({ title: 'Empresa actualizada', description: `Los datos de "${data.name}" fueron guardados.` });
      onSaved?.();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'No se pudo actualizar.' });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nombre de la Empresa</Label>
        <Input {...register('name')} className="h-10 rounded-xl text-sm" />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">RUT (no editable)</Label>
        <Input value={tenant.tenantId} disabled className="h-10 rounded-xl text-sm bg-slate-50 dark:bg-white/5" />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Plan</Label>
        <Controller
          name="plan"
          control={control}
          render={({ field }) => (
            <Select onValueChange={field.onChange} value={field.value}>
              <SelectTrigger className="h-10 rounded-xl text-sm">
                <SelectValue placeholder="Selecciona un plan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        {errors.plan && <p className="text-xs text-destructive">{errors.plan.message}</p>}
      </div>

      <div className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-white/5 px-4 py-3">
        <Label className="text-xs font-bold uppercase tracking-widest cursor-pointer">Empresa Activa</Label>
        <Controller
          name="is_active"
          control={control}
          render={({ field }) => (
            <Switch checked={field.value} onCheckedChange={field.onChange} />
          )}
        />
      </div>

      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full h-10 bg-pagnol-orange hover:bg-orange-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px]"
      >
        {isSubmitting ? <Loader2 className="animate-spin mr-2" size={14} /> : <Save size={14} className="mr-2" />}
        Guardar Cambios
      </Button>
    </form>
  );
}
