

'use client';
import React from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Loader2, UserPlus } from 'lucide-react';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { ROLES_ORDER } from '@/modules/core/lib/permissions';
import { useAssignableRoles } from '@/modules/core/hooks/use-assignable-roles';
import { UserIdentityFields } from '@/components/user-identity-fields';
import { generateUserInternalId } from '@/modules/core/lib/user-internal-id';

const FormSchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  email: z.string().email('El correo electrónico no es válido.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
  role: z.enum(ROLES_ORDER as [string, ...string[]], { required_error: 'Debes seleccionar un rol.' }),
  phone: z.string().optional(),
  rut: z.string().optional(),
  internalId: z.string().optional(),
  // El cargo se pide acá, no después: es el que hereda "Personal en obra" de la
  // OT al elegir al trabajador. Si nace vacío, ese autocompletado no sirve.
  cargo: z.string().optional(),
});

type FormData = z.infer<typeof FormSchema>;

export function CreateUserForm() {
  const { toast } = useToast();
  const { user: authUser, currentTenantId } = useAuth();
  const { users, addUser } = useAppState();
  const allowedRoles = useAssignableRoles();

  const generateInternalId = React.useCallback(() => generateUserInternalId(users), [users]);

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
      cargo: '',
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <UserIdentityFields
        register={register}
        control={control}
        errors={errors}
        assignableRoles={allowedRoles}
        columns={1}
        showPassword
        showPhone
        showCargo
      />

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
