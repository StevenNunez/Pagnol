'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle, Camera, ChevronRight, Loader2, AlertCircle, ScanFace, FileImage, Sparkles, X } from 'lucide-react';
import { loadBiometricModels, captureBiometrics } from '@/lib/biometricService';
import { cn } from '@/lib/utils';

type Step = 'loading' | 'invalid' | 'id_front' | 'id_back' | 'face' | 'processing' | 'done' | 'error';

export default function MobileEnrollPage() {
    const { token } = useParams() as { token: string };
    const [step, setStep] = useState<Step>('loading');
    const [session, setSession] = useState<any>(null);
    const [capturedImages, setCapturedImages] = useState<{ idFront: string | null; idBack: string | null; face: string | null }>({ idFront: null, idBack: null, face: null });
    const [biometricTemplate, setBiometricTemplate] = useState<string | null>(null);
    const [processingStatus, setProcessingStatus] = useState('');
    const [processingProgress, setProcessingProgress] = useState(0);
    const [errorMsg, setErrorMsg] = useState('');
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

    const stopCamera = useCallback(() => {
        if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); setCameraStream(null); }
    }, [cameraStream]);

    const startCamera = useCallback(async (facing: 'user' | 'environment') => {
        stopCamera();
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
            setCameraStream(stream);
            if (videoRef.current) videoRef.current.srcObject = stream;
        } catch {
            setErrorMsg('No se pudo acceder a la cámara. Verifica los permisos del navegador.');
            setStep('error');
        }
    }, [stopCamera]);

    useEffect(() => {
        const validate = async () => {
            try {
                const res = await fetch(`/api/enroll/validate?token=${encodeURIComponent(token)}`);
                const json = await res.json();
                if (!json.valid) { setStep('invalid'); return; }
                if (json.session.status === 'completed') { setStep('done'); return; }
                setSession(json.session);
                setStep('id_front');
                await startCamera('environment');
            } catch {
                setStep('invalid');
            }
        };
        validate();
        return () => stopCamera();
    }, [token]);

    const capturePhoto = useCallback(() => {
        if (!videoRef.current || !canvasRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        if (step === 'face') { ctx.scale(-1, 1); ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height); }
        else { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); }
        const imageData = canvas.toDataURL('image/jpeg', 0.85);

        if (step === 'id_front') {
            setCapturedImages(p => ({ ...p, idFront: imageData }));
            setStep('id_back');
        } else if (step === 'id_back') {
            setCapturedImages(p => ({ ...p, idBack: imageData }));
            stopCamera();
            startCamera('user');
            setStep('face');
        } else if (step === 'face') {
            setCapturedImages(p => ({ ...p, face: imageData }));
            stopCamera();
            processFace(imageData);
        }
    }, [step, stopCamera, startCamera]);

    const processFace = async (faceData: string) => {
        setStep('processing');
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
                await saveToSupabase(result.template, faceData);
            } else {
                throw new Error(result.message || 'No se detectó un rostro claro.');
            }
        } catch (e: any) {
            setErrorMsg(e.message || 'Error en el análisis biométrico.');
            setStep('error');
        }
    };

    const saveToSupabase = async (template: string, faceImg: string) => {
        setProcessingStatus('Guardando datos...');
        try {
            const res = await fetch('/api/enroll/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    biometric_template: template,
                    kyc_face_image: faceImg,
                    kyc_id_front: capturedImages.idFront,
                    kyc_id_back: capturedImages.idBack,
                }),
            });
            const json = await res.json();
            if (!res.ok || json.error) { setErrorMsg('Error guardando datos: ' + json.error); setStep('error'); return; }
            setStep('done');
        } catch (e: any) {
            setErrorMsg('Error de red al guardar: ' + e.message);
            setStep('error');
        }
    };

    const subStepInfo: Record<string, { title: string; hint: string; icon: React.ReactNode }> = {
        id_front: { title: 'Frente de tu Cédula', hint: 'Coloca el FRENTE de tu cédula de identidad dentro del recuadro', icon: <FileImage size={20} /> },
        id_back: { title: 'Reverso de tu Cédula', hint: 'Ahora muestra el REVERSO de tu cédula', icon: <FileImage size={20} /> },
        face: { title: 'Tu Selfie Biométrica', hint: 'Mira directo a la cámara, sin lentes ni sombreros', icon: <ScanFace size={20} /> },
    };

    const currentInfo = subStepInfo[step];

    return (
        <div className="min-h-screen bg-slate-950 text-white flex flex-col">
            {/* Header */}
            <div className="px-6 pt-10 pb-6 flex items-center gap-4">
                <div className="w-10 h-10 bg-white/10 rounded-2xl flex items-center justify-center">
                    <ScanFace size={20} className="text-pagnol-orange" />
                </div>
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Pagnol · Verificación</p>
                    <p className="text-sm font-black uppercase tracking-tight">Enrolamiento Biométrico</p>
                </div>
            </div>

            {/* Progress dots */}
            {['id_front', 'id_back', 'face'].includes(step) && (
                <div className="flex items-center gap-2 px-6 pb-4">
                    {['id_front', 'id_back', 'face'].map((s, i) => (
                        <div key={s} className={cn('h-1 rounded-full flex-1 transition-all', step === s ? 'bg-pagnol-orange' : ['id_front', 'id_back', 'face'].indexOf(step) > i ? 'bg-green-500' : 'bg-white/10')} />
                    ))}
                </div>
            )}

            <canvas ref={canvasRef} className="hidden" />

            <div className="flex-1 flex flex-col px-6 pb-10 gap-6">
                {/* LOADING */}
                {step === 'loading' && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-6">
                        <Loader2 size={40} className="animate-spin text-pagnol-orange" />
                        <p className="text-white/50 font-bold text-sm uppercase tracking-widest">Verificando sesión...</p>
                    </div>
                )}

                {/* INVALID */}
                {step === 'invalid' && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center">
                        <div className="w-20 h-20 bg-red-900/30 rounded-3xl flex items-center justify-center"><AlertCircle size={36} className="text-red-400" /></div>
                        <div>
                            <h2 className="text-xl font-black uppercase">Enlace Inválido</h2>
                            <p className="text-white/50 text-sm mt-2">Este QR ha expirado o ya fue utilizado. Solicita uno nuevo al administrador.</p>
                        </div>
                    </div>
                )}

                {/* CAMERA STEPS */}
                {currentInfo && (
                    <>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pagnol-orange flex items-center gap-2">
                                {currentInfo.icon} Paso {['id_front', 'id_back', 'face'].indexOf(step) + 1} de 3
                            </p>
                            <h2 className="text-2xl font-black uppercase mt-1">{currentInfo.title}</h2>
                            <p className="text-white/50 text-sm mt-1">{currentInfo.hint}</p>
                        </div>

                        <div className="relative rounded-[2rem] overflow-hidden bg-black aspect-[3/4] flex-1">
                            <video ref={videoRef} autoPlay playsInline muted className={cn("w-full h-full object-cover", step === 'face' && '[transform:scaleX(-1)]')} />

                            {/* Frame overlay */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className={cn('border-2 border-white/60 relative', step === 'face' ? 'w-52 h-64 rounded-[45%]' : 'w-[80%] h-44 rounded-2xl')}>
                                    <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-pagnol-orange -mt-0.5 -ml-0.5 rounded-tl-lg" />
                                    <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-pagnol-orange -mt-0.5 -mr-0.5 rounded-tr-lg" />
                                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-pagnol-orange -mb-0.5 -ml-0.5 rounded-bl-lg" />
                                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-pagnol-orange -mb-0.5 -mr-0.5 rounded-br-lg" />
                                </div>
                            </div>

                            {/* Capture button */}
                            <div className="absolute bottom-6 inset-x-0 flex justify-center">
                                <button onClick={capturePhoto} className="w-20 h-20 bg-white rounded-full border-4 border-pagnol-orange/50 shadow-2xl flex items-center justify-center active:scale-95 transition-transform">
                                    <Camera className="text-slate-900" size={30} />
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {/* PROCESSING */}
                {step === 'processing' && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-8">
                        <div className="relative w-32 h-32">
                            <div className="absolute inset-0 rounded-full border-4 border-white/10" />
                            <div className="absolute inset-0 rounded-full border-t-4 border-pagnol-orange animate-spin" />
                            {capturedImages.face && <img src={capturedImages.face} className="absolute inset-3 w-26 h-26 object-cover rounded-full opacity-50 [transform:scaleX(-1)]" alt="" />}
                        </div>
                        <div className="w-full max-w-xs space-y-3 text-center">
                            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                <div className="h-full bg-pagnol-orange transition-all duration-700" style={{ width: `${processingProgress}%` }} />
                            </div>
                            <p className="text-sm font-bold text-white/60 uppercase tracking-widest">{processingStatus}</p>
                        </div>
                    </div>
                )}

                {/* DONE */}
                {step === 'done' && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-8 text-center">
                        <div className="relative">
                            <div className="w-28 h-28 bg-green-900/30 rounded-3xl flex items-center justify-center overflow-hidden">
                                {capturedImages.face ? <img src={capturedImages.face} className="w-full h-full object-cover [transform:scaleX(-1)]" alt="" /> : <CheckCircle size={48} className="text-green-400" />}
                            </div>
                            <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-green-500 rounded-full flex items-center justify-center border-4 border-slate-950">
                                <CheckCircle size={18} className="text-white" />
                            </div>
                        </div>
                        <div>
                            <h2 className="text-2xl font-black uppercase text-green-400">¡Verificación Completa!</h2>
                            <p className="text-white/50 text-sm mt-2">Tu identidad ha sido verificada y los datos enviados. Puedes cerrar esta ventana.</p>
                        </div>
                        <div className="flex items-center gap-2 bg-green-900/20 border border-green-500/20 rounded-2xl px-6 py-4 text-green-400 text-xs font-bold uppercase tracking-widest">
                            <Sparkles size={14} /> Biometría Registrada Exitosamente
                        </div>
                    </div>
                )}

                {/* ERROR */}
                {step === 'error' && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center">
                        <div className="w-20 h-20 bg-red-900/30 rounded-3xl flex items-center justify-center"><X size={36} className="text-red-400" /></div>
                        <div>
                            <h2 className="text-xl font-black uppercase text-red-400">Error</h2>
                            <p className="text-white/50 text-sm mt-2">{errorMsg}</p>
                        </div>
                        <button onClick={() => { setStep('id_front'); setErrorMsg(''); startCamera('environment'); }} className="px-8 py-4 bg-pagnol-orange rounded-2xl font-black text-xs uppercase tracking-widest">
                            Intentar de Nuevo
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
