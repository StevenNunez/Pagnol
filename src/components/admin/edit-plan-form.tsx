
'use client';
import React, { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save } from 'lucide-react';
import { SubscriptionPlan } from '@/modules/core/lib/data';
import { PERMISSIONS, Permission } from '@/modules/core/lib/permissions';
import { ScrollArea } from '../ui/scroll-area';
import { Checkbox } from '../ui/checkbox';

interface EditPlanFormProps {
    plan: SubscriptionPlan & { id: string };
}

type GroupedPermissions = {
    [group: string]: { key: string, label: string }[];
};

export function EditPlanForm({ plan }: EditPlanFormProps) {
  const { updatePlanPermissions } = useAppState();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [selectedPermissions, setSelectedPermissions] = useState<Permission[]>((plan.allowedPermissions as Permission[]) || []);

  useEffect(() => {
    setSelectedPermissions((plan.allowedPermissions as Permission[]) || []);
  }, [plan]);

  const groupedPermissions = React.useMemo(() => {
    return (Object.keys(PERMISSIONS) as Permission[]).reduce((acc, key) => {
        const perm = PERMISSIONS[key];
        const group = perm.group || 'General';
        if (!acc[group]) acc[group] = [];
        acc[group].push({ key, label: perm.label });
        return acc;
    }, {} as GroupedPermissions);
  }, []);

  const handlePermissionToggle = (permission: Permission, checked: boolean) => {
      setSelectedPermissions(prev => 
          checked ? [...prev, permission] : prev.filter(p => p !== permission)
      );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
        await updatePlanPermissions(plan.id, selectedPermissions);
        toast({
            title: 'Plan Actualizado',
            description: `Los permisos para el plan ${plan.plan} han sido guardados.`
        });
    } catch(error: any) {
        toast({
            variant: 'destructive',
            title: 'Error',
            description: error.message || 'No se pudo actualizar el plan.'
        });
    } finally {
        setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
        <ScrollArea className="h-96 p-4 border rounded-md">
            <div className="space-y-6">
                {Object.keys(groupedPermissions).sort().map(groupName => (
                    <div key={groupName}>
                        <h4 className="font-medium mb-3 text-primary">{groupName}</h4>
                        <div className="grid grid-cols-1 gap-3">
                            {groupedPermissions[groupName].map(({ key, label }) => (
                                <div key={key} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`${plan.id}-${key}`}
                                        checked={selectedPermissions.includes(key as Permission)}
                                        onCheckedChange={(checked) => handlePermissionToggle(key as Permission, checked as boolean)}
                                    />
                                    <Label htmlFor={`${plan.id}-${key}`} className="text-sm font-normal cursor-pointer">
                                        {label}
                                    </Label>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </ScrollArea>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
            Guardar Permisos del Plan
        </Button>
    </form>
  );
}
