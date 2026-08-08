"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/modules/core/contexts/app-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, MapPin, Navigation, Save, Trash2, ExternalLink, ShieldCheck, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/modules/core/lib/supabase';
import { formatDistance } from '@/lib/geo';

interface GeofenceConfig {
    geo_lat:      number | null;
    geo_lng:      number | null;
    geo_radius_m: number;
}

export default function GeofencePage() {
    const { user } = useAuth();

    const [config, setConfig]       = useState<GeofenceConfig>({ geo_lat: null, geo_lng: null, geo_radius_m: 300 });
    const [lat, setLat]             = useState('');
    const [lng, setLng]             = useState('');
    const [radius, setRadius]       = useState('300');
    const [locating, setLocating]   = useState(false);
    const [saving, setSaving]       = useState(false);
    const [removing, setRemoving]   = useState(false);
    const [toast, setToast]         = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

    const getToken = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token ?? '';
    };

    const showToast = (type: 'ok' | 'err', msg: string) => {
        setToast({ type, msg });
        setTimeout(() => setToast(null), 4000);
    };

    const loadConfig = useCallback(async () => {
        const token = await getToken();
        const res = await fetch('/api/tenant/geofence', {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
            const data: GeofenceConfig = await res.json();
            setConfig(data);
            if (data.geo_lat)      setLat(String(data.geo_lat));
            if (data.geo_lng)      setLng(String(data.geo_lng));
            if (data.geo_radius_m) setRadius(String(data.geo_radius_m));
        }
    }, []);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial: `loadConfig` es async y sólo escribe estado después del await
    useEffect(() => { loadConfig(); }, [loadConfig]);

    const useMyLocation = () => {
        if (!navigator.geolocation) {
            showToast('err', 'GPS no disponible en este dispositivo.');
            return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            pos => {
                setLat(pos.coords.latitude.toFixed(6));
                setLng(pos.coords.longitude.toFixed(6));
                setLocating(false);
                showToast('ok', `Ubicación capturada: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
            },
            () => {
                setLocating(false);
                showToast('err', 'No se pudo obtener la ubicación. Verifica los permisos GPS.');
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    };

    const save = async () => {
        const latN = parseFloat(lat);
        const lngN = parseFloat(lng);
        const radN = parseInt(radius);
        if (isNaN(latN) || isNaN(lngN) || isNaN(radN) || radN < 50) {
            showToast('err', 'Ingresa coordenadas válidas y un radio mínimo de 50m.');
            return;
        }
        setSaving(true);
        const token = await getToken();
        const res = await fetch('/api/tenant/geofence', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: latN, lng: lngN, radius_m: radN }),
        });
        setSaving(false);
        if (res.ok) {
            setConfig({ geo_lat: latN, geo_lng: lngN, geo_radius_m: radN });
            showToast('ok', 'Geofence guardado. Los trabajadores deberán estar dentro de esta zona para generar su QR.');
        } else {
            showToast('err', 'Error al guardar. Intenta de nuevo.');
        }
    };

    const remove = async () => {
        setRemoving(true);
        const token = await getToken();
        await fetch('/api/tenant/geofence', {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        });
        setRemoving(false);
        setConfig({ geo_lat: null, geo_lng: null, geo_radius_m: 300 });
        setLat(''); setLng(''); setRadius('300');
        showToast('ok', 'Geofence eliminado. Los QR se generarán sin restricción de ubicación.');
    };

    const mapPreviewUrl = lat && lng
        ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
        : null;

    const isConfigured = config.geo_lat != null && config.geo_lng != null;
    const canEdit = user?.role === 'administrador' || user?.role === 'super-admin' || user?.role === 'director-faena';

    if (!canEdit) {
        return (
            <div className="max-w-2xl mx-auto p-8 text-center space-y-4">
                <AlertCircle size={40} className="mx-auto text-muted-foreground" />
                <p className="text-muted-foreground font-semibold">No tienes permisos para configurar el geofence.</p>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto space-y-8 p-4 pb-20 animate-in fade-in duration-500">
            {/* Toast */}
            {toast && (
                <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-2xl shadow-lg font-bold text-sm ${
                    toast.type === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                }`}>
                    {toast.msg}
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
                <Button variant="ghost" asChild className="text-muted-foreground hover:text-pagnol-orange">
                    <Link href="/dashboard/users" className="flex items-center gap-2">
                        <ArrowLeft size={16} /> Usuarios
                    </Link>
                </Button>
                <div className="text-right">
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest leading-none">Control de Acceso</p>
                    <p className="text-sm font-bold text-pagnol-orange">Zona de la Faena</p>
                </div>
            </div>

            {/* Estado actual */}
            <Card className={`rounded-3xl border-2 ${isConfigured ? 'border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15' : 'border-orange-200 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-500/15'}`}>
                <CardContent className="p-6 flex items-center gap-4">
                    <div className={`p-3 rounded-2xl ${isConfigured ? 'bg-green-100 dark:bg-green-500/20' : 'bg-orange-100 dark:bg-orange-500/20'}`}>
                        {isConfigured
                            ? <ShieldCheck size={24} className="text-green-600 dark:text-green-300" />
                            : <MapPin size={24} className="text-orange-600 dark:text-orange-300" />
                        }
                    </div>
                    <div className="flex-1">
                        <p className={`font-black text-sm uppercase tracking-wide ${isConfigured ? 'text-green-700 dark:text-green-300' : 'text-orange-700 dark:text-orange-300'}`}>
                            {isConfigured ? 'Geofence activo' : 'Sin geofence configurado'}
                        </p>
                        <p className={`text-xs font-semibold mt-0.5 ${isConfigured ? 'text-green-600 dark:text-green-300' : 'text-orange-600 dark:text-orange-300'}`}>
                            {isConfigured
                                ? `Centro: ${config.geo_lat?.toFixed(5)}, ${config.geo_lng?.toFixed(5)} — Radio: ${formatDistance(config.geo_radius_m)}`
                                : 'Los QR se generan sin validación de ubicación.'
                            }
                        </p>
                    </div>
                    {isConfigured && mapPreviewUrl && (
                        <a href={mapPreviewUrl} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm" className="shrink-0">
                                <ExternalLink size={14} className="mr-1" /> Ver mapa
                            </Button>
                        </a>
                    )}
                </CardContent>
            </Card>

            {/* Formulario */}
            <Card className="rounded-3xl border-none shadow-xl">
                <CardHeader className="px-8 pt-8 pb-2">
                    <CardTitle className="text-base font-black uppercase tracking-wide flex items-center gap-2">
                        <MapPin size={18} className="text-pagnol-orange" />
                        Configurar zona permitida
                    </CardTitle>
                </CardHeader>
                <CardContent className="px-8 pb-8 space-y-6">
                    {/* Botón capturar GPS */}
                    <Button
                        onClick={useMyLocation}
                        disabled={locating}
                        variant="outline"
                        className="w-full h-14 rounded-2xl border-2 border-dashed border-pagnol-orange/40 text-pagnol-orange hover:bg-pagnol-orange/5 font-black uppercase text-[11px] tracking-widest"
                    >
                        <Navigation size={18} className={`mr-2 ${locating ? 'animate-spin' : ''}`} />
                        {locating ? 'Obteniendo GPS...' : 'Usar mi ubicación actual'}
                    </Button>

                    <p className="text-[11px] text-muted-foreground text-center -mt-2 font-semibold">
                        Ve a la faena y pulsa el botón para capturar las coordenadas exactas.
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs font-black uppercase tracking-wide">Latitud</Label>
                            <Input
                                value={lat}
                                onChange={e => setLat(e.target.value)}
                                placeholder="-33.456789"
                                className="rounded-xl font-mono text-sm"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs font-black uppercase tracking-wide">Longitud</Label>
                            <Input
                                value={lng}
                                onChange={e => setLng(e.target.value)}
                                placeholder="-70.654321"
                                className="rounded-xl font-mono text-sm"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-xs font-black uppercase tracking-wide">
                            Radio permitido (metros)
                        </Label>
                        <Input
                            type="number"
                            min="50"
                            max="5000"
                            value={radius}
                            onChange={e => setRadius(e.target.value)}
                            placeholder="300"
                            className="rounded-xl text-sm"
                        />
                        <p className="text-[11px] text-muted-foreground font-semibold">
                            Recomendado: 200–500m para una faena estándar.
                        </p>
                    </div>

                    {/* Preview link dinámico */}
                    {lat && lng && (
                        <a
                            href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-300 font-bold hover:underline"
                        >
                            <ExternalLink size={12} />
                            Verificar coordenadas en OpenStreetMap
                        </a>
                    )}

                    <div className="flex gap-3 pt-2">
                        <Button
                            onClick={save}
                            disabled={saving || !lat || !lng}
                            className="flex-1 h-12 rounded-2xl bg-pagnol-orange text-white hover:bg-orange-600 font-black uppercase text-[11px] tracking-widest disabled:opacity-50"
                        >
                            <Save size={16} className="mr-2" />
                            {saving ? 'Guardando...' : 'Guardar geofence'}
                        </Button>
                        {isConfigured && (
                            <Button
                                onClick={remove}
                                disabled={removing}
                                variant="outline"
                                className="h-12 px-4 rounded-2xl border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-300 hover:bg-red-50"
                            >
                                <Trash2 size={16} />
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Info */}
            <Card className="border-none bg-muted rounded-3xl">
                <CardContent className="p-6 space-y-3">
                    <p className="text-xs font-black text-muted-foreground uppercase tracking-wide">¿Cómo funciona?</p>
                    <ul className="text-xs text-muted-foreground font-semibold space-y-2 list-none">
                        <li>📍 Al abrir la credencial, el teléfono del trabajador verifica su GPS</li>
                        <li>✅ Si está dentro del radio → el QR se genera normalmente</li>
                        <li>🚫 Si está fuera → se muestra la distancia exacta al punto de control</li>
                        <li>🖨️ Las credenciales impresas no requieren GPS (acceso físico)</li>
                    </ul>
                </CardContent>
            </Card>
        </div>
    );
}
