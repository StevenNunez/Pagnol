'use client';

import React, { useMemo, useState } from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    X, Save, Loader2, User as UserIcon, Briefcase, ScanFace, KeyRound,
    ShieldCheck, Mail, Signature, Lock,
} from 'lucide-react';
import { UserIdentityFields } from '@/components/user-identity-fields';
import { UserPermissionsEditor } from '@/components/user-permissions-editor';
import { EnrollmentWizard } from '@/components/enrollment-wizard';
import { AdminChangePasswordDialog } from '@/components/admin/admin-change-password-dialog';
import { ChangePasswordDialog } from '@/components/change-password-dialog';
import { ChangeEmailDialog } from '@/components/change-email-dialog';
import SignaturePad from '@/components/signature-pad';
import { useAssignableRoles } from '@/modules/core/hooks/use-assignable-roles';
import { generateUserInternalId } from '@/modules/core/lib/user-internal-id';
import { ROLES } from '@/modules/core/lib/permissions';
import type { User } from '@/modules/core/lib/data';

const ProfileSchema = z.object({
    name: z.string().min(3, 'El nombre es requerido.'),
    email: z.string().email().or(z.literal('')),
    rut: z.string().optional(),
    role: z.string(),
    internalId: z.string().optional(),
    phone: z.string().optional(),
    cargo: z.string().optional(),
    fechaIngreso: z.string().optional(),
    baseSalary: z.coerce.number().optional(),
    afp: z.string().optional(),
    tipoSalud: z.enum(['Fonasa', 'Isapre']).optional().or(z.literal('')),
    cargasFamiliares: z.coerce.number().optional(),
    address: z.string().optional(),
    birthDate: z.string().optional(),
    emergencyContactName: z.string().optional(),
    emergencyContactPhone: z.string().optional(),
    employmentStatus: z.enum(['active', 'on_leave', 'terminated']).optional(),
});
type ProfileForm = z.infer<typeof ProfileSchema>;

type TabId = 'identidad' | 'contrato' | 'biometria' | 'seguridad' | 'permisos';

interface UserPanelProps {
    user: User;
    isOpen: boolean;
    onClose: () => void;
    /** El usuario actual se edita a sí mismo (Mi Perfil). */
    self?: boolean;
    defaultTab?: TabId;
}

