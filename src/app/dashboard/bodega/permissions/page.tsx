
"use client";

import React from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Shield, AlertCircle } from "lucide-react";
import { UserRole } from "@/modules/core/lib/data";
import { PERMISSIONS, Permission, ROLES, ROLES_ORDER } from "@/modules/core/lib/permissions";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type GroupedPermissions = {
    [group: string]: { key: string, label: string }[];
};

const RoleCard = ({ 
    role, 
    label,
    description, 
    capabilities, 
    isEditable, 
    onPermissionChange 
}: { 
    role: UserRole; 
    label: string;
    description: string; 
    capabilities: string[]; 
    isEditable: boolean;
    onPermissionChange: (role: UserRole, permission: Permission, checked: boolean) => void;
}) => {
    const { user: authUser } = useAuth();

    const groupedPermissions = React.useMemo(() => {
        return (Object.keys(PERMISSIONS) as Permission[]).reduce((acc, key) => {
            const perm = PERMISSIONS[key];
            const group = perm.group || 'General';

            if (authUser?.role !== 'super-admin' && group === 'Plataforma') {
                return acc;
            }

            if (!acc[group]) acc[group] = [];
            acc[group].push({ key, label: perm.label });
            return acc;
        }, {} as GroupedPermissions);
    }, [authUser]);

    return (
        <AccordionItem value={role}>
            <AccordionTrigger className="hover:no-underline">
                <div className="flex flex-col text-left">
                    <h3 className="font-semibold text-lg">{label}</h3>
                    <p className="text-sm text-muted-foreground font-normal">{description}</p>
                </div>
            </AccordionTrigger>
            <AccordionContent>
                <div className="p-4 bg-muted/50 rounded-md space-y-6">
                    {Object.keys(groupedPermissions).sort().map(groupName => {
                        const permissionsInGroup = groupedPermissions[groupName];
                        return (
                            <div key={groupName}>
                                <h4 className="font-medium mb-3 text-primary">{groupName}</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {permissionsInGroup.map(({ key, label }) => {
                                        const hasCapability = capabilities.includes(key);
                                        return (
                                            <div key={key} className="flex items-center space-x-2">
                                                <Switch
                                                    id={`${role}-${key}`}
                                                    checked={hasCapability}
                                                    onCheckedChange={(checked) => onPermissionChange(role, key as Permission, checked)}
                                                    disabled={!isEditable}
                                                />
                                                <Label htmlFor={`${role}-${key}`} className="text-sm cursor-pointer">
                                                    {label}
                                                </Label>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </AccordionContent>
        </AccordionItem>
    );
};

export default function PermissionsPage() {
    const { roles, updateRolePermissions } = useAppState();
    const { user, can } = useAuth();
    const { toast } = useToast();

    const handlePermissionChange = async (role: UserRole, permission: Permission, checked: boolean) => {
        try {
            await updateRolePermissions(role, permission, checked);
            toast({
                title: "Permiso Actualizado",
                description: `El permiso '${PERMISSIONS[permission]?.label || permission}' para el rol '${ROLES[role]?.label || role}' ha sido ${checked ? 'activado' : 'desactivado'}.`,
            });
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: error.message || "No se pudo actualizar el permiso",
            });
        }
    };
    
    const visibleRoles = React.useMemo(() => {
        if (!user) return [];

        const canManage = can('permissions:manage');

        return ROLES_ORDER
          .map(roleKey => {
            const defaultRole = ROLES[roleKey];
            const dbRole = roles?.[roleKey];

            if (!defaultRole) return null;

            return {
              key: roleKey,
              label: defaultRole.label,
              description: defaultRole.description,
              permissions: dbRole?.permissions || defaultRole.permissions,
              isEditable: canManage || user.role === 'super-admin'
            };
          })
          .filter(Boolean)
          .filter(role => user.role === 'super-admin' || role!.key !== 'super-admin');
    }, [user, roles, can]);

    if (!can('module_permissions:view')) {
      return (
        <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Acceso Denegado</AlertTitle>
            <AlertDescription>
                No tienes los permisos necesarios para acceder a esta sección.
            </AlertDescription>
        </Alert>
      );
    }

    return (
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Gestión de Permisos y Roles"
                description="Visualiza y edita las capacidades de cada rol en el sistema."
            />
            
            {!can('permissions:manage') && user?.role !== 'super-admin' && (
                <Alert>
                    <Shield className="h-4 w-4" />
                    <AlertTitle>Modo de Solo Lectura</AlertTitle>
                    <AlertDescription>
                        Tu rol actual solo permite visualizar los permisos. Contacta a un administrador para realizar cambios.
                    </AlertDescription>
                </Alert>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Shield /> Manifiesto de Capacidades</CardTitle>
                    <CardDescription>
                       Haz clic en un rol para expandir y gestionar sus permisos. Los cambios se guardarán en tiempo real.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Accordion type="multiple" className="w-full">
                       {visibleRoles.map((roleData) => (
                           <RoleCard 
                                key={roleData!.key}
                                role={roleData!.key as UserRole}
                                label={roleData!.label}
                                description={roleData!.description}
                                capabilities={roleData!.permissions}
                                isEditable={roleData!.isEditable}
                                onPermissionChange={handlePermissionChange}
                           />
                       ))}
                    </Accordion>
                </CardContent>
            </Card>
        </div>
    );
}
