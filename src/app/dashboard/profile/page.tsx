
"use client";

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import { PageHeader } from '@/components/page-header';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Loader2,
    QrCode,
    KeyRound,
    AtSign,
    Edit,
    Phone,
    Briefcase,
    CalendarDays,
    Building2,
    HeartPulse,
    Users,
    Signature,
    Save
} from 'lucide-react';
import QRCode from "react-qr-code";
import { ChangePasswordDialog } from '@/components/change-password-dialog';
import { ChangeEmailDialog } from '@/components/change-email-dialog';
import { EditUserForm } from '@/components/admin/edit-user-form';
import { UserRole } from '@/modules/core/lib/data';
import { ROLES } from '@/modules/core/lib/permissions';
import SignaturePad from '@/components/signature-pad';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';

// --- Utility Functions ---

const getRoleDisplayName = (role: UserRole | undefined): string => {
    if (!role) return 'Rol no asignado';
    return ROLES[role]?.label || role;
};

const formatDate = (date: Date | string | number | null | undefined): string => {
    if (!date) return 'No especificada';

    try {
        const jsDate = new Date(date as any);

        if (isNaN(jsDate.getTime())) return 'Fecha inválida';

        return new Intl.DateTimeFormat('es-CL', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }).format(jsDate);
    } catch (error) {
        console.error("Error formateando fecha:", error);
        return 'Error en fecha';
    }
}

// --- Sub-components (para reducir repetición) ---

interface InfoFieldProps {
    label: string;
    value: string | number | null | undefined;
    icon?: React.ElementType;
}

const InfoField = ({ label, value, icon: Icon }: InfoFieldProps) => (
    <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 text-primary/70" />}
            {label}
        </p>
        <p className="font-medium text-foreground">
            {value || <span className="text-muted-foreground italic text-sm">No especificado</span>}
        </p>
    </div>
);

// --- Main Component ---

