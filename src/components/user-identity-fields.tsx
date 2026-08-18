'use client';

import { Controller, type Control, type UseFormRegister, type FieldErrors, type FieldValues, type Path } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound } from 'lucide-react';
import { RoleSelect } from '@/components/role-select';
import type { UserRole } from '@/modules/core/lib/data';
import { cn } from '@/lib/utils';

/**
 * Campos de identidad comunes a los formularios de creación/enrolamiento de usuario.
 * Fuente única del bloque nombre/RUT/email/rol/ID/contraseña/teléfono que antes estaba
 * duplicado en CreateUserForm y en el paso "info" del EnrollmentWizard.
 *
 * Genérico sobre el tipo del form (`T`) que debe contener estos campos, para que los
 * call sites pasen `register`/`control`/`errors` sin casts.
 */
export interface UserIdentityValues {
    name: string;
    email: string;
    rut?: string;
    role: string;
    internalId?: string;
    password?: string;
    phone?: string;
    cargo?: string;
}

interface UserIdentityFieldsProps<T extends FieldValues & UserIdentityValues> {
    register: UseFormRegister<T>;
    control: Control<T>;
    errors: FieldErrors<T>;
    /** Roles seleccionables (de `useAssignableRoles()`). */
    assignableRoles: UserRole[];
    /** 1 = campos apilados (sidebar angosto); 2 = grilla de 2 columnas (diálogo ancho). */
    columns?: 1 | 2;
    showPassword?: boolean;
    showPhone?: boolean;
    /**
     * Muestra "Cargo / Puesto". Se pide al dar de alta y al enrolar porque de ahí
     * lo hereda "Personal en obra" de la OT. `UserPanel` lo deja en `false`: su
     * pestaña Contrato/RRHH ya trae su propio campo y saldría duplicado.
     */
    showCargo?: boolean;
    /** Bloquea nombre/RUT/email (p.ej. al enrolar a un usuario ya existente). */
    readOnlyIdentity?: boolean;
    /** Bloquea SOLO el email (p.ej. al editar un usuario: el email se cambia aparte). */
    emailReadOnly?: boolean;
    roleDisabled?: boolean;
}

const labelCls = 'text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1';
const inputCls = 'h-12 rounded-xl';

export function UserIdentityFields<T extends FieldValues & UserIdentityValues>({
    register,
    control,
    errors,
    assignableRoles,
    columns = 1,
    showPassword = false,
    showPhone = false,
    showCargo = false,
    readOnlyIdentity = false,
    emailReadOnly = false,
    roleDisabled = false,
}: UserIdentityFieldsProps<T>) {
    // El componente conoce sus propios campos; casteamos los errores a la forma común.
    const e = errors as FieldErrors<UserIdentityValues>;
    const f = (name: keyof UserIdentityValues) => register(name as Path<T>);

    return (
        <div className={cn('grid gap-5', columns === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1')}>
            <div className="space-y-1.5">
                <Label className={labelCls}>Nombre Completo</Label>
                <Input placeholder="Ej: Juan López" {...f('name')} readOnly={readOnlyIdentity} className={inputCls} />
                {e.name && <p className="text-xs text-destructive">{e.name.message as string}</p>}
            </div>

            <div className="space-y-1.5">
                <Label className={labelCls}>RUT / Identificación</Label>
                <Input placeholder="12.345.678-9" {...f('rut')} readOnly={readOnlyIdentity} className={inputCls} />
                {e.rut && <p className="text-xs text-destructive">{e.rut.message as string}</p>}
            </div>

            <div className="space-y-1.5">
                <Label className={labelCls}>Correo Electrónico</Label>
                <Input type="email" placeholder="trabajador@empresa.cl" {...f('email')} readOnly={readOnlyIdentity || emailReadOnly} className={inputCls} />
                {e.email && <p className="text-xs text-destructive">{e.email.message as string}</p>}
            </div>

            <div className="space-y-1.5">
                <Label className={labelCls}>Rol en el Sistema</Label>
                <Controller
                    name={'role' as Path<T>}
                    control={control}
                    render={({ field }) => (
                        <RoleSelect
                            value={field.value}
                            onChange={field.onChange}
                            roles={assignableRoles}
                            disabled={roleDisabled}
                            placeholder="Seleccionar rol..."
                        />
                    )}
                />
                {e.role && <p className="text-xs text-destructive">{e.role.message as string}</p>}
            </div>

            {showCargo && (
                <div className="space-y-1.5">
                    <Label className={labelCls}>Cargo / Puesto</Label>
                    <Input placeholder="Ej: Mecánico A" {...f('cargo')} className={inputCls} />
                    {e.cargo && <p className="text-xs text-destructive">{e.cargo.message as string}</p>}
                </div>
            )}

            {showPassword && (
                <div className="space-y-1.5">
                    <Label className={labelCls}>Contraseña Temporal</Label>
                    <Input type="password" placeholder="Mínimo 6 caracteres" {...f('password')} className={inputCls} />
                    {e.password && <p className="text-xs text-destructive">{e.password.message as string}</p>}
                </div>
            )}

            {showPhone && (
                <div className="space-y-1.5">
                    <Label className={labelCls}>Teléfono Operativo</Label>
                    <Input type="tel" placeholder="Ej: 56912345678" {...f('phone')} className={inputCls} />
                    {e.phone && <p className="text-xs text-destructive">{e.phone.message as string}</p>}
                </div>
            )}

            <div className="space-y-1.5">
                <Label className={labelCls}>ID Interno (Auto)</Label>
                <div className="relative">
                    <KeyRound size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input readOnly {...f('internalId')} className={cn(inputCls, 'pl-10 bg-muted font-mono')} />
                </div>
            </div>
        </div>
    );
}
