"use client";

import React, { useState, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { useMonthlyAttendance } from "@/modules/core/hooks/use-attendance";
import { es } from "date-fns/locale";
import { format } from "date-fns";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserSearch, Clock, Briefcase, CalendarDays, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: format(new Date(0, i), "MMMM", { locale: es }),
}));
const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

export default function OvertimeReportPage() {
  const { users } = useAppState();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  const { report, loading } = useMonthlyAttendance(
    selectedUserId,
    selectedYear,
    selectedMonth
  );
  
  const selectedUser = useMemo(
    () => (users || []).find((u) => u.id === selectedUserId),
    [users, selectedUserId]
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Reporte de Horas Extras"
        description="Visualiza el detalle de horas extras por trabajador y período."
      />

       <Card>
        <CardHeader>
          <CardTitle>Selección de Reporte</CardTitle>
          <CardDescription>
            Elige un trabajador y el período para generar el informe de horas extras.
          </CardDescription>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            <Select
              value={selectedUserId || ""}
              onValueChange={setSelectedUserId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un trabajador..." />
              </SelectTrigger>
              <SelectContent>
                {(users || [])
                  .filter((u) => u.role !== "guardia")
                  .map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            <Select
              value={String(selectedMonth)}
              onValueChange={(val) => setSelectedMonth(Number(val))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un mes..." />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m.value} value={String(m.value)}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={String(selectedYear)}
              onValueChange={(val) => setSelectedYear(Number(val))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un año..." />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>
      
        {!selectedUserId ? (
            <Card>
            <CardContent className="p-12">
                <div className="flex flex-col items-center justify-center text-center text-muted-foreground">
                <UserSearch className="h-16 w-16 mb-4" />
                <h3 className="text-xl font-semibold">Selecciona un Trabajador</h3>
                <p className="mt-2">
                    Elige a un trabajador para ver su reporte de horas extras.
                </p>
                </div>
            </CardContent>
            </Card>
      ) : loading ? (
         <Card>
          <CardContent className="p-12">
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground">
              <Loader2 className="h-12 w-12 animate-spin mb-4" />
              <p className="text-xl font-semibold">Calculando horas...</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        report && selectedUser && (
            <>
            <Card>
                <CardHeader>
                    <CardTitle>Resumen Mensual de {selectedUser.name}</CardTitle>
                    <CardDescription>Período: {format(report.period.start, "MMMM yyyy", { locale: es })}</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                    <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                        <p className="text-sm text-green-400 flex items-center justify-center gap-2"><Clock /> Horas Extras Totales</p>
                        <p className="text-3xl font-bold text-green-400">{report.summary.totalOvertimeHours}</p>
                    </div>
                    <div className="p-4 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground flex items-center justify-center gap-2"><Briefcase /> Horas Trabajadas</p>
                        <p className="text-3xl font-bold">{report.summary.totalWorkedHours}</p>
                    </div>
                    <div className="p-4 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground flex items-center justify-center gap-2"><CalendarDays /> Días Hábiles</p>
                        <p className="text-3xl font-bold">{report.summary.totalBusinessDays}</p>
                    </div>
                </CardContent>
            </Card>
            
            <Card>
                <CardHeader>
                    <CardTitle>Desglose Diario de Horas Extras</CardTitle>
                    <CardDescription>Detalle de las horas extras registradas por día.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Día</TableHead>
                                <TableHead>Registros</TableHead>
                                <TableHead className="text-right">Horas Trabajadas</TableHead>
                                <TableHead className="text-right font-semibold text-green-400">Horas Extras</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {report.dailySummaries.map(day => (
                                <TableRow key={day.date} className={cn(!day.isBusinessDay && "bg-muted/50 text-muted-foreground")}>
                                    <TableCell className="font-medium">{day.date}</TableCell>
                                    <TableCell className="capitalize">{day.dayName}</TableCell>
                                    <TableCell>
                                    {day.entries.length > 0 ? (
                                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                                            {day.entries.map(e => (
                                                <span key={e.id} className={cn(e.type === 'in' ? 'text-green-400' : 'text-red-400')}>
                                                    {e.time}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-xs">{day.isBusinessDay ? 'Ausente' : 'Día no hábil'}</span>
                                    )}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">
                                        {day.totalHours > 0 ? day.totalHours.toFixed(2) : '--'}
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-semibold text-green-400">
                                        {day.overtimeHours !== '00:00' ? day.overtimeHours : '--'}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            </>
        )
      )}
    </div>
  );
}
