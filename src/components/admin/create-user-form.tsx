

'use client';
import React from 'react';
import { useForm, SubmitHandler, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, UserPlus, KeyRound } from 'lucide-react';
import type { UserRole, Tenant } from '@/modules/core/lib/data';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { ROLES, PLANS } from '@/modules/core/lib/permissions';
import { supabase } from '@/modules/core/lib/supabase';

const FormSchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  email: z.string().email('El correo electrónico no es válido.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
  role: z.enum(['administrador', 'director-faena', 'panolero', 'supervisor', 'operador', 'apr', 'guardia', 'finance', 'super-admin', 'cphs', 'jefe-terreno', 'jefe-turno', 'jefe-mantencion', 'quality', 'jefe-oficina-tecnica', 'contratista', 'geologo', 'topografo'], { required_error: 'Debes seleccionar un rol.' }),
  phone: z.string().optional(),
  rut: z.string().optional(),
  internalId: z.string().optional(),
});

type FormData = z.infer<typeof FormSchema>;

export function CreateUserForm() {
  const { toast } = useToast();
  const { user: authUser, tenants, currentTenantId } = useAuth();
  const { users, addUser } = useAppState();

  const currentTenant = React.useMemo(() => {
    if (!currentTenantId) return null;
    return (tenants || []).find((t: Tenant) => t.id === currentTenantId || t.tenantId === currentTenantId);
  }, [currentTenantId, tenants]);

  const plan = PLANS[(currentTenant as any)?.plan as keyof typeof PLANS] || PLANS.professional;

  const generateInternalId = React.useCallback(() => {
    const nextNum = (users || []).length + 1;
    return `PAG-EMP-${nextNum.toString().padStart(4, '0')}`;
  }, [users]);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: 'operador',
      phone: '',
      rut: '',
      internalId: '',
    }
  });

  React.useEffect(() => {
    setValue('internalId', generateInternalId());
  }, [generateInternalId, setValue]);

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    let tenantIdToAssign = currentTenantId;

    if (authUser?.role === 'super-admin' && !tenantIdToAssign) {
      toast({
        variant: 'destructive',
        title: 'Error de Suscriptor',
        description: 'Como Super-Admin, debes seleccionar un suscriptor antes de crear un usuario.',
      });
      return;
    }

    if (authUser?.role !== 'super-admin') {
      tenantIdToAssign = authUser?.tenantId || null;
    }

    if (!tenantIdToAssign) {
      toast({
        variant: 'destructive',
        title: 'Error de Suscriptor',
        description: 'No se pudo determinar el suscriptor para este usuario.',
      });
      return;
    }


    try {
      const { isPasswordLeaked } = await import('@/lib/password-security');
      if (await isPasswordLeaked(data.password)) {
        toast({
          variant: 'destructive',
          title: 'Contraseña Comprometida',
          description: 'Esta contraseña fue expuesta en filtraciones conocidas. Elige una diferente.',
        });
        return;
      }

      await addUser({
        ...data,
        tenantId: tenantIdToAssign,
      });

      toast({
        title: 'Usuario Creado Exitosamente',
        description: `${data.name} ha sido añadido con ID ${data.internalId || 'automático'}.`,
      });
      reset();
      setValue('internalId', generateInternalId());

    } catch (error: any) {
      console.error("Error creating user:", error);
      toast({
        variant: 'destructive',
        title: 'Error al crear usuario',
        description: error.message || 'No se pudo crear el usuario.',
      });
    }
  };

  const allowedRoles = React.useMemo(() => {
    let roles = plan.allowedRoles;
    if (authUser?.role !== 'super-admin') {
      roles = (roles || []).filter((r: UserRole) => r !== 'super-admin');
    }
    return roles;
  }, [plan, authUser]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Nombre Completo</Label>
          <Input id="name" placeholder="Ej: Maria Rodriguez" {...register('name')} className="h-12 rounded-xl focus:ring-4 focus:ring-primary/10 shadow-sm border-slate-200" />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="rut" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">RUT / Identificación</Label>
          <Input id="rut" placeholder="12.345.678-k" {...register('rut')} className="h-12 rounded-xl focus:ring-4 focus:ring-primary/10 shadow-sm border-slate-200" />
          {errors.rut && <p className="text-xs text-destructive">{errors.rut.message}</p>}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Correo Electrónico</Label>
        <Input id="email" type="email" placeholder="ej: m.rodriguez@ferroactiva.cl" {...register('email')} className="h-12 rounded-xl focus:ring-4 focus:ring-primary/10 shadow-sm border-slate-200" />
        {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="internalId" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">ID Interno (Pagnol)</Label>
        <div className="relative">
          <Input id="internalId" readOnly {...register('internalId')} className="h-12 pl-12 bg-slate-50 font-black text-pagnol-orange border-dashed border-slate-200 rounded-xl" />
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-pagnol-orange/50">
            <KeyRound size={16} />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Teléfono Operativo</Label>
        <Input id="phone" type="tel" placeholder="Ej: 56912345678" {...register('phone')} className="h-12 rounded-xl focus:ring-4 focus:ring-primary/10 shadow-sm border-slate-200" />
        {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password" title="Contraseña de acceso inicial">Fijar Contraseña</Label>
        <Input id="password" type="password" placeholder="Mínimo 6 caracteres" {...register('password')} className="h-12 rounded-xl" />
        {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="role" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Asignación de Rol</Label>
        <Controller
          name="role"
          control={control}
          render={({ field }) => (
            <Select onValueChange={field.onChange} value={field.value}>
              <SelectTrigger id="role" className="h-12 rounded-xl focus:ring-4 focus:ring-primary/10 shadow-sm border-slate-200">
                <SelectValue placeholder="Selecciona un rol" />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-none shadow-2xl">
                {(allowedRoles || []).map((roleKey: UserRole) => (
                  <SelectItem key={roleKey} value={roleKey} className="rounded-xl my-1">
                    {ROLES[roleKey]?.label || roleKey}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.role && <p className="text-xs text-destructive">{errors.role.message}</p>}
      </div>

      <Button type="submit" className="w-full h-14 rounded-2xl bg-pagnol-orange hover:bg-orange-600 font-black text-[11px] uppercase tracking-widest shadow-xl shadow-orange-500/20 transform hover:scale-[1.02] transition-all" disabled={isSubmitting}>
        {isSubmitting ? (
          <Loader2 className="mr-3 h-4 w-4 animate-spin" />
        ) : (
          <UserPlus className="mr-3 h-4 w-4" />
        )}
        Añadir Colaborador
      </Button>
    </form>
  );
}
