
"use client";

import React, { useMemo, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { useRecordFields } from "@/modules/core/hooks/use-record-fields";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Users, CheckCircle, Clock, UserX, Bell, PenLine, Loader2 } from "lucide-react";
import { LoadingState } from "@/components/loading-state";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/modules/core/hooks/use-toast";
import { generateDailyTalkPDF } from "@/lib/daily-talk-pdf-generator";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/modules/core/lib/supabase";
import {
    attendanceOf, SIGN_METHOD_LABEL, type AttendeeView,
} from "@/lib/daily-talk-attendance";
import { markTalkAbsent, notifyTalk } from "@/modules/core/lib/daily-talk-client";
import { TalkSignDialog } from "@/components/safety/talk-sign-dialog";

const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'N/A';
    const jsDate = new Date(date as any);
    return format(jsDate, "d 'de' MMMM, yyyy", { locale: es });
};

export default function DailyTalkDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { dailyTalks, dailyTalkSignatures, isLoading, users, currentTenant, can } = useAppState();
    const { user: authUser } = useAuth();
    const { toast } = useToast();

    const talkId = params.id as string;
    const [signing, setSigning] = useState<AttendeeView | null>(null);
    const [notifying, setNotifying] = useState(false);
    const [busyAbsent, setBusyAbsent] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);

    // firma y foto (base64) ya no viajan en el collection (S6); se cargan
    // bajo demanda y se fusionan para display y generación de PDF.
    const media = useRecordFields<{ firma: string | null; foto: string | null }>(
        'daily_talks', talkId, 'firma, foto'
    );

    const talk = useMemo(() => {
        if (!dailyTalks) return null;
        const base = dailyTalks.find(o => o.id === talkId) || null;
        if (!base) return null;
        return { ...base, firma: media?.firma ?? base.firma, foto: media?.foto ?? base.foto };
    }, [dailyTalks, talkId, media]);

    // Quién firmó, quién faltó y quién sigue pendiente: derivado de los hechos.
    const attendance = useMemo(
        () => (talk ? attendanceOf(talk, (dailyTalkSignatures || []).filter(f => f.talkId === talk.id)) : null),
        [talk, dailyTalkSignatures]
    );
    const enrolledIds = useMemo(
        () => new Set((users || []).filter(u => u.biometricEnrolled).map(u => u.id)),
        [users]
    );

    // El servidor vuelve a validarlo; esto sólo decide si se muestran los botones.
    const canManage = !!authUser && !!talk
        && (talk.expositorId === authUser.id || can('safety_talks:manage'));

    const handleDownloadPDF = async () => {
        if (!talk || !users || !attendance) return;
        setDownloading(true);
        try {
            // La imagen de cada firma pesa: se pide ahora, sólo para este PDF.
            const { data } = await supabase
                .from('daily_talk_signatures')
                .select('worker_id, signature')
                .eq('talk_id', talk.id).eq('status', 'signed');
            const signatures = Object.fromEntries(
                (data ?? []).filter(r => r.signature).map(r => [r.worker_id as string, r.signature as string])
            );
            await generateDailyTalkPDF(talk, users, currentTenant?.logoUrl, { attendance, signatures });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error al generar PDF', description: error.message });
        } finally {
            setDownloading(false);
        }
    };

    const handleNotifyPending = async () => {
        if (!talk) return;
        setNotifying(true);
        try {
            const r = await notifyTalk(talk.id, 'pending');
            toast({
                variant: r.sent > 0 ? 'success' : 'info',
                title: r.sent > 0 ? 'Aviso enviado' : 'Nadie recibió el aviso',
                description: r.sent > 0
                    ? `Se avisó a ${r.targeted} persona${r.targeted !== 1 ? 's' : ''} que aún no firma${r.targeted !== 1 ? 'n' : ''}.`
                    : 'Quienes quedan no tienen la app con avisos activados. Toma su firma aquí, en tu equipo.',
            });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'No se pudo avisar', description: error?.message });
        } finally {
            setNotifying(false);
        }
    };

    const handleAbsent = async (row: AttendeeView) => {
        if (!talk) return;
        setBusyAbsent(row.id);
        try {
            await markTalkAbsent(talk.id, row.id);
            toast({ title: 'Marcado como ausente', description: row.name });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'No se pudo marcar', description: error?.message });
        } finally {
            setBusyAbsent(null);
        }
    };

    const columns: DataTableColumn<AttendeeView>[] = [
        { key: "name", header: "Nombre", cell: (a) => a.name },
        { key: "rut", header: "RUT", cell: (a) => a.rut || "N/A" },
        {
            key: "state", header: "Asistencia",
            cell: (a) => a.state === "signed" ? (
                <div>
                    <Badge className="bg-green-100 text-green-700 border-green-200">
                        <CheckCircle className="h-3 w-3 mr-1" /> Firmado
                    </Badge>
                    <p className="text-[11px] text-muted-foreground mt-1">
                        {a.method ? SIGN_METHOD_LABEL[a.method] : ""}{a.at ? ` · ${format(a.at, "d MMM HH:mm", { locale: es })}` : ""}
                    </p>
                    {a.recordedByName && a.method !== "own_session" && a.method !== "legacy" && (
                        <p className="text-[11px] text-muted-foreground">Tomada por {a.recordedByName}</p>
                    )}
                </div>
            ) : a.state === "absent" ? (
                <Badge variant="outline" className="bg-muted text-muted-foreground">
                    <UserX className="h-3 w-3 mr-1" /> Ausente
                </Badge>
            ) : (
                <Badge variant="outline" className="bg-yellow-100 text-yellow-700 border-yellow-200">
                    <Clock className="h-3 w-3 mr-1" /> Pendiente
                </Badge>
            ),
        },
        {
            key: "understood", header: "Entendió",
            cell: (a) => a.state !== "signed" ? <span className="text-muted-foreground">—</span>
                : a.acknowledged ? <span className="text-green-700 text-sm font-semibold">Sí</span>
                : <span className="text-muted-foreground text-xs">No indicó</span>,
        },
        ...(canManage ? [{
            key: "actions", header: "", headerClassName: "text-right", className: "text-right",
            cell: (a: AttendeeView) => a.state === "signed" ? null : (
                <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" className="rounded-xl gap-1.5" onClick={() => setSigning(a)}>
                        <PenLine className="h-3.5 w-3.5" /> Firmar aquí
                    </Button>
                    {a.state === "pending" && (
                        <Button size="sm" variant="ghost" className="rounded-xl" disabled={busyAbsent === a.id} onClick={() => handleAbsent(a)}>
                            {busyAbsent === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ausente"}
                        </Button>
                    )}
                </div>
            ),
        } as DataTableColumn<AttendeeView>] : []),
    ];

    if (isLoading) {
        return <LoadingState fullHeight />;
    }

    if (!talk || !attendance) {
        return (
            <div>
                <Button variant="ghost" onClick={() => router.back()}><ArrowLeft className="mr-2" /> Volver</Button>
                <PageHeader title="Charla no encontrada" description="El registro que buscas no existe o fue eliminado." />
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
                    <PageHeader title={`Charla del ${formatDate(talk.fecha)}`} description={`Obra: ${talk.obra} • Expositor: ${talk.expositorName}`} className="mb-0" />
                </div>
                <div className="flex items-center gap-4">
                    <Button variant="outline" onClick={handleDownloadPDF} disabled={downloading}>
                        {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2" />} Descargar PDF
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                <div className="lg:col-span-2 space-y-8">
                    <Card>
                        <CardHeader><CardTitle>Temas Tratados</CardTitle></CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground p-4 border rounded-md bg-muted/20 min-h-[120px]">
                                {talk.temas || "No se especificaron temas."}
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div>
                                    <CardTitle className="flex items-center gap-2"><Users /> Asistencia ({attendance.total})</CardTitle>
                                    <CardDescription>
                                        {attendance.signed} firmaron · {attendance.pending} pendientes · {attendance.absent} ausentes
                                    </CardDescription>
                                </div>
                                {canManage && (
                                    <Button onClick={handleNotifyPending} disabled={notifying || attendance.pending === 0} className="rounded-xl gap-2">
                                        {notifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                                        Notificar a los pendientes
                                    </Button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            <DataTable
                                data={attendance.rows}
                                rowKey={(a) => a.id}
                                maxHeight="24rem"
                                columns={columns}
                                empty={{ icon: <Users className="h-6 w-6" />, title: 'Sin asistentes registrados.' }}
                            />
                        </CardContent>
                    </Card>
                </div>

                <div className="lg:col-span-1 space-y-8 lg:sticky lg:top-8">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">Evidencia</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="p-2 border rounded-md bg-white">
                                {talk.foto ? (
                                    <Image src={talk.foto} alt="Evidencia de la charla" width={400} height={300} className="mx-auto" />
                                ) : (
                                    <p className="text-center text-sm text-muted-foreground p-4">No se adjuntó foto.</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">Firma del Expositor</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="p-2 border rounded-md bg-white">
                                {talk.firma ? (
                                    <Image src={talk.firma} alt="Firma del expositor" width={300} height={150} className="mx-auto" />
                                ) : (
                                    <p className="text-center text-sm text-muted-foreground p-4">No se registró firma.</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <TalkSignDialog
                talkId={talk.id}
                worker={signing ? { id: signing.id, name: signing.name, enrolled: enrolledIds.has(signing.id) } : null}
                onClose={() => setSigning(null)}
            />
        </div>
    );
}