const toDateInput = (d: Date | string | null | undefined) => {
    if (!d) return '';
    const date = new Date(d as any);
    return isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

const labelCls = 'text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1';

/**
 * Panel unificado de usuario (Capa 3). Reúne en un solo diálogo con pestañas todo lo que
 * antes vivía disperso: Identidad, Contrato/RRHH, Biometría, Seguridad y Permisos.
 * Las pestañas se muestran/ocultan según el permiso de quien lo abre.
 */
export function UserPanel({ user, isOpen, onClose, self = false, defaultTab }: UserPanelProps) {
    const { updateUser, enrollUser, hrUpdateUser, addUser, can, users } = useAppState();
    const { user: authUser } = useAuth();
    const { toast } = useToast();
    const assignableRoles = useAssignableRoles();

    const canEditUsers = can('users:edit');
    const canHR = can('hr_employees:edit');
    const canEnroll = can('users:create') || can('pagnol:enroll_personal');
    const canPerms = can('permissions:manage');
    const canEditRole = !self && (authUser?.role === 'super-admin' || (canEditUsers && user.role !== 'super-admin'));
    // Identidad y datos de nómina solo los edita un gestor de usuarios o uno mismo.
    const canEditIdentity = canEditUsers || self;
    const canEditPayroll = canEditUsers || self;
    // Actor de RRHH puro (sin users:edit): guarda por API service-role acotada a RRHH.
    const useHrApi = !self && !canEditUsers && canHR;

    const tabs = useMemo(() => ([
        { id: 'identidad' as const, label: 'Identidad', icon: UserIcon, show: true },
        { id: 'contrato' as const, label: 'Contrato / RRHH', icon: Briefcase, show: canEditUsers || canHR || self },
        { id: 'biometria' as const, label: 'Biometría', icon: ScanFace, show: canEnroll || self },
        { id: 'seguridad' as const, label: 'Seguridad', icon: ShieldCheck, show: canEditUsers || self },
        { id: 'permisos' as const, label: 'Permisos', icon: Lock, show: canPerms && !self },
    ].filter(t => t.show)), [canEditUsers, canHR, canEnroll, canPerms, self]);

    const [activeTab, setActiveTab] = useState<TabId>(defaultTab && tabs.some(t => t.id === defaultTab) ? defaultTab : 'identidad');
    const [enrollOpen, setEnrollOpen] = useState(false);
    const [pwdOpen, setPwdOpen] = useState(false);
    const [emailOpen, setEmailOpen] = useState(false);
    const [savingSig, setSavingSig] = useState(false);
    const sigRef = React.useRef<any>(null);

    const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<ProfileForm>({
        resolver: zodResolver(ProfileSchema),
        defaultValues: {
            name: user.name ?? '',
            email: user.email ?? '',
            rut: user.rut ?? '',
            role: user.role,
            internalId: user.internalId ?? '',
            phone: user.phone ?? '',
            cargo: user.cargo ?? '',
            fechaIngreso: toDateInput(user.fechaIngreso),
            baseSalary: user.baseSalary ?? 0,
            afp: user.afp ?? '',
            tipoSalud: user.tipoSalud ?? '',
            cargasFamiliares: user.cargasFamiliares ?? 0,
            address: user.address ?? '',
            birthDate: toDateInput(user.birthDate),
            emergencyContactName: user.emergencyContactName ?? '',
            emergencyContactPhone: user.emergencyContactPhone ?? '',
            employmentStatus: user.employmentStatus ?? 'active',
        },
    });

    const onSubmit: SubmitHandler<ProfileForm> = async (data) => {
        try {
            if (useHrApi) {
                // RRHH: solo campos de ficha, vía service role (evita el muro RLS de profiles).
                await hrUpdateUser(user.id, {
                    cargo: data.cargo,
                    phone: data.phone,
                    address: data.address,
                    birthDate: data.birthDate || null,
                    emergencyContactName: data.emergencyContactName,
                    emergencyContactPhone: data.emergencyContactPhone,
                    employmentStatus: data.employmentStatus,
                });
            } else {
                const payload: Record<string, any> = {
                    phone: data.phone,
                    cargo: data.cargo,
                    address: data.address,
                    birthDate: data.birthDate || null,
                    emergencyContactName: data.emergencyContactName,
                    emergencyContactPhone: data.emergencyContactPhone,
                    employmentStatus: data.employmentStatus,
                };
                if (canEditIdentity) {
                    payload.name = data.name;
                    payload.rut = data.rut;
                }
                if (canEditPayroll) {
                    payload.fechaIngreso = data.fechaIngreso || null;
                    payload.baseSalary = data.baseSalary;
                    payload.afp = data.afp;
                    payload.tipoSalud = data.tipoSalud || undefined;
                    payload.cargasFamiliares = data.cargasFamiliares;
                }
                if (canEditRole) payload.role = data.role;
                await updateUser(user.id, payload);
            }
            toast({ title: 'Usuario actualizado', description: `Los datos de ${data.name} se guardaron correctamente.` });
            onClose();
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error al guardar', description: err?.message || 'No se pudo actualizar.' });
        }
    };

    const handleSaveSignature = async () => {
        const dataUrl = sigRef.current?.getTrimmedCanvas?.().toDataURL('image/png');
        if (!dataUrl || dataUrl.length < 100) {
            toast({ variant: 'destructive', title: 'Firma vacía', description: 'Dibuja tu firma antes de guardar.' });
            return;
        }
        setSavingSig(true);
        try {
            await updateUser(user.id, { signature: dataUrl });
            toast({ title: 'Firma guardada', description: 'Tu firma digital fue actualizada.' });
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err?.message || 'No se pudo guardar la firma.' });
        } finally {
            setSavingSig(false);
        }
    };

    const showSaveFooter = activeTab === 'identidad' || activeTab === 'contrato';

    return (
        <>
            {enrollOpen && (
                <EnrollmentWizard
                    isOpen={enrollOpen}
                    onClose={() => setEnrollOpen(false)}
                    selectedUser={user}
                    generateInternalId={() => generateUserInternalId(users)}
                    onAddUser={addUser}
                    onEnrollUser={enrollUser}
                    tenantId={authUser?.tenantId || null}
                />
            )}
            {self ? (
                <>
                    <ChangePasswordDialog isOpen={pwdOpen} onClose={() => setPwdOpen(false)} />
                    <ChangeEmailDialog isOpen={emailOpen} onClose={() => setEmailOpen(false)} />
                </>
            ) : (
                <AdminChangePasswordDialog isOpen={pwdOpen} onClose={() => setPwdOpen(false)} userToEdit={user} />
            )}

            <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
                <DialogContent hideClose className="max-w-3xl p-0 border-none bg-transparent overflow-hidden rounded-[2.5rem] shadow-2xl">
                    <div className="flex flex-col bg-card rounded-[2.5rem] overflow-hidden max-h-[90vh]">
                        <DialogHeader className="p-8 industrial-gradient text-white shrink-0 relative">
                            <div className="flex items-center gap-5">
                                <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-xl font-black uppercase shrink-0">
                                    {user.name?.split(' ').map(n => n[0]).join('').slice(0, 2) || 'U'}
                                </div>
                                <div>
                                    <DialogTitle className="text-2xl font-black uppercase tracking-tight leading-none">{user.name}</DialogTitle>
                                    <DialogDescription className="text-white/50 text-[10px] font-black uppercase tracking-[0.2em] mt-1.5">
                                        {user.internalId || 'PAG-PEND'} · {ROLES[user.role]?.label || user.role}
                                    </DialogDescription>
                                </div>
                            </div>
                            <Button onClick={onClose} variant="ghost" size="icon" className="p-2 bg-white/5 rounded-xl text-white/40 hover:text-white absolute top-6 right-6"><X size={20} /></Button>
                        </DialogHeader>

                        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} className="flex flex-col flex-1 min-h-0">
                            <div className="px-6 pt-5 shrink-0">
                                <TabsList className="w-full justify-start gap-1 bg-muted rounded-2xl p-1 h-auto flex-wrap">
                                    {tabs.map(t => (
                                        <TabsTrigger key={t.id} value={t.id} className="rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 px-4 py-2.5 data-[state=active]:bg-card">
                                            <t.icon size={13} /> {t.label}
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </div>

                            <div className="flex-1 overflow-y-auto p-8 min-h-0 custom-scrollbar">
                                {/* IDENTIDAD */}
                                <TabsContent value="identidad" className="mt-0 focus-visible:outline-none">
                                    <UserIdentityFields
                                        register={register}
                                        control={control}
                                        errors={errors}
                                        assignableRoles={assignableRoles}
                                        columns={2}
                                        showPhone
                                        emailReadOnly
                                        readOnlyIdentity={!canEditIdentity}
                                        roleDisabled={!canEditRole}
                                    />
                                    {!canEditRole && (
                                        <p className="text-[9px] font-bold text-muted-foreground mt-3 italic uppercase">El rol y el correo se gestionan aparte.</p>
                                    )}
                                </TabsContent>

                                {/* CONTRATO / RRHH */}
                                <TabsContent value="contrato" className="mt-0 focus-visible:outline-none">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <Field label="Cargo / Puesto"><Input {...register('cargo')} className="h-12 rounded-xl" /></Field>
                                        <Field label="Estado laboral">
                                            <select {...register('employmentStatus')} className="h-12 w-full rounded-xl border bg-background px-3 text-sm">
                                                <option value="active">Activo</option>
                                                <option value="on_leave">Con Licencia/Vacaciones</option>
                                                <option value="terminated">Desvinculado</option>
                                            </select>
                                        </Field>
                                        <Field label="Fecha de nacimiento"><Input type="date" {...register('birthDate')} className="h-12 rounded-xl" /></Field>
                                        <Field label="Dirección" full><Input {...register('address')} className="h-12 rounded-xl" /></Field>
                                        <Field label="Contacto de emergencia"><Input {...register('emergencyContactName')} className="h-12 rounded-xl" /></Field>
                                        <Field label="Teléfono de emergencia"><Input {...register('emergencyContactPhone')} className="h-12 rounded-xl" /></Field>
                                        {canEditPayroll && (
                                            <>
                                                <Field label="Fecha de ingreso"><Input type="date" {...register('fechaIngreso')} className="h-12 rounded-xl" /></Field>
                                                <Field label="Sueldo base ($)"><Input type="number" {...register('baseSalary')} className="h-12 rounded-xl" /></Field>
                                                <Field label="AFP"><Input {...register('afp')} className="h-12 rounded-xl" /></Field>
                                                <Field label="Salud">
                                                    <select {...register('tipoSalud')} className="h-12 w-full rounded-xl border bg-background px-3 text-sm">
                                                        <option value="">—</option>
                                                        <option value="Fonasa">Fonasa</option>
                                                        <option value="Isapre">Isapre</option>
                                                    </select>
                                                </Field>
                                                <Field label="Cargas familiares"><Input type="number" {...register('cargasFamiliares')} className="h-12 rounded-xl" /></Field>
                                            </>
                                        )}
                                    </div>
                                </TabsContent>

                                {/* BIOMETRÍA */}
                                <TabsContent value="biometria" className="mt-0 focus-visible:outline-none">
                                    <div className="flex flex-col items-center text-center gap-6 py-6">
                                        <div className={`w-20 h-20 rounded-3xl flex items-center justify-center ${user.biometric_template ? 'bg-success-subtle text-success' : 'bg-muted text-muted-foreground'}`}>
                                            <ScanFace size={40} />
                                        </div>
                                        <div>
                                            <p className="font-black uppercase tracking-tight text-foreground">
                                                {user.biometric_template ? 'Biometría enrolada' : 'Sin biometría'}
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                                                {user.biometric_template
                                                    ? 'Este usuario ya tiene su rostro y documentos verificados.'
                                                    : 'Captura el rostro y la cédula desde la cámara o el celular del trabajador.'}
                                            </p>
                                        </div>
                                        {canEnroll ? (
                                            <Button onClick={() => setEnrollOpen(true)} className="rounded-xl font-black uppercase text-[10px] tracking-widest h-11 px-8 gap-2">
                                                <ScanFace size={16} /> {user.biometric_template ? 'Re-enrolar biometría' : 'Iniciar enrolamiento'}
                                            </Button>
                                        ) : (
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Sin permiso para enrolar.</p>
                                        )}
                                    </div>
                                </TabsContent>

                                {/* SEGURIDAD */}
                                <TabsContent value="seguridad" className="mt-0 focus-visible:outline-none space-y-6">
                                    <div className="space-y-2">
                                        <Label className={labelCls}>Correo de acceso</Label>
                                        <div className="flex items-center gap-3">
                                            <Input value={user.email} disabled className="h-12 rounded-xl bg-muted flex-1" />
                                            {self && (
                                                <Button variant="outline" onClick={() => setEmailOpen(true)} className="h-12 rounded-xl gap-2 text-[10px] font-black uppercase tracking-widest">
                                                    <Mail size={14} /> Cambiar
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className={labelCls}>Contraseña</Label>
                                        <Button variant="outline" onClick={() => setPwdOpen(true)} className="h-12 rounded-xl gap-2 text-[10px] font-black uppercase tracking-widest w-full justify-start">
                                            <KeyRound size={14} /> {self ? 'Cambiar mi contraseña' : 'Restablecer contraseña'}
                                        </Button>
                                    </div>
                                    {self && (
                                        <div className="space-y-3">
                                            <Label className={labelCls}>Firma digital</Label>
                                            <div className="w-full h-52 bg-muted border-2 border-dashed rounded-[2rem] overflow-hidden">
                                                {user.signature ? (
                                                    <img src={user.signature} alt="Firma" className="w-full h-full object-contain p-4" />
                                                ) : (
                                                    <SignaturePad ref={sigRef} />
                                                )}
                                            </div>
                                            {!user.signature && (
                                                <Button onClick={handleSaveSignature} disabled={savingSig} className="rounded-xl font-black uppercase text-[10px] tracking-widest h-11 px-8 gap-2">
                                                    {savingSig ? <Loader2 size={14} className="animate-spin" /> : <Signature size={14} />} Guardar firma
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </TabsContent>

                                {/* PERMISOS */}
                                <TabsContent value="permisos" className="mt-0 focus-visible:outline-none h-[55vh]">
                                    <UserPermissionsEditor user={user} />
                                </TabsContent>
                            </div>

                            {showSaveFooter && (
                                <div className="p-6 border-t bg-card shrink-0 flex justify-end gap-3">
                                    <Button variant="outline" onClick={onClose} className="rounded-xl font-black uppercase text-[10px] tracking-widest h-11 px-6">Cancelar</Button>
                                    <Button onClick={handleSubmit(onSubmit)} disabled={isSubmitting} className="rounded-xl font-black uppercase text-[10px] tracking-widest h-11 px-8 gap-2 shadow-lg">
                                        {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar cambios
                                    </Button>
                                </div>
                            )}
                        </Tabs>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
    return (
        <div className={full ? 'md:col-span-2 space-y-1.5' : 'space-y-1.5'}>
            <Label className={labelCls}>{label}</Label>
            {children}
        </div>
    );
}
