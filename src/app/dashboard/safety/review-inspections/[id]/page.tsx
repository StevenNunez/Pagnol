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
import { Loader2, ArrowLeft, ThumbsUp, ThumbsDown, User as UserIcon, Calendar, Camera, Download } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import SignaturePad from "@/components/signature-pad";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { SafetyInspection, User } from "@/modules/core/lib/data";
import { Badge } from "@/components/ui/badge";
import { generateInspectionPDF } from "@/lib/inspection-pdf-generator";


const formatDate = (date: Date | string | undefined | null, includeTime = false) => {
    if (!date) return 'N/A';
    const jsDate = date instanceof Date ? date : new Date(date as any);
    const formatString = includeTime ? "d 'de' MMMM, yyyy HH:mm" : "d 'de' MMMM, yyyy";
    return format(jsDate, formatString, { locale: es });
};

export default function ReviewInspectionPage() {
    const params = useParams();
    const router = useRouter();
    const { safetyInspections, users, isLoading, reviewSafetyInspection } = useAppState();
    const { user } = useAuth();
    const { toast } = useToast();

    const signaturePadRef = useRef<any>(null);
    const inspectionId = params.id as string;

    const inspection = useMemo(() => {
        if (!safetyInspections) return null;
        return safetyInspections.find((i: SafetyInspection) => i.id === inspectionId) || null;
    }, [safetyInspections, inspectionId]);

    const [rejectionNotes, setRejectionNotes] = useState((inspection as any)?.rejectionNotes || "");
    const [aprSignature, setAprSignature] = useState<string | null>((inspection as any)?.reviewedBy?.signature || null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const supervisor = useMemo(() => {
        if (!inspection) return null;
        return (users || []).find((u: User) => u.id === inspection.assignedTo);
    }, [inspection, users]);

    const aprUser = useMemo(() => {
        if (!inspection) return null;
        return (users || []).find((u: User) => u.id === inspection.inspectorId);
    }, [inspection, users]);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'completed': return <Badge variant="secondary" className="bg-yellow-500 dark:bg-yellow-600 text-white">Listo para Revisar</Badge>;
            case 'approved': return <Badge variant="default" className="bg-green-600 dark:bg-green-700 text-white">Aprobado</Badge>;
            case 'rejected': return <Badge variant="destructive">Rechazado</Badge>;
            default: return <Badge variant="outline">{status}</Badge>;
        }
    };

    const handleReview = async (status: 'approved' | 'rejected') => {
        if (!inspection) return;
        if (status === 'rejected' && !rejectionNotes.trim()) {
            toast({ variant: 'destructive', title: 'Error', description: 'Debes proporcionar una razón para el rechazo en las notas.' });
            return;
        }
        if (!aprSignature) {
            toast({ variant: 'destructive', title: 'Error', description: 'Debes firmar para registrar tu revisión.' });
            return;
        }

        setIsSubmitting(true);
        try {
            await reviewSafetyInspection(inspectionId, status, rejectionNotes, aprSignature);
            toast({ title: `Inspección ${status === 'approved' ? 'aprobada' : 'rechazada'}`, description: 'El estado ha sido guardado.' });
            router.push('/dashboard/safety/review-inspections');
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error al Revisar', description: error.message || 'No se pudo completar la acción.' });
        } finally {
            setIsSubmitting(false);
        }
    }

    const handleDownloadPDF = async () => {
        if (!inspection) return;

        // Use fallback data if user objects are not found
        const supervisorData = supervisor || { id: inspection.assignedTo, name: inspection.completionExecutor || 'Usuario no encontrado' } as User;
        const aprData = aprUser || { id: inspection.inspectorId, name: inspection.inspectorName || 'Inspector no encontrado' } as User;

        try {
            await generateInspectionPDF(inspection, supervisorData, aprData);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error al generar PDF', description: error.message });
        }
    };


    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    if (!inspection) {
        return (
            <div>
                <Button variant="ghost" onClick={() => router.back()}><ArrowLeft className="mr-2" /> Volver</Button>
                <PageHeader title="Inspección no encontrada" description="La inspección que buscas no existe o fue eliminada." />
            </div>
        );
    }

    const isReviewed = inspection.status === 'approved' || inspection.status === 'rejected';

    return (
        <div className="flex flex-col gap-8">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                    <Button variant="outline" size="icon" onClick={() => router.back()}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <PageHeader title="Revisar Inspección de Seguridad" description={`Obra: ${inspection.area}`} className="mb-0" />
                </div>
                <div className="flex items-center gap-4">
                    {(isReviewed || inspection.status === 'completed') && (
                        <Button variant="outline" onClick={handleDownloadPDF}>
                            <Download className="mr-2" /> Descargar PDF
                        </Button>
                    )}
                    {getStatusBadge(inspection.status)}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                <div className="lg:col-span-2 space-y-8">
                    <Card>
                        <CardHeader>
                            <CardTitle>Parte 1: Observación Detectada</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p><span className="font-semibold">Descripción:</span> {inspection.description}</p>
                            <p><span className="font-semibold">Plan de Acción:</span> {inspection.actionPlan}</p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                {inspection.evidencePhotos && inspection.evidencePhotos.map((photo: string, i: number) => <Image key={i} src={photo} alt="Evidencia" width={200} height={150} className="rounded-md object-cover" />)}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Parte 2: Cierre de la Observación</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p><span className="font-semibold">Notas de Cierre:</span> {inspection.completionNotes}</p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                {inspection.completionPhotos?.map((photo: string, i: number) => <Image key={i} src={photo} alt="Evidencia de Cierre" width={200} height={150} className="rounded-md object-cover" />)}
                            </div>
                            <div className="p-2 border rounded-md bg-white">
                                {inspection.completionSignature ? (
                                    <Image src={inspection.completionSignature} alt="Firma Cierre" width={300} height={150} className="mx-auto" />
                                ) : (
                                    <p className="text-center text-sm text-muted-foreground p-4">No se registró firma de cierre.</p>
                                )}
                            </div>
                            <div className="mt-2 text-xs text-center text-muted-foreground">
                                <p>Cerrado por: {inspection.completionExecutor}</p>
                                <p>Fecha: {formatDate(inspection.completedAt, true)}</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="lg:col-span-1 space-y-8 sticky top-8">
                    <Card>
                        <CardHeader>
                            <CardTitle>Detalles de Asignación</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm space-y-2">
                            <p>Reportado por: <span className="font-semibold">{aprUser?.name || inspection.inspectorName}</span></p>
                            <p>Asignado a: <span className="font-semibold">{supervisor?.name || 'Usuario no encontrado'}</span></p>
                            <p>Fecha de Reporte: <span className="font-semibold">{formatDate(inspection.date)}</span></p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Acciones de Revisión Final</CardTitle>
                            <CardDescription>Aprueba o rechaza la solución implementada.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label htmlFor="rejectionNotes">Notas de Revisión (Obligatorio si se rechaza)</Label>
                                <Textarea
                                    id="rejectionNotes"
                                    placeholder="Ej: La solución no es adecuada, se debe mejorar..."
                                    value={rejectionNotes}
                                    onChange={(e) => setRejectionNotes(e.target.value)}
                                    disabled={isSubmitting || isReviewed}
                                />
                            </div>

                            <div>
                                <Label>Firma del Revisor (APR/Admin)</Label>
                                <div className="w-full h-40 border rounded-md bg-white relative">
                                    {isReviewed && aprSignature ? (
                                        <Image src={aprSignature} layout="fill" alt="Firma del Revisor" className="object-contain p-2" />
                                    ) : (
                                        <SignaturePad
                                            ref={signaturePadRef}
                                            onEnd={() => setAprSignature(signaturePadRef.current?.getTrimmedCanvas().toDataURL('image/png'))}
                                        />
                                    )}
                                </div>
                                {(isReviewed && inspection.reviewedBy?.date) && (
                                    <p className="text-xs text-muted-foreground text-center mt-1">
                                        Revisado el: {formatDate(inspection.reviewedBy.date, true)}
                                    </p>
                                )}
                            </div>

                            {!isReviewed && (
                                <div className="flex gap-2">
                                    <Button variant="destructive" className="flex-1" onClick={() => handleReview('rejected')} disabled={isSubmitting}>
                                        {isSubmitting ? <Loader2 className="mr-2 animate-spin" /> : <ThumbsDown className="mr-2" />} Rechazar
                                    </Button>
                                    <Button className="flex-1 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600" onClick={() => handleReview('approved')} disabled={!aprSignature || isSubmitting}>
                                        {isSubmitting ? <Loader2 className="mr-2 animate-spin" /> : <ThumbsUp className="mr-2" />} Aprobar
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

        </div>
    );
}
