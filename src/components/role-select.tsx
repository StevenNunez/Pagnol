'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ROLES } from '@/modules/core/lib/permissions';
import type { UserRole } from '@/modules/core/lib/data';

interface RoleSelectProps {
    value: string | undefined;
    onChange: (value: string) => void;
    /** Roles seleccionables (normalmente de `useAssignableRoles()`). */
    roles: UserRole[];
    disabled?: boolean;
    id?: string;
    className?: string;
    placeholder?: string;
}

/**
 * Selector de rol compartido. Pinta las etiquetas desde `ROLES` (fuente única) y
 * siempre incluye el `value` actual aunque no esté en `roles` (p.ej. editar a un
 * usuario con un rol que ya no permite el plan), para no ocultarlo sin querer.
 */
export function RoleSelect({ value, onChange, roles, disabled, id, className, placeholder }: RoleSelectProps) {
    const list = value && !roles.includes(value as UserRole) ? [value as UserRole, ...roles] : roles;
    return (
        <Select onValueChange={onChange} value={value ?? undefined} disabled={disabled}>
            <SelectTrigger id={id} className={className ?? 'h-12 rounded-xl'}>
                <SelectValue placeholder={placeholder ?? 'Selecciona un rol'} />
            </SelectTrigger>
            <SelectContent className="rounded-2xl max-h-72">
                {list.map(r => (
                    <SelectItem key={r} value={r} className="rounded-xl my-1">
                        {ROLES[r]?.label || r}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
