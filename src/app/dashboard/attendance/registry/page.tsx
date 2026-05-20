
"use client";

import React, { useState, useMemo, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScanLine, LogIn, LogOut, Loader2, UserCheck, UserX } from "lucide-react";
import { QrScannerDialog } from "@/components/qr-scanner-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { AttendanceLog, User } from "@/modules/core/lib/data";
import { Pie, PieChart, Cell } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { useToast } from "@/modules/core/hooks/use-toast";


export default function AttendanceRegistryPage() {
    const { attendanceLogs, handleAttendanceScan, isLoading, users } = useAppState();
    const [today, setToday] = useState('');
    const [scannerOpen, setScannerOpen] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        const now = new Date();
        setToday(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
    }, []);
    
    const userMap = useMemo(() => new Map<string, string>((users || []).map((u: User) => [u.id, u.name])), [users]);

    const todaysLogsGrouped = useMemo(() => {
        if (!attendanceLogs) return new Map<string, AttendanceLog[]>();
        
        const grouped = new Map<string, AttendanceLog[]>();

        attendanceLogs
            .filter((log: AttendanceLog) => log.date === today)
            .forEach((log: AttendanceLog) => {
                if (!grouped.has(log.userId)) {
                    grouped.set(log.userId, []);
                }
                grouped.get(log.userId)!.push(log);
            });
        
        grouped.forEach((logs: AttendanceLog[]) => logs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()));

        return grouped;
    }, [attendanceLogs, today]);
    
    const attendanceStats = useMemo(() => {
        const relevantUsers = (users || []).filter((u: User) => u.role !== 'guardia');
        const totalUsers = relevantUsers.length;
        const totalAttendees = todaysLogsGrouped.size;
        
        let currentlyPresent = 0;
        let leftForDay = 0;

        todaysLogsGrouped.forEach((logs: AttendanceLog[]) => {
            if (logs.length > 0) {
                const lastLog = logs[logs.length - 1];
                if (lastLog.type === 'in') {
                    currentlyPresent++;
                } else {
                    leftForDay++;
                }
            }
        });

        const absentUsers = totalUsers - totalAttendees;
        
        return { totalUsers, totalAttendees, currentlyPresent, leftForDay, absentUsers };
    }, [users, todaysLogsGrouped]);
    
    const attendanceChartData = useMemo(() => ([
        { name: "Asistentes", value: attendanceStats.totalAttendees, fill: "hsl(var(--chart-2))" },
        { name: "Ausentes", value: attendanceStats.absentUsers, fill: "hsl(var(--destructive))" },
    ]), [attendanceStats]);
    
     const statusChartData = useMemo(() => ([
        { name: "Presentes", value: attendanceStats.currentlyPresent, fill: "hsl(var(--chart-2))" },
        { name: "Fuera de Obra", value: attendanceStats.leftForDay, fill: "hsl(var(--chart-4))" },
    ]), [attendanceStats]);

    const attendanceChartConfig = {
      value: { label: "Trabajadores" },
      Asistentes: { label: "Asistentes", icon: UserCheck },
      Ausentes: { label: "Ausentes", icon: UserX },
    };
    
     const statusChartConfig = {
      value: { label: "Trabajadores" },
      Presentes: { label: "Presentes", icon: UserCheck },
      "Fuera de Obra": { label: "Fuera de Obra", icon: UserX },
    };

    const handleQrScan = async (qrCode: string) => {
        try {
            await handleAttendanceScan(qrCode);
            toast({ variant: 'success', title: 'Registro exitoso', description: 'Asistencia registrada correctamente.' });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error al registrar', description: e.message });
        }
    };

    const formatTime = (date: Date): string => {
        if (!date) return "--:--";
        const jsDate = date instanceof Date ? date : new Date(date as any);
        return jsDate.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    };

    const getStatusForUser = (logs: AttendanceLog[] | undefined) => {
        if (!logs || logs.length === 0) return <Badge variant="outline">Ausente</Badge>;
        const lastLog = logs[logs.length - 1];
        if (lastLog.type === 'in') return <Badge className="bg-green-600 text-white hover:bg-green-700">Presente</Badge>;
        return <Badge variant="outline">Finalizado</Badge>;
    }

    if (isLoading) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }
    
    return (
        <>
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Registro de Asistencia"
                description={`Movimientos registrados para hoy, ${new Date().toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`}
            />

             <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                 <Card>
                    <CardHeader>
                        <CardTitle>Asistencia General</CardTitle>
                        <CardDescription>Total de trabajadores que asistieron hoy.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-center pb-6">
                        <ChartContainer config={attendanceChartConfig} className="mx-auto aspect-square h-[250px]">
                        <PieChart>
                            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                            <Pie data={attendanceChartData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90}>
                                 {attendanceChartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.fill} />
                                 ))}
                            </Pie>
                             <ChartLegend content={<ChartLegendContent />} className="-translate-y-2 flex-wrap gap-2 [&>*]:basis-1/4 [&>*]:justify-center" />
                        </PieChart>
                        </ChartContainer>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader>
                        <CardTitle>Estado Actual en Obra</CardTitle>
                        <CardDescription>Trabajadores actualmente dentro vs. fuera de la obra.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-center pb-6">
                         <ChartContainer config={statusChartConfig} className="mx-auto aspect-square h-[250px]">
                        <PieChart>
                            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                            <Pie data={statusChartData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90}>
                                {statusChartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.fill} />
                                 ))}
                            </Pie>
                            <ChartLegend content={<ChartLegendContent />} className="-translate-y-2 flex-wrap gap-2 [&>*]:basis-1/4 [&>*]:justify-center" />
                        </PieChart>
                        </ChartContainer>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                        <span>Movimientos del Día</span>
                        <Button onClick={() => setScannerOpen(true)}>
                            <ScanLine className="mr-2 h-4 w-4" />
                            Escanear QR
                        </Button>
                    </CardTitle>
                    <CardDescription>
                        Cada escaneo registra una entrada o una salida automáticamente, incluyendo colación.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Trabajador</TableHead>
                                <TableHead>Registros del Día</TableHead>
                                <TableHead>Estado Actual</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {Array.from(todaysLogsGrouped.entries()).length > 0 ? Array.from(todaysLogsGrouped.entries()).map(([userId, logs]) => (
                                <TableRow key={userId}>
                                    <TableCell className="font-medium">{userMap.get(userId) || 'Desconocido'}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                                            {logs.map((log: AttendanceLog) => (
                                                 <div key={log.id} className="flex items-center gap-2 text-sm">
                                                    {log.type === 'in' ? <LogIn className="h-4 w-4 text-green-500" /> : <LogOut className="h-4 w-4 text-red-500" />}
                                                    <span>{formatTime(log.timestamp)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {getStatusForUser(logs)}
                                    </TableCell>
                                </TableRow>
                            )) : (
                                <TableRow>
                                    <TableCell colSpan={3} className="h-24 text-center">
                                        Aún no hay registros de asistencia para hoy.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>

        <QrScannerDialog
            open={scannerOpen}
            onOpenChange={setScannerOpen}
            onScan={handleQrScan}
            title="Registrar Asistencia"
            description="Apunta la cámara al código QR del trabajador para registrar entrada o salida automáticamente."
        />
        </>
    );
}

