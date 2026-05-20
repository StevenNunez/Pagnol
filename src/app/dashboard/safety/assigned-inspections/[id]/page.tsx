"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, Save, User, Calendar, Camera, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import SignaturePad from "@/components/signature-pad";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { SafetyInspection } from "@/modules/core/lib/data";
import { Badge } from "@/components/ui/badge";

const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'N/A';
    const jsDate = date instanceof Date ? date : new Date(date as any);
    return format(jsDate, "d 'de' MMMM, yyyy", { locale: es });
};

export default function CompleteInspectionPage() {
    const params = useParams();
    const router = useRouter();
    const { safetyInspections, users, isLoading, completeSafetyInspection } = useAppState();
    const { user: authUser } = useAuth();
    const { toast } = useToast();

    const signaturePadRef = useRef<any>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    const inspectionId = params.id as string;

    const inspection = useMemo(() => {
        if (!safetyInspections) return null;
        return safetyInspections.find(i => i.id === inspectionId) || null;
    }, [safetyInspections, inspectionId]);

    const [inspectionData, setInspectionData] = useState<SafetyInspection | null>(inspection);

    useEffect(() => {
        setInspectionData(inspection);
    }, [inspection]);

    const inspector = useMemo(() => {
        if (!inspectionData) return null;
        return users.find(u => u.id === inspectionData.inspectorId);
    }, [inspectionData, users]);

    const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            const file = event.target.files[0];
            const reader = new FileReader();

            reader.onload = (e) => {
                if (typeof e.target?.result === 'string') {
                    const img = document.createElement('img');
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const MAX_WIDTH = 800;
                        const MAX_HEIGHT = 800;
                        let width = img.width;
                        let height = img.height;

                        if (width > height) {
                            if (width > MAX_WIDTH) {
                                height *= MAX_WIDTH / width;
                                width = MAX_WIDTH;
                            }
                        } else {
                            if (height > MAX_HEIGHT) {
                                width *= MAX_HEIGHT / height;
                                height = MAX_HEIGHT;
                            }
                        }

                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) return;

                        ctx.drawImage(img, 0, 0, width, height);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

                        setInspectionData(prevData => {
                            if (!prevData) return null;
                            const completionPhotos = prevData.completionPhotos || [];
                            return {
                                ...prevData,
                                completionPhotos: [...completionPhotos, dataUrl]
                            };
                        });
                    };
                    img.src = e.target.result;
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const removePhoto = (index: number) => {
        if (!inspectionData || !inspectionData.completionPhotos) return;
        const newPhotos = inspectionData.completionPhotos.filter((_, i) => i !== index);
        setInspectionData({ ...inspectionData, completionPhotos: newPhotos });
    };

    const handleSave = async () => {
        if (!inspectionData) return;

        if (!inspectionData.completionNotes?.trim()) {
            toast({ variant: 'destructive', title: 'Error', description: 'Debes añadir una nota de cierre.' });
            return;
        }
        if (!inspectionData.completionSignature) {
            toast({ variant: 'destructive', title: 'Error', description: 'La firma de cierre es obligatoria.' });
            return;
        }
        if (!inspectionData.completionPhotos || inspectionData.completionPhotos.length === 0) {
            toast({ variant: 'destructive', title: 'Error', description: 'Debes adjuntar al menos una foto de la solución.' });
            return;
        }

        try {
            await completeSafetyInspection(inspectionData.id, {
                completionNotes: inspectionData.completionNotes,
                completionSignature: inspectionData.completionSignature,
                completionExecutor: authUser?.name || 'Desconocido',
                completionPhotos: inspectionData.completionPhotos
            });
            toast({ title: "Inspección Completada", description: "El formulario ha sido guardado y la tarea cerrada." });
            router.push('/dashboard/safety/assigned-inspections');
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error al Guardar", description: error.message || "No se pudo guardar el formulario." });
        }
    };

    const getRiskBadge = (level?: string) => {
        switch (level) {
            case 'leve': return <Badge variant="secondary">Riesgo Leve</Badge>;
            case 'grave': return <Badge variant="destructive">Riesgo Grave</Badge>;
            case 'fatal': return <Badge variant="destructive" className="bg-black text-white">Riesgo Fatal</Badge>;
            default: return null;
        }
    };

    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    if (!inspectionData) {
        return (
            <div>
                <Button variant="ghost" onClick={() => router.back()}><ArrowLeft className="mr-2" /> Volver</Button>
                <PageHeader title="Inspección no encontrada" description="La inspección que buscas no existe o no tienes permiso para verla." />
            </div>
        );
    }

    const isCompleted = inspectionData.status === 'completed';

    return (
        <div className="flex flex-col gap-8">
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <PageHeader title="Resolver Inspección de Seguridad" description={`Tarea asignada para la obra: ${inspectionData.area}`} className="mb-0" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                {/* Parte 1: Observación */}
                <div className="lg:col-span-2 space-y-8">
                    <Card>
                        <CardHeader>
                            <div className="flex justify-between items-start">
                                <div>
                                    <CardTitle>Parte 1: Observación Detectada</CardTitle>
                                    <CardDescription>Detalles del problema reportado.</CardDescription>
                                </div>
                                {getRiskBadge(inspectionData.riskLevel)}
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div>
                                <h4 className="font-semibold">Descripción de la Observación:</h4>
                                <p className="text-muted-foreground text-sm p-3 bg-muted/50 rounded-md mt-1">{inspectionData.description}</p>
                            </div>
                            <div>
                                <h4 className="font-semibold">Plan de Acción Sugerido:</h4>
                                <p className="text-muted-foreground text-sm p-3 bg-muted/50 rounded-md mt-1">{inspectionData.actionPlan || 'No especificado'}</p>
                            </div>
                            <div>
                                <h4 className="font-semibold">Evidencia del Problema:</h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
                                    {(inspectionData.evidencePhotoUrl ? [inspectionData.evidencePhotoUrl] : []).map((photo, index) => (
                                        <div key={`evidence-${index}`} className="relative aspect-video">
                                            <Image src={photo} alt={`Evidencia ${index + 1}`} layout="fill" className="rounded-md object-cover" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Parte 2: Cierre */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Parte 2: Cierre de la Observación</CardTitle>
                            <CardDescription>Documenta la solución implementada.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="completionNotes">Descripción del Cierre</Label>
                                <Textarea
                                    id="completionNotes"
                                    placeholder="Describe cómo se solucionó el problema..."
                                    value={inspectionData.completionNotes || ""}
                                    onChange={(e) => setInspectionData({ ...inspectionData, completionNotes: e.target.value })}
                                    readOnly={isCompleted}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Evidencia de la Solución</Label>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                    {(inspectionData.completionPhotos || []).map((photo, index) => (
                                        <div key={`solution-${index}`} className="relative group aspect-square">
                                            <Image src={photo} alt={`Solución ${index + 1}`} layout="fill" className="object-cover rounded-md" />
                                            {!isCompleted && (
                                                <Button
                                                    type="button"
                                                    variant="destructive"
                                                    size="icon"
                                                    className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={() => removePhoto(index)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                {!isCompleted && (
                                    <>
                                        <Button type="button" variant="outline" onClick={() => cameraInputRef.current?.click()}>
                                            <Camera className="mr-2 h-4 w-4" /> Añadir Foto de Solución
                                        </Button>
                                        <input
                                            ref={cameraInputRef}
                                            type="file" accept="image/*" capture="environment"
                                            onChange={handlePhotoUpload} className="hidden"
                                        />
                                    </>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label>Firma de Cierre</Label>
                                <div className="w-full h-48 border rounded-md bg-white relative">
                                    {isCompleted && inspectionData.completionSignature ? (
                                        <Image src={inspectionData.completionSignature} layout="fill" alt="Firma de Cierre" className="object-contain p-2" />
                                    ) : (
                                        <SignaturePad ref={signaturePadRef} onEnd={() => setInspectionData(prev => prev ? { ...prev, completionSignature: signaturePadRef.current?.getTrimmedCanvas().toDataURL('image/png') } : null)} />
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                </div>

                {/* Sidebar con Info */}
                <div className="lg:col-span-1 space-y-8 sticky top-8">
                    <Card>
                        <CardHeader>
                            <CardTitle>Información General</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <User className="h-4 w-4" />
                                <span>Reportado por: <span className="font-semibold text-foreground">{inspector?.name || 'N/A'}</span></span>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Calendar className="h-4 w-4" />
                                <span>Fecha del Reporte: <span className="font-semibold text-foreground">{formatDate(inspectionData.date)}</span></span>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Calendar className="h-4 w-4 text-destructive" />
                                <span>Plazo de Cierre: <span className="font-semibold text-destructive">{formatDate(inspectionData.deadline)}</span></span>
                            </div>
                        </CardContent>
                    </Card>
                    {!isCompleted && (
                        <div className="flex justify-end gap-4">
                            <Button variant="outline" onClick={() => router.back()}>Cancelar</Button>
                            <Button onClick={handleSave}><Save className="mr-2" /> Guardar y Completar Tarea</Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
