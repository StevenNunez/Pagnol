

'use client';
import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useForm, SubmitHandler, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save, KeyRound, Phone, CalendarIcon, Edit, Briefcase } from 'lucide-react';
import { User, UserRole } from '@/modules/core/lib/data';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { type FieldValue } from '@/modules/core/lib/data';
import { AdminChangePasswordDialog } from './admin-change-password-dialog';
import { ROLES } from '@/modules/core/lib/permissions';

const Calendar = dynamic(() => import('@/components/ui/calendar').then(mod => mod.Calendar), { ssr: false });


const FormSchema = z.object({
    name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
    role: z.enum(['administrador', 'director-faena', 'panolero', 'supervisor', 'operador', 'apr', 'guardia', 'finance', 'super-admin', 'cphs', 'jefe-terreno', 'jefe-turno', 'jefe-mantencion', 'quality', 'jefe-oficina-tecnica', 'contratista', 'geologo', 'topografo'], { required_error: 'Debes seleccionar un rol.' }),
    rut: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    cargo: z.string().optional().nullable(),
    fechaIngreso: z.date().optional().nullable(),
    baseSalary: z.coerce.number().optional().nullable(),
    afp: z.string().optional().nullable(),
    tipoSalud: z.enum(['Fonasa', 'Isapre']).optional().nullable(),
    cargasFamiliares: z.coerce.number().optional().nullable(),
});

type FormData = z.infer<typeof FormSchema>;

interface EditUserFormProps {
    user: User;
    isOpen: boolean;
    onClose: () => void;
}

