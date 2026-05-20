'use client';
import React from 'react';
import { useForm, SubmitHandler, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { supabase } from '@/modules/core/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Building2, User, Mail, Crown } from 'lucide-react';
import { nanoid } from 'nanoid';

const FormSchema = z.object({
  tenantName: z.string().min(3, 'Nombre de empresa requerido.'),
  tenantRut: z.string().min(5, 'RUT de empresa requerido.'),
  plan: z.enum(['starter', 'professional', 'enterprise']),
  adminName: z.string().min(3, 'Nombre del administrador requerido.'),
  adminEmail: z.string().email('Correo no válido.'),
});

type FormData = z.infer<typeof FormSchema>;

export function CreateTenantForm() {
  const { user } = useAuth();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: { plan: 'professional' },
  });

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
      // 1. Crear tenant
      const { data: tenantData, error: tenantError } = await supabase
        .from('tenants')
        .insert({ name: data.tenantName, tenant_id: data.tenantRut, plan: data.plan, is_active: true })
        .select()
        .single();

      if (tenantError) throw tenantError;

      // 2. Crear invitación
      const token = nanoid(32);
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

      const { error: invError } = await supabase.from('invitations').insert({
        email: data.adminEmail,
        role: 'administrador',
        tenant_id: tenantData.id,
        token,
        status: 'pending',
        expires_at: expiresAt,
        invited_by: user?.id ?? null,
      });

      if (invError) throw invError;

      // 3. Enviar email
      await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.adminEmail,
          role: 'administrador',
          token,
          tenantName: data.tenantName,
          invitedByName: user?.name ?? 'Pagnol',
        }),
      });

      toast({
        title: '¡Empresa creada!',
        description: `"${data.tenantName}" creada. Se envió invitación a ${data.adminEmail}.`,
      });
      reset();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al crear empresa',
        description: error.message || 'No se pudo completar la operación.',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nombre Empresa</Label>
        <div className="relative">
          <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
          <Input {...register('tenantName')} placeholder="Minera Norte S.A." className="pl-9 h-10 rounded-xl text-sm" />
        </div>
        {errors.tenantName && <p className="text-xs text-destructive">{errors.tenantName.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">RUT Empresa</Label>
        <Input {...register('tenantRut')} placeholder="76.123.456-7" className="h-10 rounded-xl text-sm" />
        {errors.tenantRut && <p className="text-xs text-destructive">{errors.tenantRut.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Plan</Label>
        <Controller
          name="plan"
          control={control}
          render={({ field }) => (
            <Select onValueChange={field.onChange} value={field.value}>
              <SelectTrigger className="h-10 rounded-xl text-sm">
                <Crown size={14} className="text-pagnol-orange mr-2" />
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

      <div className="h-px bg-slate-100 dark:bg-white/5 my-2" />

      <div className="space-y-1.5">
        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nombre Administrador</Label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
          <Input {...register('adminName')} placeholder="Juan Pérez" className="pl-9 h-10 rounded-xl text-sm" />
        </div>
        {errors.adminName && <p className="text-xs text-destructive">{errors.adminName.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Correo Administrador</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
          <Input {...register('adminEmail')} type="email" placeholder="admin@empresa.cl" className="pl-9 h-10 rounded-xl text-sm" />
        </div>
        {errors.adminEmail && <p className="text-xs text-destructive">{errors.adminEmail.message}</p>}
      </div>

      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full h-10 bg-pagnol-orange hover:bg-orange-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px] mt-2"
      >
        {isSubmitting ? <Loader2 className="animate-spin mr-2" size={14} /> : null}
        {isSubmitting ? 'Creando...' : 'Crear y Enviar Invitación'}
      </Button>
    </form>
  );
}
