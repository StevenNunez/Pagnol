
"use client";

import React, { useMemo } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Download, Users, CheckCircle, Clock } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/modules/core/hooks/use-toast";
import { DailyTalk } from "@/modules/core/lib/data";
import { generateDailyTalkPDF } from "@/lib/daily-talk-pdf-generator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";


const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'N/A';
    const jsDate = new Date(date as any);
    return format(jsDate, "d 'de' MMMM, yyyy", { locale: es });
};

export default function DailyTalkDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { dailyTalks, isLoading, users } = useAppState();
    const { toast } = useToast();

    const talkId = params.id as string;

    const talk = useMemo(() => {
        if (!dailyTalks) return null;
        return dailyTalks.find(o => o.id === talkId) || null;
    }, [dailyTalks, talkId]);

    const handleDownloadPDF = async () => {
        if (!talk || !users) return;
        try {
            await generateDailyTalkPDF(talk, users);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error al generar PDF', description: error.message });
        }
    };

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
                            <ScrollArea className="h-72 border rounded-md">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Nombre</TableHead>
                                            <TableHead>RUT</TableHead>
                                            <TableHead className="text-right">Estado Firma</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {talk.asistentes.map(asistente => (
                                            <TableRow key={asistente.id}>
                                                <TableCell>{asistente.name}</TableCell>
                                                <TableCell>{asistente.rut || 'N/A'}</TableCell>
                                                <TableCell className="text-right">
                                                    {asistente.signed ? (
                                                        <Badge className="bg-green-100 text-green-700 border-green-200">
                                                            <CheckCircle className="h-3 w-3 mr-1" /> Firmado
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="outline" className="bg-yellow-100 text-yellow-700 border-yellow-200">
                                                            <Clock className="h-3 w-3 mr-1" /> Pendiente
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>

                <div className="lg:col-span-1 space-y-8 sticky top-8">
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