export function EditUserForm({ user, isOpen, onClose }: EditUserFormProps) {
    const { updateUser } = useAppState();
    const { user: authUser, can } = useAuth();
    const { toast } = useToast();
    const [isPasswordDialogOpen, setPasswordDialogOpen] = useState(false);

    const canEditRole = React.useMemo(() => {
        if (!authUser) return false;
        if (authUser.role === 'super-admin') return true;
        if (can('users:edit') && user.role !== 'super-admin') {
            return true;
        }
        return false;
    }, [authUser, user, can]);


    const {
        register,
        handleSubmit,
        control,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<FormData>({
        resolver: zodResolver(FormSchema),
    });

    useEffect(() => {
        if (user && !isSubmitting) {
            reset({
                name: user.name,
                role: user.role,
                rut: user.rut || '',
                phone: user.phone || '',
                cargo: user.cargo || '',
                fechaIngreso: user.fechaIngreso ? new Date(user.fechaIngreso as any) : null,
                baseSalary: user.baseSalary || 0,
                afp: user.afp || '',
                tipoSalud: user.tipoSalud,
                cargasFamiliares: user.cargasFamiliares || 0,
            });
        }
    }, [user, reset, isSubmitting]);

    const onSubmit: SubmitHandler<FormData> = async (data) => {
        console.log('[EditUserForm] Submitting data:', data);
        try {
            const { fechaIngreso, ...restOfData } = data;

            // Explicitly create payload to avoid type conflicts with form data
            const updatePayload: { [key: string]: any } = { ...restOfData };

            if (!canEditRole) {
                delete updatePayload.role;
            }

            if (fechaIngreso) {
                updatePayload.fechaIngreso = fechaIngreso;
            } else {
                updatePayload.fechaIngreso = null;
            }

            // Remove undefined values to prevent database errors
            Object.keys(updatePayload).forEach(key => {
                if (updatePayload[key] === undefined) {
                    delete updatePayload[key];
                }
            });

            console.log('[EditUserForm] Sending update to DB for user:', user.id, updatePayload);
            await updateUser(user.id, updatePayload);
            console.log('[EditUserForm] Update successful');
            
            toast({
                title: 'Usuario Actualizado',
                description: `Los datos de ${data.name} han sido guardados.`,
            });
            onClose();
        } catch (error) {
            console.error('[EditUserForm] Update failed:', error);
            toast({
                variant: 'destructive',
                title: 'Error de Actualización',
                description: error instanceof Error ? error.message : 'No se pudo actualizar el usuario.',
            });
        }
    };

    const onInvalid = (errors: any) => {
        console.error('[EditUserForm] Validation Errors:', JSON.stringify(errors, null, 2));
    };

    return (
        <>
            {canEditRole && <AdminChangePasswordDialog isOpen={isPasswordDialogOpen} onClose={() => setPasswordDialogOpen(false)} userToEdit={user} />}
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="sm:max-w-3xl p-0 border-none bg-transparent shadow-3xl overflow-hidden rounded-[3rem]">
                    <DialogHeader className="p-8 industrial-gradient text-white flex flex-row justify-between items-center shrink-0">
                        <div className="space-y-1">
                            <DialogTitle className="text-2xl font-black uppercase tracking-tight">Editar Perfil Operativo</DialogTitle>
                            <DialogDescription className="text-white/60 text-[10px] font-black uppercase tracking-[0.2em]">
                                Configuración avanzada de credenciales y datos contractuales.
                            </DialogDescription>
                        </div>
                    </DialogHeader>
                    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="bg-card p-0 flex flex-col max-h-[85vh]">
                        <div className="p-10 space-y-10 overflow-y-auto custom-scrollbar flex-1">
                            <section className="space-y-6">
                                <div className="flex items-center gap-3 text-primary text-[11px] font-black uppercase tracking-[0.2em] border-b pb-3 border-slate-100">
                                    <Edit className="h-4 w-4" /> Información de Identidad
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-2">
                                        <Label htmlFor="user-name" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Nombre Completo</Label>
                                        <Input id="user-name" placeholder="Ej: Juan Pérez" {...register('name')} className="h-12 rounded-xl focus:ring-4 focus:ring-primary/10" />
                                        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="rut" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">RUT / Identificación</Label>
                                        <Input id="rut" placeholder="12.345.678-9" {...register('rut')} className="h-12 rounded-xl focus:ring-4 focus:ring-primary/10 shadow-sm" />
                                        {errors.rut && <p className="text-xs text-destructive">{errors.rut.message}</p>}
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-2">
                                        <Label htmlFor="role" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Rol del Usuario</Label>
                                        <Controller
                                            name="role"
                                            control={control}
                                            render={({ field }) => (
                                                <Select onValueChange={field.onChange} value={field.value ?? undefined} disabled={!canEditRole}>
                                                    <SelectTrigger id="role" className="h-12 rounded-xl focus:ring-4 focus:ring-primary/10">
                                                        <SelectValue placeholder="Selecciona un rol" />
                                                    </SelectTrigger>
                                                    <SelectContent className="rounded-2xl shadow-2xl border-none">
                                                        {Object.entries(ROLES).map(([key, value]) => (
                                                            (authUser?.role === 'super-admin' || key !== 'super-admin') && (
                                                                <SelectItem key={key} value={key} className="rounded-xl my-1">
                                                                    {value.label}
                                                                </SelectItem>
                                                            )
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        />
                                        {!canEditRole && <p className="text-[9px] font-bold text-slate-400 mt-1 italic uppercase">Protegido por nivel de seguridad.</p>}
                                        {errors.role && <p className="text-xs text-destructive">{errors.role.message}</p>}
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="user-email" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">E-mail de Acceso</Label>
                                        <Input id="user-email" type="email" value={user.email} disabled className="h-12 rounded-xl bg-slate-50 border-dashed border-slate-200" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="phone" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Teléfono Operativo</Label>
                                        <Input id="phone" placeholder="Ej: 56912345678" {...register('phone')} className="h-12 rounded-xl focus:ring-4 focus:ring-primary/10" />
                                        {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
                                    </div>
                                </div>

                                <div className="space-y-2 pt-2">
                                    <Label htmlFor="internalId" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Sincronización ID Pagnol</Label>
                                    <div className="relative">
                                        <Input id="internalId" value={user.internalId || 'PAG-EMP-0000'} disabled className="h-12 pl-12 rounded-xl bg-slate-900 font-black text-white border-none shadow-lg" />
                                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-primary animate-pulse">
                                            <KeyRound size={16} />
                                        </div>
                                    </div>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest text-center mt-2">Identificador único inmutable generado por el sistema.</p>
                                </div>
                            </section>

                            <section className="space-y-6">
                                <div className="flex items-center gap-3 text-primary text-[11px] font-black uppercase tracking-[0.2em] border-b pb-3 border-slate-100">
                                    <Briefcase className="h-4 w-4" /> Datos de Contratación y Previsión
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-2">
                                        <Label htmlFor="rut_prevision" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">RUT (Validación)</Label>
                                        <Input id="rut_prevision" value={user.rut || 'No Registrado'} disabled className="h-12 rounded-xl bg-slate-50 border-dashed" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="cargo" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Cargo / Puesto</Label>
                                        <Input id="cargo" placeholder="Ej: Maestro Carpintero" {...register('cargo')} className="h-12 rounded-xl" />
                                        {errors.cargo && <p className="text-xs text-destructive">{errors.cargo.message}</p>}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-2">
                                        <Label htmlFor="fechaIngreso" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Fecha de Ingreso</Label>
                                        <Controller
                                            name="fechaIngreso"
                                            control={control}
                                            render={({ field }) => (
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button
                                                            variant={"outline"}
                                                            className={cn(
                                                                "h-12 w-full justify-start text-left font-bold text-xs uppercase rounded-xl",
                                                                !field.value && "text-slate-400"
                                                            )}
                                                        >
                                                            <CalendarIcon className="mr-3 h-4 w-4 text-primary" />
                                                            {field.value ? format(field.value, "PPP", { locale: es }) : <span>Seleccionar fecha...</span>}
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0 rounded-[1.5rem] border-none shadow-2xl overflow-hidden">
                                                        <Calendar
                                                            mode="single"
                                                            selected={field.value || undefined}
                                                            onSelect={field.onChange}
                                                            initialFocus
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                            )}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="baseSalary" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Sueldo Base ($)</Label>
                                        <Input id="baseSalary" type="number" {...register('baseSalary')} className="h-12 rounded-xl" />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="space-y-2">
                                        <Label htmlFor="afp" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">AFP</Label>
                                        <Input id="afp" placeholder="Ej: Modelo" {...register('afp')} className="h-12 rounded-xl" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="tipoSalud" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Salud</Label>
                                        <Controller
                                            name="tipoSalud"
                                            control={control}
                                            render={({ field }) => (
                                                <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                                                    <SelectTrigger id="tipoSalud" className="h-12 rounded-xl">
                                                        <SelectValue placeholder="Selecciona..." />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="Fonasa">Fonasa</SelectItem>
                                                        <SelectItem value="Isapre">Isapre</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="cargasFamiliares" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Cargas</Label>
                                        <Input id="cargasFamiliares" type="number" {...register('cargasFamiliares')} className="h-12 rounded-xl" />
                                    </div>
                                </div>
                            </section>
                        </div>

                        <DialogFooter className="p-8 bg-slate-50 flex flex-col sm:flex-row gap-4 border-t border-slate-100">
                            {canEditRole && (
                                <Button type="button" variant="ghost" onClick={() => setPasswordDialogOpen(true)} className="h-12 rounded-xl px-6 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-primary transition-colors">
                                    <KeyRound className="mr-3 h-4 w-4" /> Restablecer Credenciales
                                </Button>
                            )}
                            <div className="flex gap-4 flex-1 justify-end">
                                <Button type="button" variant="outline" onClick={onClose} className="h-12 px-8 rounded-xl font-black text-[10px] uppercase tracking-widest">Cancelar</Button>
                                <Button type="submit" disabled={isSubmitting} className="h-12 px-10 rounded-xl bg-slate-900 text-white hover:bg-slate-800 font-black text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-slate-900/10">
                                    {isSubmitting ? (
                                        <Loader2 className="mr-3 h-4 w-4 animate-spin text-primary" />
                                    ) : (
                                        <Save className="mr-3 h-4 w-4" />
                                    )}
                                    Efectuar Cambios
                                </Button>
                            </div>
                        </DialogFooter>
                    </form>
                </DialogContent >
            </Dialog >
        </>
    );
}
