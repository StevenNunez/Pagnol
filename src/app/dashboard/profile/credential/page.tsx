"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/modules/core/contexts/app-provider';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Download, ArrowLeft, ShieldCheck, Building2, QrCode,
    Camera, RefreshCw, Shield, Clock, MapPin, AlertTriangle,
} from 'lucide-react';
import QRCode from "react-qr-code";
import Link from 'next/link';
import { supabase } from '@/modules/core/lib/supabase';
import { formatDistance } from '@/lib/geo';
import { PageHeader } from '@/components/page-header';

const TOKEN_LIFETIME = 120;

type GeoState =
    | { status: 'idle' }
    | { status: 'locating' }
    | { status: 'verified'; coords: GeolocationCoordinates }
    | { status: 'not_configured'; coords: GeolocationCoordinates }
    | { status: 'outside'; distanceM: number; radiusM: number }
    | { status: 'gps_denied' }
    | { status: 'gps_error'; message: string };

export default function DigitalCredentialPage() {
    const { user } = useAuth();

    const [qrValue, setQrValue]         = useState<string | null>(null);
    const [secondsLeft, setSecondsLeft] = useState(TOKEN_LIFETIME);
    const [loading, setLoading]         = useState(true);
    const [geoState, setGeoState]       = useState<GeoState>({ status: 'idle' });
    const [faceImage, setFaceImage]     = useState<string | null>(null);

    // La foto KYC ya no viaja en el perfil; se carga desde profile_documents
    // (RLS: solo el dueño la puede leer).
    useEffect(() => {
        if (!user?.id) return;
        supabase
            .from('profile_documents')
            .select('kyc_face_image')
            .eq('profile_id', user.id)
            .maybeSingle()
            .then(({ data }) => setFaceImage(data?.kyc_face_image ?? null));
    }, [user?.id]);

    const getCoords = (): Promise<GeolocationCoordinates> =>
        new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('GPS no disponible en este dispositivo.'));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                pos => resolve(pos.coords),
                err => reject(err),
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
            );
        });

    const fetchToken = useCallback(async () => {
        setLoading(true);
        setGeoState({ status: 'locating' });

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Sin sesión activa');

            let coords: GeolocationCoordinates | null = null;
            try {
                coords = await getCoords();
            } catch (geoErr: any) {
                if (geoErr?.code === 1) {
                    // PERMISSION_DENIED
                    setGeoState({ status: 'gps_denied' });
                    setLoading(false);
                    return;
                }
                // GPS timeout / unavailable — igual intentamos (servidor decidirá)
                setGeoState({ status: 'gps_error', message: 'No se pudo obtener GPS.' });
            }

            const body = coords
                ? { latitude: coords.latitude, longitude: coords.longitude }
                : {};

            const res = await fetch('/api/qr/token', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const data = await res.json();
                if (data.error === 'OUTSIDE_GEOFENCE') {
                    setGeoState({ status: 'outside', distanceM: data.distance_m, radiusM: data.radius_m });
                } else if (data.error === 'GPS_REQUIRED') {
                    setGeoState({ status: 'gps_denied' });
                } else {
                    setGeoState({ status: 'gps_error', message: data.message ?? 'Error al generar QR.' });
                }
                setLoading(false);
                return;
            }

            const data = await res.json();
            setQrValue(data.qr_value);
            setSecondsLeft(data.expires_in ?? TOKEN_LIFETIME);

            if (coords) {
                setGeoState(
                    data.geo_status === 'verified'
                        ? { status: 'verified', coords }
                        : { status: 'not_configured', coords }
                );
            }
        } catch (e: any) {
            setGeoState({ status: 'gps_error', message: e.message ?? 'Error desconocido' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchToken(); }, [fetchToken]);

    // Countdown + auto-refresh
    useEffect(() => {
        if (!qrValue || loading) return;
        const interval = setInterval(() => {
            setSecondsLeft(prev => {
                if (prev <= 1) { fetchToken(); return TOKEN_LIFETIME; }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [qrValue, loading, fetchToken]);

    const progressPct = Math.round((secondsLeft / TOKEN_LIFETIME) * 100);
    const isUrgent    = secondsLeft <= 20;

    const geoBlocked =
        geoState.status === 'outside' ||
        geoState.status === 'gps_denied' ||
        geoState.status === 'gps_error';

    return (
        <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20 p-4">
            <PageHeader title="Mi Credencial" description="Credencial QR personal" />
            {/* Header */}
            <div className="flex items-center justify-between">
                <Button variant="ghost" asChild className="text-muted-foreground hover:text-pagnol-orange transition-colors">
                    <Link href="/dashboard" className="flex items-center gap-2">
                        <ArrowLeft size={16} /> Volver al inicio
                    </Link>
                </Button>
                <div className="text-right">
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest leading-none">Identidad Digital</p>
                    <p className="text-sm font-bold text-pagnol-orange">Ecosistema Pagnol</p>
                </div>
            </div>

            {/* Alerta de ubicación — fuera de geofence o GPS denegado */}
            {geoBlocked && (
                <Card className="border-red-200 bg-red-50 rounded-2xl">
                    <CardContent className="p-5 flex items-start gap-4">
                        <div className="p-2.5 bg-red-100 rounded-xl shrink-0">
                            <AlertTriangle size={20} className="text-red-600" />
                        </div>
                        <div className="flex-1">
                            {geoState.status === 'outside' ? (
                                <>
                                    <p className="font-black text-red-700 text-sm uppercase tracking-wide">Fuera de la faena</p>
                                    <p className="text-xs text-red-600 mt-1 font-semibold">
                                        Estás a <strong>{formatDistance(geoState.distanceM)}</strong> del punto de control.
                                        Radio permitido: {formatDistance(geoState.radiusM)}.
                                    </p>
                                </>
                            ) : geoState.status === 'gps_error' ? (
                                <>
                                    <p className="font-black text-red-700 text-sm uppercase tracking-wide">Error al generar QR</p>
                                    <p className="text-xs text-red-600 mt-1 font-semibold">{geoState.message}</p>
                                </>
                            ) : (
                                <>
                                    <p className="font-black text-red-700 text-sm uppercase tracking-wide">GPS requerido</p>
                                    <p className="text-xs text-red-600 mt-1 font-semibold">
                                        Activa la ubicación en tu dispositivo y vuelve a intentarlo.
                                    </p>
                                </>
                            )}
                        </div>
                        <Button size="sm" onClick={fetchToken} variant="outline" className="border-red-300 text-red-700 shrink-0">
                            Reintentar
                        </Button>
                    </CardContent>
                </Card>
            )}

            <div className="flex flex-col items-center gap-10">
                {/* Credential Card */}
                <div className="w-full max-w-[350px] aspect-[1/1.6] bg-slate-900 rounded-[2.5rem] shadow-2xl overflow-hidden relative group transition-transform hover:scale-[1.02] duration-500">
                    <div className="absolute top-0 left-0 w-full h-1/3 bg-gradient-to-br from-pagnol-orange/20 to-transparent pointer-events-none" />
                    <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-pagnol-orange/10 rounded-full blur-3xl" />

                    <div className="relative h-full flex flex-col p-8">
                        {/* Branding */}
                        <div className="flex justify-between items-start mb-8">
                            <div className="flex flex-col">
                                <span className="text-2xl font-black tracking-tighter text-white leading-none">PAGNOL</span>
                                <span className="text-[8px] font-bold tracking-[0.2em] text-pagnol-orange">ASSET MANAGEMENT</span>
                            </div>
                            <div className="p-3 bg-white/5 rounded-2xl border border-white/10">
                                <ShieldCheck size={20} className="text-pagnol-orange" />
                            </div>
                        </div>

                        {/* Avatar */}
                        <div className="flex flex-col items-center gap-4 mb-6">
                            <div className="w-32 h-32 rounded-3xl bg-slate-800 border-4 border-slate-700 shadow-xl overflow-hidden flex items-center justify-center relative">
                                {faceImage ? (
                                    <img src={faceImage} alt={user?.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="text-4xl font-black text-slate-600 uppercase">
                                        {user?.name?.[0] || 'U'}
                                    </div>
                                )}
                                <div className="absolute bottom-1 right-1 p-1.5 bg-pagnol-orange rounded-lg">
                                    <Camera size={12} className="text-white" />
                                </div>
                            </div>
                            <div className="text-center">
                                <h2 className="text-xl font-black uppercase text-white tracking-tight leading-tight">{user?.name}</h2>
                                <p className="text-[10px] font-bold text-pagnol-orange uppercase tracking-widest mt-1">{user?.cargo || 'Trabajador'}</p>
                            </div>
                        </div>

                        {/* QR Code dinámico */}
                        <div className="mt-auto bg-white p-4 rounded-[2rem] shadow-inner flex flex-col items-center gap-2">
                            <div className="p-2 bg-white rounded-xl">
                                {loading ? (
                                    <div className="w-[140px] h-[140px] flex flex-col items-center justify-center gap-2">
                                        {geoState.status === 'locating' ? (
                                            <>
                                                <MapPin size={24} className="text-slate-300 animate-bounce" />
                                                <p className="text-[9px] text-slate-400 font-bold">Obteniendo GPS...</p>
                                            </>
                                        ) : (
                                            <RefreshCw size={32} className="text-slate-300 animate-spin" />
                                        )}
                                    </div>
                                ) : geoBlocked ? (
                                    <div className="w-[140px] h-[140px] flex flex-col items-center justify-center gap-2">
                                        <AlertTriangle size={32} className="text-red-300" />
                                        <p className="text-[9px] text-red-400 font-bold text-center px-2">Ver detalle arriba</p>
                                    </div>
                                ) : qrValue ? (
                                    <QRCode
                                        value={qrValue}
                                        size={140}
                                        style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                                        viewBox="0 0 256 256"
                                    />
                                ) : null}
                            </div>

                            {/* Countdown bar */}
                            {!geoBlocked && qrValue && (
                                <div className="w-full px-1">
                                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-1000 ${isUrgent ? 'bg-red-400' : 'bg-green-400'}`}
                                            style={{ width: `${progressPct}%` }}
                                        />
                                    </div>
                                    <div className="flex items-center justify-between mt-1">
                                        <div className="flex items-center gap-1">
                                            {geoState.status === 'verified' ? (
                                                <>
                                                    <MapPin size={8} className="text-green-500" />
                                                    <span className="text-[8px] font-black text-green-600 uppercase tracking-widest">En faena ✓</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Shield size={8} className="text-green-500" />
                                                    <span className="text-[8px] font-black text-green-600 uppercase tracking-widest">QR Dinámico</span>
                                                </>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Clock size={8} className={isUrgent ? 'text-red-500' : 'text-slate-400'} />
                                            <span className={`text-[8px] font-black uppercase tracking-widest ${isUrgent ? 'text-red-500' : 'text-slate-500'}`}>
                                                {secondsLeft}s
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">ID: {user?.rut || user?.id?.substring(0, 10)}</p>
                        </div>

                        <div className="mt-6 flex justify-between items-center text-white/40">
                            <div className="flex items-center gap-2">
                                <Building2 size={12} />
                                <span className="text-[8px] font-bold uppercase tracking-widest">Inquilino Autorizado</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="w-full space-y-6">
                <div className="grid grid-cols-2 gap-4">
                    <Button
                        onClick={() => window.print()}
                        className="h-14 rounded-2xl bg-white text-slate-900 border-2 border-slate-100 hover:bg-slate-50 transition-all font-black uppercase text-[10px] tracking-widest group shadow-sm"
                    >
                        <Download size={18} className="mr-2 group-hover:-translate-y-1 transition-transform" /> Descargar PDF
                    </Button>
                    <Button
                        onClick={fetchToken}
                        disabled={loading}
                        className="h-14 rounded-2xl bg-slate-900 text-white hover:bg-black transition-all font-black uppercase text-[10px] tracking-widest group shadow-xl disabled:opacity-50"
                    >
                        <RefreshCw size={18} className={`mr-2 ${loading ? 'animate-spin' : ''}`} /> Actualizar QR
                    </Button>
                </div>

                <Card className="border-none shadow-xl shadow-slate-200/50 bg-white rounded-[2rem] overflow-hidden">
                    <CardContent className="p-8 space-y-4">
                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-green-50 rounded-xl text-green-600 shrink-0">
                                <Shield size={20} />
                            </div>
                            <div>
                                <h4 className="font-black uppercase text-sm text-slate-800">QR Anti-Fraude</h4>
                                <p className="text-xs font-semibold text-muted-foreground leading-relaxed mt-1">
                                    Código temporal de 2 minutos, de un solo uso, válido solo dentro de la zona de la faena.
                                </p>
                            </div>
                        </div>
                        <div className="border-t border-slate-50 pt-4 flex items-start gap-4">
                            <div className="p-3 bg-blue-50 rounded-xl text-blue-600 shrink-0">
                                <MapPin size={20} />
                            </div>
                            <div>
                                <h4 className="font-black uppercase text-sm text-slate-800">Verificación de Ubicación</h4>
                                <p className="text-xs font-semibold text-muted-foreground leading-relaxed mt-1">
                                    El GPS confirma que estás físicamente en la faena antes de generar el QR.
                                </p>
                            </div>
                        </div>
                        <div className="border-t border-slate-50 pt-4 flex items-start gap-4">
                            <div className="p-3 bg-pagnol-orange/10 rounded-xl text-pagnol-orange shrink-0">
                                <QrCode size={20} />
                            </div>
                            <div>
                                <h4 className="font-black uppercase text-sm text-slate-800">Credenciales Impresas</h4>
                                <p className="text-xs font-semibold text-muted-foreground leading-relaxed mt-1">
                                    Las tarjetas físicas siguen funcionando para acceso. Para máxima seguridad, usa el QR desde la app.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <style jsx global>{`
                @media print {
                    nav, button, .no-print { display: none !important; }
                    body { background: white !important; }
                }
            `}</style>
        </div>
    );
}
