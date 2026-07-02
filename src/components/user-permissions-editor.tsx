'use client';

import { useMemo, useState } from 'react';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, CheckCircle } from 'lucide-react';
import { ROLES, ALL_PERMISSIONS } from '@/modules/core/lib/permissions';
import type { User } from '@/modules/core/lib/data';

interface UserPermissionsEditorProps {
    user: User;
    /** Se llama con los permisos otorgados (extra al rol) tras guardar con éxito. */
    onSaved?: (granted: string[]) => void;
}

/**
 * Selector de autorizaciones por usuario (permisos `granted_permissions`, ADITIVOS al rol).
 * Fuente única usada por el panel de usuario y por Gestión de Personal. Los permisos que el
 * usuario ya hereda de su rol se muestran bloqueados ("heredado").
 */
export function UserPermissionsEditor({ user, onSaved }: UserPermissionsEditorProps) {
    const { updateUserPermissions } = useAppState();
    const { user: currentUser } = useAuth();
    const { toast } = useToast();

    const [permDraft, setPermDraft] = useState<string[]>(user.grantedPermissions ?? []);
    const [permSearch, setPermSearch] = useState('');
    const [saving, setSaving] = useState(false);

    const permissionGroups = useMemo(() => {
        const groups: Record<string, { key: string; label: string }[]> = {};
        (Object.entries(ALL_PERMISSIONS) as [string, { label: string; group: string }][])
            .forEach(([key, meta]) => { (groups[meta.group] ||= []).push({ key, label: meta.label }); });
        return groups;
    }, []);

    const inherited = useMemo(() => new Set<string>(ROLES[user.role]?.permissions ?? []), [user.role]);
    const q = permSearch.trim().toLowerCase();
    const grantedCount = permDraft.filter(p => !inherited.has(p)).length;

    const togglePerm = (key: string) =>
        setPermDraft(prev => prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const granted = permDraft.filter(p => !inherited.has(p));
            await updateUserPermissions(user.id, granted);
            toast({ title: 'Autorizaciones actualizadas', description: `Se guardaron los permisos de ${user.name}. El usuario debe volver a iniciar sesión para verlos aplicados.` });
            onSaved?.(granted);
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error de Autorización', description: err.message });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between gap-4 pb-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    {getRoleLabel(user)} · {grantedCount} extra
                </p>
                <div className="relative w-full sm:w-64">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                    <Input placeholder="Buscar permiso..." value={permSearch} onChange={e => setPermSearch(e.target.value)} className="pl-10 h-11 rounded-xl bg-card border text-xs font-bold" />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6 pr-1 custom-scrollbar">
                {Object.entries(permissionGroups).map(([group, perms]) => {
                    const visible = perms.filter(p => !q || p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q));
                    if (visible.length === 0) return null;
                    return (
                        <div key={group} className="space-y-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{group}</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {visible.map(({ key, label }) => {
                                    const isInherited = inherited.has(key);
                                    const isChecked = isInherited || permDraft.includes(key);
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            disabled={isInherited}
                                            onClick={() => togglePerm(key)}
                                            className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${isInherited ? 'bg-muted/50 border-border opacity-70 cursor-default' :
                                                isChecked ? 'bg-success-subtle border-success/40' : 'bg-card border-border hover:border-primary/40'
                                                }`}
                                        >
                                            <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border ${isChecked ? 'bg-success border-success text-success-foreground' : 'border-border'}`}>
                                                {isChecked && <CheckCircle size={12} />}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold text-foreground truncate">{label}</p>
                                                {isInherited && <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Heredado del rol</p>}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center gap-4 pt-4 border-t mt-4">
                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest hidden sm:block">Autorizado por {currentUser?.name} · queda auditado</p>
                <Button onClick={handleSave} disabled={saving} className="rounded-xl font-black uppercase text-[10px] tracking-widest h-11 px-8 shadow-lg ml-auto">
                    {saving ? 'Guardando...' : 'Guardar Autorizaciones'}
                </Button>
            </div>
        </div>
    );
}

function getRoleLabel(user: User): string {
    return ROLES[user.role]?.label || user.role;
}
