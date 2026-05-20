
"use client";

import React, { useMemo, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, CheckCircle, Edit } from "lucide-react";
import { DailyTalk } from "@/modules/core/lib/data";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/modules/core/hooks/use-toast";

const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'N/A';
    const jsDate = new Date(date as any);
    return format(jsDate, "d 'de' MMMM, yyyy", { locale: es });
};

export default function SignDailyTalkPage() {
    const params = useParams();
    const router = useRouter();
    const { dailyTalks, isLoading, signDailyTalk } = useAppState();
    const { user } = useAuth();
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const talkId = params.id as string;

    const talk = useMemo(() => {
        if (!dailyTalks) return null;
        return dailyTalks.find(o => o.id === talkId) || null;
    }, [dailyTalks, talkId]);

    const attendeeInfo = useMemo(() => {
        if (!talk || !user) return null;
        return talk.asistentes.find(a => a.id === user.id);
    }, [talk, user]);


    const handleSign = async () => {
        setIsSubmitting(true);
        try {
            await signDailyTalk(talkId);
            toast({
                title: "¡Charla Firmada!",
                description: "Gracias por confirmar tu asistencia.",
            });
            router.push('/dashboard/worker');
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: "Error al firmar",
                description: error.message || "No se pudo registrar tu firma."
            });
        } finally {
            setIsSubmitting(false);
        }
    }

    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    if (!talk) {
        return (
            <div>
                <Button variant="ghost" onClick={() => router.back()}><ArrowLeft className="mr-2" /> Volver</Button>
                <PageHeader title="Charla no encontrada" description="El registro que buscas no existe o fue eliminado." />
            </div>
        );
    }

    if (!attendeeInfo) {
        return (
            <div>
                <Button variant="ghost" onClick={() => router.back()}><ArrowLeft className="mr-2" /> Volver</Button>
                <PageHeader title="No estás en la lista" description="No estás registrado como asistente para esta charla." />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-8 max-w-2xl mx-auto">
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <PageHeader title="Confirmar Asistencia" description={`Charla de seguridad del ${formatDate(talk.fecha)}`} className="mb-0" />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Detalles de la Charla</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <p className="text-sm font-semibold text-muted-foreground">Expositor</p>
                        <p>{talk.expositorName}</p>
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-muted-foreground">Temas Tratados</p>
                        <p className="p-3 bg-muted/50 rounded-md mt-1 text-sm">{talk.temas}</p>
                    </div>
                </CardContent>
            </Card>

            {attendeeInfo.signed ? (
                <Card className="bg-green-50 border-green-200">
                    <CardHeader className="text-center">
                        <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-2" />
                        <CardTitle className="text-green-800">Ya has firmado esta charla</CardTitle>
                        <CardDescription className="text-green-700">
                            Tu asistencia fue confirmada el {formatDate(attendeeInfo.signedAt)}.
                        </CardDescription>
                    </CardHeader>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle>Confirmación de Firma</CardTitle>
                        <CardDescription>
                            Al hacer clic en "Leer y Firmar", confirmas que has asistido y comprendido los temas tratados en esta charla de seguridad. Tu firma quedará registrada con tu nombre de usuario y la fecha actual.
                        </CardDescription>
                    </CardHeader>
                    <CardFooter>
                        <Button className="w-full" size="lg" onClick={handleSign} disabled={isSubmitting}>
                            {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Edit className="h-5 w-5 mr-2" />}
                            Leer y Firmar Digitalmente
                        </Button>
                    </CardFooter>
                </Card>
            )}
        </div>
    );
}
