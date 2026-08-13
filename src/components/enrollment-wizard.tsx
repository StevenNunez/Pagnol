'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import { loadBiometricModels, captureBiometrics } from '@/lib/biometricService';
import { ROLES_ORDER } from '@/modules/core/lib/permissions';
import { useAssignableRoles } from '@/modules/core/hooks/use-assignable-roles';
import { UserIdentityFields } from '@/components/user-identity-fields';
import { User } from '@/modules/core/lib/data';
import {
    X, ChevronRight, ChevronLeft, ScanFace, CheckCircle,
    Camera, Loader2, Smartphone, Monitor, QrCode,
    FileText, User as UserIcon, Sparkles
} from 'lucide-react';
import QRCode from 'react-qr-code';
import { cn } from '@/lib/utils';
import { authHeaders } from '@/modules/core/lib/auth-header';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';

const FormSchema = z.object({
    name: z.string().min(3, 'El nombre es requerido.'),
    rut: z.string().optional(),
    email: z.string().email('El correo no es válido.'),
    password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.').or(z.literal('')),
    internalId: z.string().min(1, 'El ID interno es requerido.'),
    role: z.enum(ROLES_ORDER as [string, ...string[]]),
});

type FormData = z.infer<typeof FormSchema>;

type EnrollmentMode = 'choose' | 'desktop' | 'qr';
type DesktopStep = 'info' | 'document' | 'face' | 'done';

interface EnrollmentWizardProps {
    isOpen: boolean;
    onClose: () => void;
    selectedUser: User | null;
    generateInternalId: () => string;
    onAddUser: (data: any) => Promise<any>;
    onEnrollUser: (id: string, data: any) => Promise<any>;
    tenantId: string | null;
}