export default function ProfilePage() {
    const { user: authUser, authLoading } = useAuth();
    const { users, updateUser } = useAppState();
    const { toast } = useToast();

    // Sincronizar con los datos en tiempo real de DataProvider si el usuario autenticado está en la lista
    const user = useMemo(() => {
        if (!authUser) return null;
        return users.find(u => u.id === authUser.id) || authUser;
    }, [authUser, users]);

    const signaturePadRef = useRef<any>(null);
    // Initialize signature from user if available
    const [signature, setSignature] = useState<string | null>(user?.signature || null);
    const [isSavingSignature, setIsSavingSignature] = useState(false);

    const [isPasswordDialogOpen, setPasswordDialogOpen] = useState(false);
    const [isEmailDialogOpen, setEmailDialogOpen] = useState(false);
    const [isEditingUser, setIsEditingUser] = useState(false);

    // Sync signature if it changes in global state
    useEffect(() => {
        if (user?.signature && !signature) {
            setSignature(user.signature);
        }
    }, [user?.signature, signature]);

    const roleName = useMemo(() => getRoleDisplayName(user?.role), [user?.role]);
    const formattedDate = useMemo(() => formatDate(user?.fechaIngreso), [user?.fechaIngreso]);

    const handleSaveSignature = async () => {
        if (!signaturePadRef.current) {
            toast({ variant: 'destructive', title: 'Error', description: 'El componente de firma no está listo.' });
            return;
        }

        const newSignatureDataUrl = signaturePadRef.current.getTrimmedCanvas().toDataURL('image/png');
        if (!newSignatureDataUrl || newSignatureDataUrl.length < 100) { // Simple check for empty canvas
            toast({ variant: 'destructive', title: 'Firma Vacía', description: 'Por favor, dibuja tu firma antes de guardar.' });
            return;
        }

        if (!user) return;

        setIsSavingSignature(true);
        try {
            await updateUser(user.id, { signature: newSignatureDataUrl });
            setSignature(newSignatureDataUrl); // Actualiza el estado local para mostrar la nueva firma
            toast({ title: 'Firma Guardada', description: 'Tu firma digital ha sido actualizada.' });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo guardar la firma.' });
        } finally {
            setIsSavingSignature(false);
        }
    };

    const clearSignature = () => {
        signaturePadRef.current?.clear();
        setSignature(null);
    };

    // Si no hay usuario y no se está cargando, mostrar error
    if (!user && !authLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
                <p className="text-muted-foreground">No se pudo cargar la información del usuario.</p>
                <Button variant="outline" onClick={() => window.location.reload()}>Reintentar</Button>
            </div>
        );
    }

    // Si aún está cargando la autenticación inicial pesada y no tenemos ni el authUser, mostrar spinner
    if (authLoading && !authUser) {
        return (
            <div className="flex items-center justify-center h-[50vh]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            {/* Dialogs */}
            <ChangePasswordDialog
                isOpen={isPasswordDialogOpen}
                onClose={() => setPasswordDialogOpen(false)}
            />
            <ChangeEmailDialog
                isOpen={isEmailDialogOpen}
                onClose={() => setEmailDialogOpen(false)}
            />

            {isEditingUser && user && (
                <EditUserForm
                    user={user}
                    isOpen={isEditingUser}
                    onClose={() => setIsEditingUser(false)}
                />
            )}

            <PageHeader
                title="Mi Perfil"
                description="Gestión centralizada de su identidad digital y credenciales operativas."
            />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                {/* Columna Izquierda - QR y Cuenta */}
                <div className="lg:col-span-4 space-y-10">
                    {/* Tarjeta de Credencial Premium */}
                    <Card className="overflow-hidden border-none shadow-3xl bg-card rounded-[3rem]">
                        <div className="h-32 industrial-gradient flex items-end justify-center pb-6">
                            <div className="w-24 h-24 rounded-3xl bg-card border-4 border-card shadow-2xl flex items-center justify-center text-3xl font-black text-primary uppercase">
                                {user?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                            </div>
                        </div>
                        <CardContent className="flex flex-col items-center justify-center text-center pt-16 pb-12 px-8">
                            <div className="p-4 bg-slate-50 rounded-[2rem] shadow-inner border border-slate-100 mb-8 transform hover:scale-105 transition-transform duration-500">
                                <QRCode
                                    value={user!.qrCode || user!.id}
                                    size={180}
                                    level="H"
                                    fgColor="#1e293b"
                                />
                            </div>
                            <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">{user!.name}</h3>
                            <Badge variant="outline" className="mt-3 px-4 py-1 text-[10px] font-black uppercase tracking-[0.2em] border-primary/20 text-primary bg-primary/5 rounded-full">
                                {roleName}
                            </Badge>
                            <p className="mt-4 text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                                ID INTERNO: {user!.internalId || 'PAG-EMP-PEND'}
                            </p>
                        </CardContent>
                    </Card>

                    {/* Tarjeta de Seguridad Premium */}
                    <Card className="rounded-[2.5rem] border-none shadow-xl bg-card">
                        <CardHeader className="p-8 pb-4">
                            <CardTitle className="text-base font-black uppercase tracking-tight flex items-center gap-3">
                                <div className="p-2 bg-primary/10 rounded-xl text-primary"><KeyRound size={18} /></div>
                                Seguridad Operativa
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-8 pt-4 space-y-6">
                            <div className="space-y-2">
                                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">E-mail de Acceso</p>
                                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 group hover:border-primary/20 transition-all">
                                    <span className="text-sm font-bold text-slate-600 truncate">{user!.email}</span>
                                    <AtSign className="h-4 w-4 text-slate-300 group-hover:text-primary transition-colors" />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                                <Button
                                    variant="outline"
                                    className="h-12 rounded-xl justify-start hover:bg-primary/5 border-slate-200 font-bold text-xs uppercase tracking-widest"
                                    onClick={() => setEmailDialogOpen(true)}
                                >
                                    <Edit className="mr-3 h-4 w-4 text-primary" />
                                    Cambiar Correo
                                </Button>
                                <Button
                                    variant="outline"
                                    className="h-12 rounded-xl justify-start hover:bg-primary/5 border-slate-200 font-bold text-xs uppercase tracking-widest"
                                    onClick={() => setPasswordDialogOpen(true)}
                                >
                                    <KeyRound className="mr-3 h-4 w-4 text-primary" />
                                    Nueva Contraseña
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Columna Derecha - Información y Firma */}
                <div className="lg:col-span-8 space-y-10">
                    <Card className="rounded-[3rem] border-none shadow-xl bg-card overflow-hidden">
                        <CardHeader className="p-10 border-b bg-slate-50/50">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                                <div>
                                    <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                                        <div className="p-2 bg-primary/10 rounded-xl text-primary"><Briefcase size={20} /></div>
                                        Ficha del Colaborador
                                    </CardTitle>
                                    <CardDescription className="mt-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                                        Datos contractuales y registros de recursos humanos.
                                    </CardDescription>
                                </div>
                                <Button onClick={() => setIsEditingUser(true)} className="h-12 px-8 rounded-2xl bg-primary hover:scale-105 transition-transform font-black text-[10px] uppercase tracking-[0.15em] shadow-lg shadow-primary/20">
                                    <Edit className="mr-2 h-4 w-4" />
                                    Actualizar Datos
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="p-10">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
                                <div className="space-y-6">
                                    <InfoField label="RUT / IDENTIFICACIÓN" value={user!.rut} icon={Users} />
                                    <InfoField label="TELÉFONO DE CONTACTO" value={user!.phone} icon={Phone} />
                                    <InfoField label="CARGO ACTUAL" value={user!.cargo} icon={Briefcase} />
                                    <InfoField label="FECHA DE INGRESO" value={formattedDate} icon={CalendarDays} />
                                </div>
                                <div className="space-y-6">
                                    <InfoField label="ADMINISTRADORA DE FONDOS (AFP)" value={user!.afp} icon={Building2} />
                                    <InfoField label="SISTEMA DE PREVISIÓN (SALUD)" value={user!.tipoSalud} icon={HeartPulse} />
                                    <InfoField label="CARGAS FAMILIARES" value={user!.cargasFamiliares?.toString()} icon={Users} />
                                    <div className="pt-4 border-t border-dashed">
                                        <div className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" /> Estado de Cuenta
                                        </div>
                                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none px-4 py-1.5 rounded-xl font-black text-[9px] uppercase tracking-widest">
                                            ACTIVO / VIGENTE
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Tarjeta de Firma Digital Premium */}
                    <Card className="rounded-[3rem] border-none shadow-xl bg-card overflow-hidden">
                        <CardHeader className="p-10">
                            <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                                <div className="p-2 bg-primary/10 rounded-xl text-primary"><Signature size={20} /></div>
                                Firma Digital Hológrafa
                            </CardTitle>
                            <CardDescription className="mt-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                                Requerida para la validación de contratos de responsabilidad y entrega de activos.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-10 pt-0 space-y-8">
                            <div className="w-full h-64 bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2.5rem] relative flex items-center justify-center overflow-hidden group">
                                {signature ? (
                                    <div className="w-full h-full relative p-8">
                                        <Image src={signature} layout="fill" alt="Firma guardada" className="object-contain filter contrast-125" />
                                        <div className="absolute inset-x-0 bottom-0 py-4 bg-slate-900/5 backdrop-blur-sm transform translate-y-full group-hover:translate-y-0 transition-transform flex justify-center gap-4">
                                            <Button variant="ghost" size="sm" onClick={clearSignature} className="text-slate-600 font-bold uppercase text-[9px]">Eliminar y volver a firmar</Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="w-full h-full">
                                        <SignaturePad ref={signaturePadRef} />
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-col sm:flex-row gap-4">
                                <Button variant="outline" onClick={clearSignature} disabled={isSavingSignature} className="h-14 px-8 rounded-2xl font-black text-[10px] uppercase tracking-widest border-slate-200">
                                    Limpiar Pizarra
                                </Button>
                                <Button onClick={handleSaveSignature} disabled={isSavingSignature} className="h-14 px-10 flex-1 rounded-2xl bg-slate-900 text-white hover:bg-slate-800 font-black text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-slate-900/20">
                                    {isSavingSignature ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Registrar Firma en Pagnol
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
