"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ScanFace, CheckCircle2, XCircle, Loader2, AlertCircle,
  Play, Square, Users, Zap, ShieldCheck, Camera,
} from "lucide-react";
import { loadBiometricModels, searchIdentity1N } from "@/lib/biometricService";
import { useToast } from "@/modules/core/hooks/use-toast";

type ScanStatus = "idle" | "loading_models" | "scanning" | "match" | "no_match" | "no_face" | "error";

interface MatchResult {
  userId: string;
  name: string;
  internalId?: string;
  distance: number;
  confidence: number;
}

const BiometricVerificationPage: React.FC = () => {
  const { users } = useAppState();
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const enrolledUsers = (users || []).filter(u => u.biometric_template);

  const stopCamera = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      setCameraStream(null);
      if (videoRef.current) videoRef.current.srcObject = null;
    }
    setStatus("idle");
    setMatchResult(null);
  }, [cameraStream]);

  const startScanning = useCallback(async () => {
    setStatus("loading_models");
    try {
      await loadBiometricModels();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudieron cargar los modelos de IA biométrica." });
      setStatus("error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      setCameraStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
      setStatus("scanning");
    } catch {
      toast({ variant: "destructive", title: "Cámara no disponible", description: "Verifica que la cámara esté conectada y con permisos." });
      setStatus("error");
    }
  }, [toast]);

  useEffect(() => {
    if (status !== "scanning" || !cameraStream || !videoRef.current) return;

    intervalRef.current = setInterval(async () => {
      if (!videoRef.current) return;
      setScanCount(p => p + 1);

      const result = await searchIdentity1N(videoRef.current, enrolledUsers);

      if (result.success && result.userId) {
        const user = enrolledUsers.find(u => u.id === result.userId);
        if (user) {
          const confidence = Math.round((1 - (result.distance ?? 0.5)) * 100 + 50);
          setMatchResult({
            userId: result.userId,
            name: user.name,
            internalId: user.internalId,
            distance: result.distance ?? 0,
            confidence: Math.min(confidence, 99),
          });
          setMatchCount(p => p + 1);
          setStatus("match");
        }
      } else if (result.success === false && result.userId === undefined) {
        setStatus("no_face");
        setMatchResult(null);
      } else {
        setStatus("no_match");
        setMatchResult(null);
      }

      await new Promise(r => setTimeout(r, 500));
      if (status === "scanning" || status === "match" || status === "no_match" || status === "no_face") {
        setStatus("scanning");
      }
    }, 1800);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [status, cameraStream, enrolledUsers]);

  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  useEffect(() => () => stopCamera(), []);

  const statusConfig = {
    idle: { color: "bg-slate-100 text-muted-foreground", label: "Inactivo", icon: Camera },
    loading_models: { color: "bg-blue-100 text-blue-600", label: "Cargando IA...", icon: Loader2 },
    scanning: { color: "bg-orange-100 text-orange-600", label: "Escaneando...", icon: ScanFace },
    match: { color: "bg-green-100 text-green-600", label: "Coincidencia!", icon: CheckCircle2 },
    no_match: { color: "bg-red-100 text-red-600", label: "No Reconocido", icon: XCircle },
    no_face: { color: "bg-slate-100 text-muted-foreground", label: "Sin Rostro", icon: AlertCircle },
    error: { color: "bg-red-100 text-red-600", label: "Error", icon: AlertCircle },
  };

  const current = statusConfig[status];
  const Icon = current.icon;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Estación de Verificación Biométrica"
        description="Prueba en vivo del sistema de reconocimiento facial. Ideal para verificar enrolamientos antes de iniciar turno."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-blue-50 to-indigo-50">
          <CardContent className="p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-2">Personal Enrolado</p>
                <p className="text-4xl font-black text-blue-600">{enrolledUsers.length}</p>
              </div>
              <Users className="h-12 w-12 text-blue-600 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-orange-50 to-amber-50">
          <CardContent className="p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-2">Escaneos Realizados</p>
                <p className="text-4xl font-black text-orange-600">{scanCount}</p>
              </div>
              <Zap className="h-12 w-12 text-orange-600 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-green-50 to-emerald-50">
          <CardContent className="p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-2">Identificaciones OK</p>
                <p className="text-4xl font-black text-green-600">{matchCount}</p>
              </div>
              <ShieldCheck className="h-12 w-12 text-green-600 opacity-20" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Camera Feed */}
        <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-100 overflow-hidden">
          <CardHeader className="p-8 pb-4">
            <CardTitle className="text-xl font-black uppercase flex items-center gap-3">
              <ScanFace className="h-5 w-5 text-primary" />
              Feed en Vivo
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8 pt-2 space-y-6">
            <div className="relative aspect-square rounded-[2rem] overflow-hidden bg-slate-900">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {!cameraStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <ScanFace size={64} className="text-slate-600" />
                  <p className="text-muted-foreground text-xs font-black uppercase tracking-widest">Cámara Inactiva</p>
                </div>
              )}
              {cameraStream && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className={`w-40 h-52 border-4 rounded-[45%] transition-all duration-300 ${
                    status === "match" ? "border-green-400 shadow-[0_0_30px_rgba(74,222,128,0.5)]" :
                    status === "no_match" ? "border-red-400" :
                    "border-white/50 animate-pulse"
                  }`} />
                </div>
              )}
              {cameraStream && (
                <div className="absolute top-4 left-4">
                  <Badge className={`${current.color} border-none font-black text-[10px] uppercase flex items-center gap-1.5`}>
                    {(status === "scanning" || status === "loading_models") && <Loader2 size={12} className="animate-spin" />}
                    {status === "match" && <CheckCircle2 size={12} />}
                    {(status === "no_match" || status === "error") && <XCircle size={12} />}
                    {current.label}
                  </Badge>
                </div>
              )}
            </div>

            <div className="flex gap-4">
              {!cameraStream ? (
                <Button
                  onClick={startScanning}
                  className="flex-1 h-12 rounded-xl bg-primary font-black uppercase tracking-widest text-xs gap-2"
                  disabled={status === "loading_models"}
                >
                  {status === "loading_models" ? (
                    <><Loader2 size={16} className="animate-spin" /> Cargando modelos...</>
                  ) : (
                    <><Play size={16} /> Iniciar Escáner</>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={stopCamera}
                  variant="outline"
                  className="flex-1 h-12 rounded-xl border-red-200 text-red-600 hover:bg-red-50 font-black uppercase tracking-widest text-xs gap-2"
                >
                  <Square size={16} /> Detener Escáner
                </Button>
              )}
            </div>

            {enrolledUsers.length === 0 && (
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3 items-center">
                <AlertCircle size={16} className="text-amber-600 shrink-0" />
                <p className="text-[10px] font-bold text-amber-700 uppercase">
                  No hay personal enrolado. Registra empleados en la sección Personal.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Result Panel */}
        <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-100">
          <CardHeader className="p-8 pb-4">
            <CardTitle className="text-xl font-black uppercase flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Resultado de Identificación
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8 pt-2 space-y-6">
            {!matchResult && (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center">
                  <ScanFace size={36} className="text-slate-300" />
                </div>
                <p className="text-muted-foreground font-black uppercase tracking-widest text-xs">
                  {cameraStream ? "Buscando rostro en tiempo real..." : "Inicia el escáner para identificar personal"}
                </p>
              </div>
            )}

            {matchResult && (
              <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
                <div className="p-6 bg-green-50 rounded-[2rem] border border-green-100 flex items-center gap-5">
                  <div className="w-16 h-16 bg-green-500 rounded-2xl flex items-center justify-center text-white text-xl font-black shrink-0">
                    {matchResult.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-green-600 uppercase tracking-widest mb-1">Identidad Confirmada</p>
                    <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight leading-tight">{matchResult.name}</h3>
                    {matchResult.internalId && (
                      <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{matchResult.internalId}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs font-black text-muted-foreground uppercase">
                    <span>Confianza del Sistema</span>
                    <span className="text-green-600">{matchResult.confidence}%</span>
                  </div>
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all duration-500"
                      style={{ width: `${matchResult.confidence}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-[9px] font-bold text-muted-foreground uppercase">
                    <span>Umbral mínimo: 50%</span>
                    <span>Distancia euclidiana: {matchResult.distance.toFixed(3)}</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex gap-3">
                  <CheckCircle2 size={16} className="text-green-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] font-bold text-slate-600 uppercase leading-relaxed">
                    Trabajador habilitado para operar en el sistema Pagnol. Biometría válida.
                  </p>
                </div>
              </div>
            )}

            {/* Enrolled users list */}
            <div className="space-y-2">
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Personal con Biometría Activa</p>
              <div className="max-h-48 overflow-y-auto space-y-1 no-scrollbar">
                {enrolledUsers.map(u => (
                  <div key={u.id} className={`flex items-center gap-3 p-3 rounded-xl transition-all ${matchResult?.userId === u.id ? 'bg-green-50 border border-green-200' : 'bg-slate-50'}`}>
                    <div className="w-7 h-7 bg-slate-200 rounded-lg flex items-center justify-center text-[9px] font-black text-slate-600 shrink-0">
                      {u.name.substring(0, 2).toUpperCase()}
                    </div>
                    <span className="text-[10px] font-bold text-slate-700 uppercase flex-1 truncate">{u.name}</span>
                    {matchResult?.userId === u.id && <CheckCircle2 size={14} className="text-green-500 shrink-0" />}
                  </div>
                ))}
                {enrolledUsers.length === 0 && (
                  <p className="text-[10px] text-muted-foreground text-center py-4 font-bold">Sin personal enrolado</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Info */}
      <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <CardContent className="p-8 sm:p-12">
          <h3 className="text-lg font-black uppercase mb-6">Cómo usar esta estación</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm text-slate-300">
            <div className="space-y-2">
              <p className="font-black text-white text-[10px] uppercase tracking-widest">Antes del Turno</p>
              <p>Verifica que tu enrolamiento biométrico esté activo antes de comenzar operaciones con activos.</p>
            </div>
            <div className="space-y-2">
              <p className="font-black text-white text-[10px] uppercase tracking-widest">Prueba de Hardware</p>
              <p>Confirma que la cámara del equipo funciona correctamente y que el sistema reconoce a los operarios.</p>
            </div>
            <div className="space-y-2">
              <p className="font-black text-white text-[10px] uppercase tracking-widest">Confianza {">"}70%</p>
              <p>Una confianza sobre 70% garantiza reconocimiento fluido en movimientos de despacho y devolución.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BiometricVerificationPage;