export function EnrollmentWizard({
    isOpen,
    onClose,
    selectedUser,
    generateInternalId,
    onAddUser,
    onEnrollUser,
    tenantId,
}: EnrollmentWizardProps) {
    const { toast } = useToast();
    const { user: currentUser } = useAuth();
    const { contracts, shiftSchedules } = useAppState();
    const assignableRoles = useAssignableRoles();

    const [mode, setMode] = useState<EnrollmentMode>('choose');
    const [step, setStep] = useState<DesktopStep>('info');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Contrato/turno al crear (Fase 2 Valar). Solo aplica a trabajadores nuevos:
    // a los existentes se les gestiona desde la pestaña Contrato/RRHH del UserPanel.
    const [contractId, setContractId] = useState('');
    const [shiftScheduleId, setShiftScheduleId] = useState('');
    const [rotationStartDate, setRotationStartDate] = useState(() => new Date().toISOString().slice(0, 10));
    const activeContracts = contracts.filter(c => c.status === 'active');
    const activeClientContracts = activeContracts.filter(c => c.kind !== 'internal');
    const activeInternalAreas = activeContracts.filter(c => c.kind === 'internal');
    // Turno rotativo (no 5x2) = pide fecha de subida (día 1 del ciclo del trabajador).
    const selectedShiftIsRotating = (() => {
        const s = shiftSchedules.find(sh => sh.id === shiftScheduleId);
        return !!s && s.shiftType !== '5x2';
    })();

    // Camera / KYC state
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
    const [capturedImages, setCapturedImages] = useState<{ idFront: string | null; idBack: string | null; face: string | null }>({ idFront: null, idBack: null, face: null });
    const [kycSubStep, setKycSubStep] = useState<'id_front' | 'id_back' | 'face'>('id_front');
    const [biometricTemplate, setBiometricTemplate] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingProgress, setProcessingProgress] = useState(0);
    const [processingStatus, setProcessingStatus] = useState('');

    // QR state
    const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null);
    const [qrPolling, setQrPolling] = useState(false);
    const [qrCompleted, setQrCompleted] = useState(false);

    const { control, register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormData>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            name: selectedUser?.name || '',
            rut: selectedUser?.rut || '',
            email: selectedUser?.email || '',
            password: selectedUser ? 'dummy-password' : '',
            internalId: selectedUser?.internalId || generateInternalId(),
            role: (selectedUser?.role as any) || 'operador',
        }
    });

    // Reset form when user changes or wizard opens
    useEffect(() => {
        if (isOpen) {
            reset({
                name: selectedUser?.name || '',
                rut: selectedUser?.rut || '',
                email: selectedUser?.email || '',
                password: selectedUser ? 'dummy-password' : '',
                internalId: selectedUser?.internalId || generateInternalId(),
                role: (selectedUser?.role as any) || 'operador',
            });
            // New users start at info step; existing users go straight to choose
            setMode(selectedUser ? 'choose' : 'desktop');
            setStep('info');
            setKycSubStep('id_front');
            setEnrollmentToken(null);
            setCapturedImages({ idFront: null, idBack: null, face: null });
            setBiometricTemplate(null);
            setQrCompleted(false);
            setQrPolling(false);
            setContractId('');
            setShiftScheduleId('');
            setRotationStartDate(new Date().toISOString().slice(0, 10));
        }
    }, [isOpen, selectedUser, reset, generateInternalId]);

    const stopCamera = useCallback(() => {
        if (cameraStream) {
            cameraStream.getTracks().forEach(t => t.stop());
            setCameraStream(null);
        }
    }, [cameraStream]);

    const startCamera = useCallback(async (facingMode: 'user' | 'environment' = 'environment') => {
        stopCamera();
        const tryGetStream = async (constraints: MediaStreamConstraints) => {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            setCameraStream(stream);
            if (videoRef.current) videoRef.current.srcObject = stream;
        };
        try {
            await tryGetStream({ video: { facingMode: { ideal: facingMode } } });
        } catch {
            try {
                await tryGetStream({ video: true });
            } catch {
                toast({ variant: 'destructive', title: 'Error de Cámara', description: 'No se pudo acceder a la cámara. Verifica los permisos del navegador.' });
            }
        }
    }, [stopCamera, toast]);

    useEffect(() => {
        if (mode === 'desktop' && step === 'document' && !cameraStream) {
            startCamera(kycSubStep === 'face' ? 'user' : 'environment');
        }
    }, [mode, step, kycSubStep, cameraStream, startCamera]);

    useEffect(() => {
        if (kycSubStep === 'face' && cameraStream) {
            stopCamera();
            startCamera('user');
        }
        // Girar a la cámara frontal SÓLO al entrar al paso de selfie. Declarar
        // `cameraStream`/`startCamera`/`stopCamera` da un bucle garantizado:
        // `startCamera` hace `setCameraStream` → `stopCamera` (que lo captura) cambia
        // de identidad → `startCamera` también → el efecto corre otra vez y la cámara
        // se reinicia sin parar.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kycSubStep]);

    const handleClose = useCallback(() => {
        stopCamera();
        onClose();
    }, [stopCamera, onClose]);

    const capturePhoto = useCallback(() => {
        if (!videoRef.current || !canvasRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = canvas.toDataURL('image/jpeg', 0.8);

        if (kycSubStep === 'id_front') {
            setCapturedImages(p => ({ ...p, idFront: imageData }));
            setKycSubStep('id_back');
            toast({ title: '✅ Frente Capturado', description: 'Ahora muestra el REVERSO.' });
        } else if (kycSubStep === 'id_back') {
            setCapturedImages(p => ({ ...p, idBack: imageData }));
            setKycSubStep('face');
            stopCamera();
            startCamera('user');
            toast({ title: '✅ Reverso Capturado', description: 'Ahora tomate una selfie.' });
        } else if (kycSubStep === 'face') {
            setCapturedImages(p => ({ ...p, face: imageData }));
            stopCamera();
            processFace(imageData);
        }
        // `processFace` es una función suelta (identidad nueva en cada render):
        // declararla haría inútil este `useCallback`. La versión capturada es segura
        // porque no lee estado — la imagen entra por argumento y lo demás son setters
        // más `startCamera`/`toast`, que ya son dependencias de este callback.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kycSubStep, stopCamera, startCamera, toast]);

    const skipDocument = () => {
        setCapturedImages(p => ({ ...p, idFront: 'skip', idBack: 'skip' }));
        setKycSubStep('face');
        stopCamera();
        startCamera('user');
    };

    const processFace = async (faceData: string) => {
        setIsProcessing(true);
        setProcessingProgress(10);
        setProcessingStatus('Cargando modelos de IA...');
        try {
            await loadBiometricModels();
            setProcessingProgress(40);
            setProcessingStatus('Analizando geometría facial...');

            const img = document.createElement('img');
            img.src = faceData;
            await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); });

            setProcessingProgress(70);
            const result = await captureBiometrics(img);
            setProcessingProgress(100);

            if (result.success && result.template) {
                setProcessingStatus('¡Identidad Verificada!');
                setBiometricTemplate(result.template);
                await new Promise(r => setTimeout(r, 800));
                setStep('done');
            } else {
                throw new Error(result.message || 'No se detectó un rostro claro.');
            }
        } catch (e: any) {
            setIsProcessing(false);
            setProcessingProgress(0);
            setKycSubStep('face');
            startCamera('user');
            toast({ variant: 'destructive', title: 'Fallo Biométrico', description: e.message });
        } finally {
            setIsProcessing(false);
        }
    };

    const generateQrToken = async () => {
        const token = crypto.randomUUID();
        setEnrollmentToken(token);

        const formData = watch();
        try {
            // Vía servidor: `enrollment_sessions` guarda el descriptor facial y las
            // fotos de la cédula, así que dejó de ser legible/escribible desde el
            // navegador (migración 20260816010000). El tenant lo pone la ruta a
            // partir de quien enrola, no este cuerpo.
            await fetch('/api/enroll/session', {
                method: 'POST',
                headers: await authHeaders(),
                body: JSON.stringify({
                    token,
                    userId: selectedUser?.id || null,
                    name: formData.name,
                    email: formData.email,
                    rut: formData.rut,
                    role: formData.role,
                    internalId: formData.internalId,
                }),
            });
        } catch (e) {
            console.error("Error creating session:", e);
        }

        setQrPolling(true);
        const pollInterval = setInterval(async () => {
            // Sólo el ESTADO. El descriptor y las fotos de la cédula ya no pasan
            // por el equipo del administrador: van del móvil del trabajador al
            // servidor, y de ahí a la bóveda y a `profile_documents` cuando se
            // envía el formulario (el servidor los toma del `enrollmentToken`).
            let estado: string | null = null;
            try {
                const res = await fetch(`/api/enroll/session?token=${encodeURIComponent(token)}`, {
                    headers: await authHeaders(),
                });
                if (res.ok) estado = (await res.json())?.status ?? null;
            } catch (e) {
                console.error('Error consultando la sesión:', e);
            }

            if (estado === 'completed') {
                clearInterval(pollInterval);
                setQrCompleted(true);
                setQrPolling(false);
                toast({ title: '✅ Enrolamiento Completado', description: 'El trabajador completó su verificación desde el móvil.' });
            }
        }, 3000);

        setTimeout(() => clearInterval(pollInterval), 30 * 60 * 1000);
    };

    const onSubmit: SubmitHandler<FormData> = async (data) => {
        setIsSubmitting(true);
        try {
            // Dos caminos, y sólo el de escritorio lleva datos en el cuerpo:
            //  · Escritorio: el administrador capturó con la cámara del equipo, así
            //    que el descriptor y las fotos ya están acá y se envían.
            //  · QR: nada de eso pasó por este navegador. Se manda el TOKEN y el
            //    servidor lee la sesión que completó el trabajador en su móvil.
            const kycPayload: Record<string, any> = qrCompleted
                ? { enrollmentToken }
                : {
                    biometric_template: biometricTemplate,
                    kyc_face_image: capturedImages.face !== 'skip' ? capturedImages.face : null,
                    kyc_id_front: capturedImages.idFront !== 'skip' ? capturedImages.idFront : null,
                    kyc_id_back: capturedImages.idBack !== 'skip' ? capturedImages.idBack : null,
                };

            if (selectedUser) {
                await onEnrollUser(selectedUser.id, { ...kycPayload, internalId: data.internalId });
                toast({ title: 'Enrolamiento Completado', description: `${selectedUser.name} ha sido certificado exitosamente.` });
            } else {
                const result = await onAddUser({
                    ...data,
                    ...kycPayload,
                    contractId: contractId || null,
                    shiftScheduleId: contractId ? (shiftScheduleId || null) : null,
                    rotationStartDate: contractId && selectedShiftIsRotating ? (rotationStartDate || null) : null,
                });
                if (result?.warning) {
                    toast({ variant: 'destructive', title: 'Atención', description: result.warning });
                }
                toast({ title: 'Trabajador Registrado', description: `${data.name} ha sido agregado al sistema.` });
            }
            handleClose();
        } catch (err: any) {
            const msg = err?.message || JSON.stringify(err) || 'Error desconocido';
            toast({ variant: 'destructive', title: 'Error al Guardar', description: msg });
        } finally {
            setIsSubmitting(false);
        }
    };

    const enrollmentUrl = typeof window !== 'undefined' && enrollmentToken
        ? `${window.location.origin}/enroll/${enrollmentToken}`
        : '';

    const stepLabels = ['Datos', 'Documento', 'Rostro', 'Listo'];
    const stepIndex = step === 'info' ? 0 : step === 'document' ? 1 : step === 'face' ? 2 : 3;

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent hideClose className="max-w-3xl p-0 border-none bg-transparent overflow-hidden rounded-[2.5rem] shadow-2xl">
                <VisuallyHidden>
                    <DialogTitle>{selectedUser ? 'Vincular Biometría' : 'Registrar Personal'}</DialogTitle>
                </VisuallyHidden>
                
                <div className="bg-white rounded-[2.5rem] overflow-hidden flex flex-col max-h-[90vh]">
                    {/* Header */}
                    <div className="industrial-gradient p-8 text-white flex items-center justify-between shrink-0">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/50 mb-1">
                                {selectedUser ? 'Vinculación Biométrica' : 'Registro de Personal'}
                            </p>
                            <h2 className="text-2xl font-black uppercase tracking-tight">
                                {selectedUser ? selectedUser.name : 'Nuevo Trabajador'}
                            </h2>
                        </div>
                        <button onClick={handleClose} className="p-2.5 bg-white/10 rounded-2xl text-white/60 hover:text-white hover:bg-white/20 transition-all">
                            <X size={20} />
                        </button>
                    </div>

                    {/* Step Progress */}
                    {mode === 'desktop' && (
                        <div className="px-8 pt-6 shrink-0">
                            <div className="flex items-center gap-0">
                                {stepLabels.map((label, i) => (
                                    <React.Fragment key={i}>
                                        <div className="flex flex-col items-center gap-1">
                                            <div className={cn(
                                                'w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all',
                                                i < stepIndex ? 'bg-green-500 text-white' :
                                                i === stepIndex ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30' :
                                                'bg-slate-100 text-slate-400'
                                            )}>
                                                {i < stepIndex ? <CheckCircle size={14} /> : i + 1}
                                            </div>
                                            <span className={cn(
                                                'text-[9px] font-black uppercase tracking-widest',
                                                i === stepIndex ? 'text-primary' : 'text-slate-400'
                                            )}>{label}</span>
                                        </div>
                                        {i < stepLabels.length - 1 && (
                                            <div className={cn('flex-1 h-0.5 mb-5 mx-2 transition-all', i < stepIndex ? 'bg-green-400' : 'bg-slate-100')} />
                                        )}
                                    </React.Fragment>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto">
                        {mode === 'choose' && (
                            <div className="p-8 space-y-4">
                                <p className="text-center text-sm text-slate-500 font-medium mb-8">
                                    ¿Cómo deseas realizar el enrolamiento biométrico?
                                </p>
                                <button
                                    onClick={() => setMode('desktop')}
                                    className="w-full flex items-center gap-6 p-6 rounded-[1.5rem] border-2 border-slate-200 hover:border-primary hover:bg-primary/5 transition-all group text-left"
                                >
                                    <div className="w-14 h-14 bg-slate-100 group-hover:bg-primary/10 rounded-2xl flex items-center justify-center text-slate-400 group-hover:text-primary transition-all shrink-0">
                                        <Monitor size={28} />
                                    </div>
                                    <div>
                                        <p className="font-black text-slate-800 text-sm uppercase tracking-tight">Desde este computador</p>
                                        <p className="text-xs text-slate-500 mt-0.5">Usa la cámara web para capturar el documento y el rostro.</p>
                                    </div>
                                    <ChevronRight className="ml-auto text-slate-300 group-hover:text-primary transition-all" />
                                </button>

                                <button
                                    onClick={() => { setMode('qr'); generateQrToken(); }}
                                    className="w-full flex items-center gap-6 p-6 rounded-[1.5rem] border-2 border-slate-200 hover:border-pagnol-orange hover:bg-orange-50 transition-all group text-left"
                                >
                                    <div className="w-14 h-14 bg-slate-100 group-hover:bg-orange-100 rounded-2xl flex items-center justify-center text-slate-400 group-hover:text-pagnol-orange transition-all shrink-0">
                                        <Smartphone size={28} />
                                    </div>
                                    <div>
                                        <p className="font-black text-slate-800 text-sm uppercase tracking-tight">Desde el celular del trabajador</p>
                                        <p className="text-xs text-slate-500 mt-0.5">Genera un QR. El trabajador completa el proceso desde su teléfono.</p>
                                    </div>
                                    <ChevronRight className="ml-auto text-slate-300 group-hover:text-pagnol-orange transition-all" />
                                </button>
                            </div>
                        )}

                        {mode === 'qr' && (
                            <div className="p-8 flex flex-col items-center text-center gap-6">
                                {qrCompleted ? (
                                    <div className="flex flex-col items-center gap-4 py-8">
                                        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
                                            <CheckCircle size={40} className="text-green-500" />
                                        </div>
                                        <h3 className="text-xl font-black text-green-700 uppercase">¡Verificación Completada!</h3>
                                        <p className="text-sm text-slate-500">El trabajador completó su enrolamiento desde el móvil.</p>
                                        <Button onClick={handleSubmit(onSubmit)} disabled={isSubmitting} className="mt-4 px-10 py-5 rounded-2xl bg-primary font-black text-xs uppercase tracking-widest">
                                            {isSubmitting ? <Loader2 className="animate-spin" /> : 'Guardar y Finalizar'}
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="p-6 bg-white rounded-[2rem] border-2 border-slate-100 shadow-xl">
                                            {enrollmentToken ? (
                                                <QRCode value={enrollmentUrl} size={200} fgColor="#0f172a" />
                                            ) : (
                                                <div className="w-[200px] h-[200px] flex items-center justify-center">
                                                    <Loader2 className="animate-spin text-slate-300" size={40} />
                                                </div>
                                            )}
                                        </div>
                                        <div className="space-y-2">
                                            <p className="font-black text-slate-800 uppercase tracking-tight">Escanea con el celular del trabajador</p>
                                            <p className="text-xs text-slate-500 max-w-xs mx-auto">El trabajador tomará una foto de su cédula y una selfie directamente desde su teléfono.</p>
                                        </div>
                                        <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-2xl p-4 text-xs text-blue-600 font-bold">
                                            <Loader2 size={14} className="animate-spin shrink-0" />
                                            Esperando verificación... (el QR caduca en 30 min)
                                        </div>
                                        {enrollmentToken && (
                                            <button
                                                onClick={() => { navigator.clipboard.writeText(enrollmentUrl); toast({ title: 'Enlace copiado' }); }}
                                                className="text-[10px] text-slate-400 hover:text-slate-600 uppercase tracking-widest font-bold flex items-center gap-1"
                                            >
                                                <QrCode size={12} /> Copiar enlace manualmente
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        {mode === 'desktop' && step === 'info' && (
                            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(() => setStep('document'))(); }} className="p-8 space-y-5">
                                <UserIdentityFields
                                    register={register}
                                    control={control}
                                    errors={errors}
                                    assignableRoles={assignableRoles}
                                    columns={2}
                                    showPassword={!selectedUser}
                                    readOnlyIdentity={!!selectedUser}
                                    roleDisabled={!!selectedUser}
                                />
                                {/* Contrato/faena de destino (opcional). Panel de fondo claro fijo:
                                    se fuerza text-slate-900 para que no desaparezca en modo noche. */}
                                {!selectedUser && (
                                    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 space-y-4">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                            Contrato / Área de destino (opcional)
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Contrato / Área</label>
                                                <select
                                                    value={contractId}
                                                    onChange={e => { setContractId(e.target.value); if (!e.target.value) setShiftScheduleId(''); }}
                                                    className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                                                >
                                                    <option value="">Sin asignar</option>
                                                    {activeClientContracts.length > 0 && (
                                                        <optgroup label="Contratos de cliente">
                                                            {activeClientContracts.map(c => (
                                                                <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
                                                            ))}
                                                        </optgroup>
                                                    )}
                                                    {activeInternalAreas.length > 0 && (
                                                        <optgroup label="Áreas internas">
                                                            {activeInternalAreas.map(c => (
                                                                <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
                                                            ))}
                                                        </optgroup>
                                                    )}
                                                </select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Turno</label>
                                                <select
                                                    value={shiftScheduleId}
                                                    onChange={e => setShiftScheduleId(e.target.value)}
                                                    disabled={!contractId}
                                                    className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 disabled:opacity-50"
                                                >
                                                    <option value="">Sin turno definido</option>
                                                    {shiftSchedules.map(s => (
                                                        <option key={s.id} value={s.id}>{s.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            {selectedShiftIsRotating && (
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Inicio de ciclo (fecha de subida)</label>
                                                    <input
                                                        type="date"
                                                        value={rotationStartDate}
                                                        onChange={e => setRotationStartDate(e.target.value)}
                                                        className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                                                    />
                                                    <p className="text-[10px] text-slate-400">Día 1 del ciclo de este trabajador (permite grupos desfasados).</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                <div className="flex justify-between items-center pt-4">
                                    {!selectedUser && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={handleSubmit(() => { setMode('qr'); generateQrToken(); })}
                                            className="h-12 rounded-2xl font-black text-xs uppercase tracking-widest gap-2 border-pagnol-orange/30 text-pagnol-orange hover:bg-orange-50"
                                        >
                                            <Smartphone size={16} /> Usar QR Móvil
                                        </Button>
                                    )}
                                    <Button
                                        type="submit"
                                        className="px-8 h-12 rounded-2xl font-black text-xs uppercase tracking-widest gap-2 ml-auto"
                                    >
                                        Siguiente <ChevronRight size={16} />
                                    </Button>
                                </div>
                            </form>
                        )}

                        {mode === 'desktop' && step === 'document' && (
                            <div className="p-8 space-y-6">
                                <canvas ref={canvasRef} className="hidden" />
                                <div className="flex items-center gap-3">
                                    {(['id_front', 'id_back', 'face'] as const).map((s, i) => {
                                        const labels = ['Frente Cédula', 'Reverso Cédula', 'Selfie'];
                                        const done = (s === 'id_front' && capturedImages.idFront) || (s === 'id_back' && capturedImages.idBack) || (s === 'face' && capturedImages.face);
                                        return (
                                            <div key={s} className={cn(
                                                'flex-1 p-3 rounded-2xl text-center text-[9px] font-black uppercase tracking-widest transition-all',
                                                done ? 'bg-green-50 text-green-600 border border-green-200' :
                                                s === kycSubStep ? 'bg-primary/10 text-primary border border-primary/30' :
                                                'bg-slate-50 text-slate-300 border border-slate-100'
                                            )}>
                                                {done ? '✅ ' : ''}{labels[i]}
                                            </div>
                                        );
                                    })}
                                </div>

                                {!isProcessing && (
                                    <div className="relative rounded-[2rem] overflow-hidden bg-slate-900 aspect-[4/3]">
                                        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                            <div className={cn(
                                                'border-2 border-white/70 relative transition-all duration-500',
                                                kycSubStep === 'face' ? 'w-48 h-60 rounded-[45%]' : 'w-72 h-44 rounded-xl'
                                            )}>
                                                <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-primary -mt-0.5 -ml-0.5 rounded-tl-lg" />
                                                <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-primary -mt-0.5 -mr-0.5 rounded-tr-lg" />
                                                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-primary -mb-0.5 -ml-0.5 rounded-bl-lg" />
                                                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-primary -mb-0.5 -mr-0.5 rounded-br-lg" />
                                            </div>
                                        </div>
                                        <div className="absolute bottom-0 inset-x-0 p-6 bg-gradient-to-t from-black/80 to-transparent">
                                            <p className="text-center text-white/70 text-[10px] font-black uppercase tracking-widest mb-4 animate-pulse">
                                                {kycSubStep === 'id_front' && 'Coloca el FRENTE de la cédula dentro del recuadro'}
                                                {kycSubStep === 'id_back' && 'Coloca el REVERSO de la cédula dentro del recuadro'}
                                                {kycSubStep === 'face' && 'Mira directo a la cámara'}
                                            </p>
                                            <div className="flex justify-center gap-3">
                                                <button onClick={capturePhoto} className="w-16 h-16 bg-white rounded-full border-4 border-slate-200 hover:scale-110 hover:border-primary transition-all shadow-xl flex items-center justify-center">
                                                    <Camera className="text-slate-700" size={22} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {isProcessing && (
                                    <div className="flex flex-col items-center justify-center gap-6 py-12 bg-slate-50 rounded-[2rem]">
                                        <div className="relative w-24 h-24">
                                            <div className="absolute inset-0 rounded-full border-4 border-slate-200" />
                                            <div className="absolute inset-0 rounded-full border-t-4 border-primary animate-spin" />
                                            {capturedImages.face && (
                                                <img src={capturedImages.face} className="absolute inset-2 w-20 h-20 object-cover rounded-full opacity-40 grayscale" alt="" />
                                            )}
                                        </div>
                                        <div className="w-full max-w-xs space-y-2 text-center">
                                            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                                <div className="h-full bg-primary transition-all duration-500" style={{ width: `${processingProgress}%` }} />
                                            </div>
                                            <p className="text-xs font-bold text-slate-600">{processingStatus}</p>
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-center justify-between">
                                    <button onClick={skipDocument} className="text-[10px] text-slate-400 hover:text-slate-600 font-bold uppercase tracking-widest transition-colors">
                                        Saltar documento → solo selfie
                                    </button>
                                    <Button variant="ghost" onClick={() => setStep('info')} className="text-slate-400 gap-1 text-xs">
                                        <ChevronLeft size={14} /> Volver
                                    </Button>
                                </div>
                            </div>
                        )}

                        {mode === 'desktop' && step === 'done' && (
                            <div className="p-8 flex flex-col items-center text-center gap-6">
                                <div className="relative">
                                    <div className="w-28 h-28 bg-green-50 rounded-3xl flex items-center justify-center overflow-hidden border-4 border-white shadow-xl">
                                        {capturedImages.face && capturedImages.face !== 'skip' ? (
                                            <img src={capturedImages.face} className="w-full h-full object-cover" alt="" />
                                        ) : (
                                            <UserIcon size={48} className="text-green-400" />
                                        )}
                                    </div>
                                    <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-green-500 rounded-full flex items-center justify-center border-4 border-white shadow">
                                        <CheckCircle size={18} className="text-white" />
                                    </div>
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-green-700 uppercase tracking-tight">Identidad Verificada</h3>
                                    <p className="text-[10px] text-green-600/60 font-black uppercase tracking-widest mt-1">Biometría Procesada · Lista para Guardar</p>
                                </div>

                                <div className="grid grid-cols-3 gap-3 w-full">
                                    {[
                                        { label: 'Cédula Frente', ok: !!(capturedImages.idFront && capturedImages.idFront !== 'skip') },
                                        { label: 'Cédula Reverso', ok: !!(capturedImages.idBack && capturedImages.idBack !== 'skip') },
                                        { label: 'Selfie Biométrica', ok: !!(capturedImages.face) },
                                    ].map(item => (
                                        <div key={item.label} className={cn('p-3 rounded-2xl text-center text-[9px] font-black uppercase tracking-wider', item.ok ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-400')}>
                                            {item.ok ? '✅' : '⚠️'} {item.label}
                                        </div>
                                    ))}
                                </div>

                                <Button onClick={handleSubmit(onSubmit)} disabled={isSubmitting} className="w-full h-14 rounded-2xl bg-slate-900 text-white font-black text-[10px] uppercase tracking-[0.2em] gap-2 shadow-xl">
                                    {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                                    Confirmar y Guardar Enrolamiento
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
