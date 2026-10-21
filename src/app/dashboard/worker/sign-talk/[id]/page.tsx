
"use client";

import React, { useMemo, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, CheckCircle, Edit, UserX } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { attendanceOf } from "@/lib/daily-talk-attendance";
import { LoadingState } from "@/components/loading-state";
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
    const { dailyTalks, dailyTalkSignatures, isLoading, signDailyTalk } = useAppState();
    const { user } = useAuth();
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Asistir y comprender son cosas distintas: la comprensión se confirma aparte.
    const [understood, setUnderstood] = useState(false);

    const talkId = params.id as string;

    const talk = useMemo(() => {
        if (!dailyTalks) return null;
        return dailyTalks.find(o => o.id === talkId) || null;
    }, [dailyTalks, talkId]);

    // Estado derivado de los hechos (firmó / faltó / pendiente), no del JSON de asistentes.
    const attendeeInfo = useMemo(() => {
        if (!talk || !user) return null;
        return attendanceOf(talk, dailyTalkSignatures || []).rows.find(r => r.id === user.id) ?? null;
    }, [talk, dailyTalkSignatures, user]);


    const handleSign = async () => {
        setIsSubmitting(true);
        try {
            await signDailyTalk(talkId, understood);
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
        return <LoadingState fullHeight />;
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

            {attendeeInfo.state === "absent" ? (
                <Card>
                    <CardHeader className="text-center">
                        <UserX className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                        <CardTitle>Quedaste registrado como ausente</CardTitle>
                        <CardDescription>
                            Si sí estuviste en la charla, pídele a quien la dirigió que tome tu firma en su equipo.
                        </CardDescription>
                    </CardHeader>
                </Card>
            ) : attendeeInfo.state === "signed" ? (
                <Card className="bg-green-50 border-green-200">
                    <CardHeader className="text-center">
                        <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-2" />
                        <CardTitle className="text-green-800">Ya has firmado esta charla</CardTitle>
                        <CardDescription className="text-green-700">
                            Tu asistencia fue confirmada el {formatDate(attendeeInfo.at)}{attendeeInfo.acknowledged ? " y confirmaste haber comprendido los temas" : ""}.
                        </CardDescription>
                    </CardHeader>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle>Confirmación de Firma</CardTitle>
                        <CardDescription>
                            Al firmar confirmas que <b>asististe</b> a esta charla de seguridad. Tu firma queda registrada con tu nombre, la fecha y la hora.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <label className="flex items-start gap-3 text-sm cursor-pointer">
                            <Checkbox checked={understood} onCheckedChange={(v) => setUnderstood(!!v)} className="mt-0.5" />
                            <span>
                                <b>Entendí los temas tratados.</b>
                                <span className="block text-xs text-muted-foreground">Es una confirmación aparte de tu asistencia. Si algo no quedó claro, déjala sin marcar y consúltalo con tu supervisor.</span>
                            </span>
                        </label>
                    </CardContent>
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
