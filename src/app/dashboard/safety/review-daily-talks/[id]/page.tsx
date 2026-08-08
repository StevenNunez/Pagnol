
"use client";

import React, { useMemo } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { useRecordFields } from "@/modules/core/hooks/use-record-fields";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Users, CheckCircle, Clock } from "lucide-react";
import { LoadingState } from "@/components/loading-state";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/modules/core/hooks/use-toast";
import { DailyTalk } from "@/modules/core/lib/data";
import { generateDailyTalkPDF } from "@/lib/daily-talk-pdf-generator";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";

type Attendee = DailyTalk["asistentes"][number];

const attendeeColumns: DataTableColumn<Attendee>[] = [
    { key: "name", header: "Nombre", cell: (a) => a.name },
    { key: "rut", header: "RUT", cell: (a) => a.rut || "N/A" },
    {
        key: "signed", header: "Estado Firma", headerClassName: "text-right", className: "text-right",
        cell: (a) => a.signed ? (
            <Badge className="bg-green-100 text-green-700 border-green-200">
                <CheckCircle className="h-3 w-3 mr-1" /> Firmado
            </Badge>
        ) : (
            <Badge variant="outline" className="bg-yellow-100 text-yellow-700 border-yellow-200">
                <Clock className="h-3 w-3 mr-1" /> Pendiente
            </Badge>
        ),
    },
];


const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'N/A';
    const jsDate = new Date(date as any);
    return format(jsDate, "d 'de' MMMM, yyyy", { locale: es });
};

export default function DailyTalkDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { dailyTalks, isLoading, users, currentTenant } = useAppState();
    const { toast } = useToast();

    const talkId = params.id as string;

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

    const handleDownloadPDF = async () => {
        if (!talk || !users) return;
        try {
            await generateDailyTalkPDF(talk, users, currentTenant?.logoUrl);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error al generar PDF', description: error.message });
        }
    };

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
                    <Button variant="outline" onClick={handleDownloadPDF}>
                        <Download className="mr-2" /> Descargar PDF
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
                            <CardTitle className="flex items-center gap-2"><Users /> Lista de Asistentes ({talk.asistentes.length})</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {/* Antes un ScrollArea h-72; DataTable da el mismo alto con
                                cabecera sticky, que el ScrollArea no tenía. */}
                            <DataTable
                                data={talk.asistentes}
                                rowKey={(a) => a.id}
                                maxHeight="18rem"
                                columns={attendeeColumns}
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
        </div>
    );
}
