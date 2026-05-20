"use client";

import React from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Shield, AlertCircle, ShieldCheck, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { UserRole } from "@/modules/core/lib/data";
import { PERMISSIONS, Permission, ROLES, ROLES_ORDER } from "@/modules/core/lib/permissions";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/modules/core/hooks/use-toast";

type GroupedPermissions = { [group: string]: { key: string; label: string }[] };

const roleColors: Partial<Record<UserRole, string>> = {
  'super-admin': 'bg-red-100 text-red-700 border-red-200',
  'administrador': 'bg-pagnol-orange/10 text-pagnol-orange border-pagnol-orange/20',
  'director-faena': 'bg-blue-100 text-blue-700 border-blue-200',
  'supervisor': 'bg-violet-100 text-violet-700 border-violet-200',
};

function RoleCard({
  role, label, description, capabilities, isEditable, onPermissionChange,
}: {
  role: UserRole; label: string; description: string; capabilities: string[];
  isEditable: boolean; onPermissionChange: (role: UserRole, permission: Permission, checked: boolean) => void;
}) {
  const { user: authUser } = useAuth();

  const groupedPermissions = React.useMemo<GroupedPermissions>(() => {
    return (Object.keys(PERMISSIONS) as Permission[]).reduce((acc, key) => {
      const perm = PERMISSIONS[key];
      const group = perm.group || 'General';
      if (authUser?.role !== 'super-admin' && group === 'Plataforma') return acc;
      if (!acc[group]) acc[group] = [];
      acc[group].push({ key, label: perm.label });
      return acc;
    }, {} as GroupedPermissions);
  }, [authUser]);

  const totalPerms = Object.values(groupedPermissions).flat().length;
  const activePerms = capabilities.length;
  const colorClass = roleColors[role] ?? 'bg-slate-100 text-slate-600 border-slate-200';

  return (
    <AccordionItem value={role} className="border-none">
      <Card className="rounded-[2rem] border border-slate-100 dark:border-white/5 shadow-sm overflow-hidden mb-3">
        <AccordionTrigger className="hover:no-underline px-6 py-5 [&>svg]:text-muted-foreground [&>svg]:shrink-0">
          <div className="flex items-center gap-4 flex-1 text-left">
            <div className={`p-2.5 rounded-2xl border ${colorClass}`}>
              <Shield size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-black uppercase">{label}</p>
                <Badge className={`text-[8px] font-black uppercase rounded-lg border ${colorClass}`}>
                  {activePerms}/{totalPerms} permisos
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground font-medium mt-0.5 truncate">{description}</p>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="px-6 pb-6 space-y-6">
            {!isEditable && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-slate-50 dark:bg-white/5 rounded-xl px-4 py-2.5">
                <Lock size={12} /> Solo lectura — sin permisos de edición
              </div>
            )}
            {Object.keys(groupedPermissions).sort().map((groupName) => (
              <div key={groupName}>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-pagnol-orange mb-3 flex items-center gap-2">
                  <ShieldCheck size={10} /> {groupName}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {groupedPermissions[groupName].map(({ key, label: permLabel }) => {
                    const hasCapability = capabilities.includes(key);
                    return (
                      <div key={key} className="flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-white/5 px-3 py-2.5">
                        <Switch
                          id={`${role}-${key}`}
                          checked={hasCapability}
                          onCheckedChange={(checked) => onPermissionChange(role, key as Permission, checked)}
                          disabled={!isEditable}
                        />
                        <Label htmlFor={`${role}-${key}`} className="text-[10px] font-bold uppercase tracking-wide cursor-pointer leading-tight">
                          {permLabel}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </AccordionContent>
      </Card>
    </AccordionItem>
  );
}

export default function PermissionsPage() {
  const { roles, updateRolePermissions } = useAppState();
  const { user, can } = useAuth();
  const { toast } = useToast();

  const handlePermissionChange = async (role: UserRole, permission: Permission, checked: boolean) => {
    try {
      await updateRolePermissions(role, permission, checked);
      toast({
        title: "Permiso actualizado",
        description: `'${PERMISSIONS[permission]?.label || permission}' para '${ROLES[role]?.label || role}' fue ${checked ? 'activado' : 'desactivado'}.`,
      });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || "No se pudo actualizar el permiso" });
    }
  };

  const visibleRoles = React.useMemo(() => {
    if (!user) return [];
    const canManage = can('permissions:manage');
    return ROLES_ORDER
      .map((roleKey) => {
        const defaultRole = ROLES[roleKey];
        if (!defaultRole) return null;
        const dbRole = roles?.[roleKey];
        return {
          key: roleKey,
          label: defaultRole.label,
          description: defaultRole.description,
          permissions: dbRole?.permissions || defaultRole.permissions,
          isEditable: canManage || user.role === 'super-admin',
        };
      })
      .filter(Boolean)
      .filter((r) => user.role === 'super-admin' || r!.key !== 'super-admin');
  }, [user, roles, can]);

  if (!can('module_permissions:view')) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle size={36} />
        <p className="font-bold uppercase tracking-widest text-sm">Acceso denegado</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Gestión de Permisos y Roles"
        description="Configura qué puede hacer cada rol dentro del sistema."
      />

      {!can('permissions:manage') && user?.role !== 'super-admin' && (
        <Card className="rounded-[2rem] border-none shadow bg-amber-50 dark:bg-amber-900/20">
          <CardContent className="p-5 flex items-center gap-3">
            <Lock size={16} className="text-amber-500 shrink-0" />
            <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest">
              Modo solo lectura — necesitas el permiso &quot;Gestionar Permisos&quot; para editar.
            </p>
          </CardContent>
        </Card>
      )}

      <Accordion type="multiple" className="w-full space-y-0">
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
    </div>
  );
}
