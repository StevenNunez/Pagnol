"use client";

import React, { useMemo } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Download } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { generateBehaviorObservationPDF } from "@/lib/behavior-observation-pdf-generator";

const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'N/A';
    const jsDate = date instanceof Date ? date : new Date(date as any);
    return format(jsDate, "d 'de' MMMM, yyyy", { locale: es });
};

export default function BehaviorObservationDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { behaviorObservations, isLoading } = useAppState();
    const { toast } = useToast();

    const observationId = params.id as string;

    const observation = useMemo(() => {
        if (!behaviorObservations) return null;
        return behaviorObservations.find(o => o.id === observationId) || null;
    }, [behaviorObservations, observationId]);

    const handleDownloadPDF = async () => {
        if (!observation) return;
        try {
            await generateBehaviorObservationPDF(observation);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error al generar PDF', description: error.message });
        }
    };

    const getRiskBadge = (level: string | null) => {
        switch (level) {
            case 'aceptable': return <Badge variant="default" className="bg-green-600 dark:bg-green-700">Aceptable</Badge>;
            case 'leve': return <Badge variant="secondary" className="bg-yellow-500 dark:bg-yellow-600 text-white">Leve</Badge>;
            case 'grave': return <Badge variant="destructive" className="bg-orange-600 dark:bg-orange-700">Grave</Badge>;
            case 'gravisimo': return <Badge variant="destructive">Gravísimo</Badge>;
            default: return <Badge variant="outline">N/A</Badge>;
        }
    };

    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    if (!observation) {
        return (
            <div>
                <Button variant="ghost" onClick={() => router.back()}><ArrowLeft className="mr-2" /> Volver</Button>
                <PageHeader title="Observación no encontrada" description="La observación que buscas no existe o fue eliminada." />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-8">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                    <Button variant="outline" size="icon" onClick={() => router.back()}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <PageHeader title={`Observación a ${observation.workerName}`} description={`Obra: ${observation.obra} - Fecha: ${formatDate(observation.observationDate)}`} className="mb-0" />
                </div>
                <div className="flex items-center gap-4">
                    <Button variant="outline" onClick={handleDownloadPDF}>
                        <Download className="mr-2" /> Descargar PDF
                    </Button>
                    {getRiskBadge(observation.riskLevel)}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                <div className="lg:col-span-2 space-y-8">
                    <Card>
                        <CardHeader>
                            <CardTitle>Detalles de la Observación de Conducta</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {observation.items.map((item, index) => (
                                <div key={index} className="p-4 border rounded-lg space-y-3 bg-muted/30">
                                    <p className="font-semibold">{index + 1}. {item.question}</p>
                                    <div className="flex items-center gap-4 text-sm">
                                        <span className="font-medium">Respuesta:</span>
                                        {item.status === 'si' && <Badge className="bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600">Sí</Badge>}
                                        {item.status === 'no' && <Badge variant="destructive">No</Badge>}
                                        {item.status === 'na' && <Badge variant="secondary">N/A</Badge>}
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle>Retroalimentación Entregada</CardTitle></CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground p-4 border rounded-md bg-muted/20 min-h-[80px]">
                                {observation.feedback || "Sin retroalimentación."}
                            </p>
                        </CardContent>
                    </Card>
                </div>

                <div className="lg:col-span-1 space-y-8 sticky top-8">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">Firma del Observador</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="p-2 border rounded-md bg-white">
                                {observation.observerSignature ? (
                                    <Image src={observation.observerSignature} alt="Firma del observador" width={300} height={150} className="mx-auto" />
                                ) : (
                                    <p className="text-center text-sm text-muted-foreground p-4">No se registró firma.</p>
                                )}
                            </div>
                            <div className="mt-2 text-xs text-center text-muted-foreground">
                                <p>Observador: {observation.observerName}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">Firma del Trabajador</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="p-2 border rounded-md bg-white">
                                {observation.workerSignature ? (
                                    <Image src={observation.workerSignature} alt="Firma del trabajador" width={300} height={150} className="mx-auto" />
                                ) : (
                                    <p className="text-center text-sm text-muted-foreground p-4">No se registró firma.</p>
                                )}
                            </div>
                            <div className="mt-2 text-xs text-center text-muted-foreground">
                                <p>Trabajador: {observation.workerName}</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
