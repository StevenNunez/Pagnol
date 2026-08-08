

"use client";

import React, { useState, useMemo, useCallback } from "react";
import dynamic from 'next/dynamic';
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { User, AttendanceLog, WORK_SCHEDULE } from "@/modules/core/lib/data";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  CalendarIcon,
  UserSearch,
  AlertTriangle,
  Edit,
  ChevronsUpDown,
  Check,
  PlusCircle,
} from "lucide-react";

import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  getDay,
  parse,
  max,
  min,
  addDays,
} from "date-fns";
import { getWorkerShift, isWorkDay, isRestDay } from "@/modules/core/hooks/use-attendance";
import { es } from "date-fns/locale";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { EditAttendanceLogDialog } from "@/components/admin/edit-attendance-log-dialog";

const Calendar = dynamic(() => import('@/components/ui/calendar').then(mod => mod.Calendar), { ssr: false });

interface DailySummary {
  date: string;
  dayName: string;
  dayDate: Date;
  entries: (AttendanceLog & { time: string; dateObj: Date })[];
  totalHours: number;
  delayMinutes: number;
  overtimeHours: string;
  isAbsent: boolean;
}

const WEEK_START_ON = 1; // Lunes
const HOLIDAY_MD: string[] = ["01-01","05-01","05-21","06-29","07-16","08-15","09-18","09-19","10-12","10-31","11-01","12-08","12-25"];

export default function AttendanceReportPage() {
  const { users, attendanceLogs, contractWorkers, shiftSchedules, can } = useAppState();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<
    (Partial<AttendanceLog> & { forDate?: Date; forUser?: User }) | null
  >(null);

  const userMap = useMemo(
    () => new Map<string, string>((users || []).map((u: User) => [u.id, u.name])),
    [users]
  );

  const weekInterval = useMemo(() => {
    const start = startOfWeek(selectedDate, { weekStartsOn: WEEK_START_ON });
    const end = endOfWeek(selectedDate, { weekStartsOn: WEEK_START_ON });
    return { start, end };
  }, [selectedDate]);

  const weekDays = useMemo(() => eachDayOfInterval(weekInterval), [weekInterval]);

  // Turno real del trabajador: el semanal aplica SU ciclo y horario cuando existe;
  // sin turno mantiene la regla de oficina (Lun–Vie, viernes corto, sábado = extra).
  const workerShift = useMemo(
    () => (selectedUserId ? getWorkerShift(selectedUserId, contractWorkers, shiftSchedules) : null),
    [selectedUserId, contractWorkers, shiftSchedules]
  );

  const calculateDailySummary = useCallback(
    (logs: AttendanceLog[], day: Date): DailySummary => {
      const isHoliday = HOLIDAY_MD.includes(format(day, "MM-dd"));
      const dayOfWeek = getDay(day);
      const isSaturday = dayOfWeek === 6;
      const isFriday = dayOfWeek === 5;

      const shift = workerShift?.shift ?? null;
      const anchor = workerShift?.rotationStartDate ?? null;
      // Con turno: el ciclo manda. Sin turno: regla de oficina clásica.
      const isScheduledWork = shift
        ? isWorkDay(day, shift, anchor)
        : (!isHoliday && !isSaturday);
      const isRest = shift ? isRestDay(day, shift, anchor) : false;

      const dayLabel = (() => {
        const base = format(day, "EEEE", { locale: es });
        if (shift && isRest) return `${base} (Descanso)`;
        if (isHoliday) return `${base} (Feriado)`;
        return base;
      })();

      const entries = logs
        .filter((l: AttendanceLog) => l.timestamp)
        .map((l: AttendanceLog) => ({
          ...l,
          dateObj: new Date(l.timestamp),
        }))
        .filter((l) => !isNaN(l.dateObj.getTime()))
        .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

      if (entries.length === 0) {
        return {
          date: format(day, "dd/MM/yyyy"),
          dayName: dayLabel,
          dayDate: day,
          entries: [],
          totalHours: 0,
          overtimeHours: "00:00",
          delayMinutes: 0,
          // Un día de descanso del ciclo sin marcas NO es ausencia.
          isAbsent: isScheduledWork,
        };
      }

      const startWorkTime = parse(shift?.workStart ?? WORK_SCHEDULE.weekdays.start, "HH:mm", day);
      let endWorkTime = parse(
        shift ? shift.workEnd : (isFriday ? WORK_SCHEDULE.friday.end : WORK_SCHEDULE.weekdays.end),
        "HH:mm",
        day
      );
      // Nocturno: la jornada termina al día siguiente.
      if (shift?.isNightShift && endWorkTime <= startWorkTime) endWorkTime = addDays(endWorkTime, 1);
      const lunchStartTime = parse(shift?.lunchStart ?? WORK_SCHEDULE.lunchBreak.start, "HH:mm", day);
      const lunchEndTime = parse(shift?.lunchEnd ?? WORK_SCHEDULE.lunchBreak.end, "HH:mm", day);

      let totalMillis = 0;
      let delayMinutes = 0;
      let overtimeMillis = 0;

      const effectiveStart = max([entries[0].dateObj, startWorkTime]);
      const lastOut = entries[entries.length - 1];

      if (isScheduledWork && entries[0].dateObj > startWorkTime) {
        delayMinutes = Math.round(
          (entries[0].dateObj.getTime() - startWorkTime.getTime()) / 60000
        );
      }

      if (isScheduledWork && lastOut.dateObj > endWorkTime) {
        overtimeMillis = Math.min(
          lastOut.dateObj.getTime() - endWorkTime.getTime(),
          2 * 60 * 60 * 1000
        );
      }

      let morningMillis = 0;
      let afternoonMillis = 0;

      if (entries.length === 4) {
        morningMillis = entries[1].dateObj.getTime() - effectiveStart.getTime();
        afternoonMillis = entries[3].dateObj.getTime() - entries[2].dateObj.getTime();
      } else {
        const workPeriodEnd = min([lastOut.dateObj, lunchStartTime]);
        morningMillis = workPeriodEnd.getTime() - effectiveStart.getTime();

        if (lastOut.dateObj > lunchEndTime) {
          const afternoonStart = max([effectiveStart, lunchEndTime]);
          afternoonMillis = lastOut.dateObj.getTime() - afternoonStart.getTime();
        }
      }
      totalMillis = Math.max(0, morningMillis) + Math.max(0, afternoonMillis);

      // Día NO programado (descanso del ciclo, sábado o feriado): todo cuenta como extra.
      if (!isScheduledWork) {
        totalMillis = 0;
        overtimeMillis = Math.max(0, lastOut.dateObj.getTime() - effectiveStart.getTime());
      }

      const overtimeHours = Math.floor(overtimeMillis / (1000 * 60 * 60));
      const overtimeMinutes = Math.floor(
        (overtimeMillis % (1000 * 60 * 60)) / (1000 * 60)
      );
      const overtimeFormatted = `${overtimeHours
        .toString()
        .padStart(2, "0")}:${overtimeMinutes.toString().padStart(2, "0")}`;

      return {
        date: format(day, "dd/MM/yyyy"),
        dayName: dayLabel,
        dayDate: day,
        entries: entries.map((l: any) => ({
          ...l,
          time: format(l.dateObj, "HH:mm"),
        })),
        totalHours: totalMillis / (1000 * 60 * 60),
        overtimeHours: overtimeFormatted,
        delayMinutes,
        isAbsent: false,
      };
    },
    [workerShift]
  );

  const weeklyReport = useMemo((): DailySummary[] => {
    if (!selectedUserId || !users || !attendanceLogs) return [];

    const userLogs = attendanceLogs.filter(
      (log: AttendanceLog) => log.userId === selectedUserId
    );

    // ── Turno nocturno ────────────────────────────────────────────────────
    // La jornada cruza la medianoche (20:00 → 08:00), así que agrupar por día
    // CALENDARIO parte la sesión en dos: la entrada quedaba en un día sin
    // salida y la salida en el día siguiente sin entrada. El detalle diario
    // mostraba la salida de madrugada en el día equivocado y las horas no
    // cuadraban. (El mensual y la liquidación ya lo hacían bien: parean por
    // SESIÓN — este reporte se quedó con el pareo viejo.)
    //
    // Se replica el criterio del hook mensual: entrada → salida siguiente
    // (máximo 26 h) y la sesión se atribuye al día de la ENTRADA.
    const isNight = !!workerShift?.shift?.isNightShift;

    if (isNight) {
      const sorted = [...userLogs].sort(
        (a: AttendanceLog, b: AttendanceLog) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      const byEntryDay = new Map<string, AttendanceLog[]>();
      for (let i = 0; i < sorted.length; i++) {
        const cur = sorted[i];
        if (cur.type !== "in") continue; // salidas sueltas: sin entrada que parear
        const inDate = new Date(cur.timestamp);
        const key = format(inDate, "yyyy-MM-dd");
        const bucket = byEntryDay.get(key) ?? [];
        const next = sorted[i + 1];
        if (next?.type === "out") {
          const outDate = new Date(next.timestamp);
          if (outDate.getTime() - inDate.getTime() <= 26 * 3600000) {
            bucket.push(cur, next);
            byEntryDay.set(key, bucket);
            i++; // la salida quedó consumida por esta sesión
            continue;
          }
        }
        bucket.push(cur); // entrada sin salida: se muestra, no suma horas
        byEntryDay.set(key, bucket);
      }

      return weekDays.map((day) =>
        calculateDailySummary(byEntryDay.get(format(day, "yyyy-MM-dd")) ?? [], day)
      );
    }

    return weekDays.map((day) => {
      const dayString = format(day, "yyyy-MM-dd");
      const logsForDay = userLogs
        .filter((log: AttendanceLog) => log.date === dayString)
        .sort(
          (a: AttendanceLog, b: AttendanceLog) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      return calculateDailySummary(logsForDay, day);
    });
  }, [selectedUserId, weekDays, attendanceLogs, users, calculateDailySummary, workerShift]);

  const formatHoursDecimal = (decimalHours: number) => {
    if (typeof decimalHours !== "number" || isNaN(decimalHours)) {
      return "00:00";
    }
    const hours = Math.floor(decimalHours);
    const minutes = Math.round((decimalHours - hours) * 60);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}`;
  };

  const weeklyTotals = useMemo(() => {
    const totalHoursDecimal = weeklyReport.reduce((acc, day) => acc + day.totalHours, 0);
    const totalDelays = weeklyReport.reduce((acc, day) => acc + day.delayMinutes, 0);
    
    const overtimeMillis = weeklyReport.reduce((acc, day) => {
      const [hours, minutes] = day.overtimeHours.split(":").map(Number);
      return acc + hours * 60 * 60 * 1000 + minutes * 60 * 1000;
    }, 0);

    const overtimeHours = Math.floor(overtimeMillis / (1000 * 60 * 60));
    const overtimeMinutes = Math.floor((overtimeMillis % (1000 * 60 * 60)) / (1000 * 60));
    
    return { 
      totalHours: formatHoursDecimal(totalHoursDecimal), 
      totalDelays, 
      overtimeHours: `${overtimeHours.toString().padStart(2, "0")}:${overtimeMinutes.toString().padStart(2, "0")}`
    };
  }, [weeklyReport]);

  const selectedUser = useMemo(
    () => (users || []).find((u: User) => u.id === selectedUserId),
    [selectedUserId, users]
  );

  const handleAddNewEntry = useCallback(
    (day: DailySummary) => {
      if (!selectedUser) return;
      setEditingLog({
        forDate: day.dayDate,
        forUser: selectedUser,
      });
    },
    [selectedUser]
  );

  const handleEditEntry = useCallback(
    (entry: AttendanceLog & { time: string; dateObj: Date }, day: DailySummary) => {
      if (!selectedUser) return;
      setEditingLog({
        ...entry,
        forDate: day.dayDate,
        forUser: selectedUser,
      });
    },
    [selectedUser]
  );

  const dailyColumns: DataTableColumn<DailySummary>[] = [
    { key: "day", header: "Día", className: "font-medium capitalize", cell: (day) => day.dayName },
    { key: "date", header: "Fecha", cell: (day) => day.date },
    {
      key: "entries", header: "Registros",
      // Celda densa: marcas con su color, aviso de registro modificado con su
      // tooltip de auditoría, y los botones de editar/agregar según permiso.
      cell: (day) => (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {day.isAbsent ? (
            <span className="text-muted-foreground text-xs">Ausente</span>
          ) : (
            day.entries.map((e, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className={e.type === "in" ? "text-green-400" : "text-red-400"}>
                  {e.time}
                </span>
                {e.modifiedAt && e.modifiedBy && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <AlertTriangle
                          className="h-3 w-3 text-yellow-400"
                          aria-label="Registro modificado"
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          Original:{" "}
                          {e.originalTimestamp
                            ? format(new Date(e.originalTimestamp), "HH:mm")
                            : "N/A"}
                        </p>
                        <p>Modificado por: {userMap.get(e.modifiedBy) ?? "Desconocido"}</p>
                        <p>Fecha mod: {format(new Date(e.modifiedAt), "dd/MM/yy HH:mm")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {can('attendance:edit') && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => { handleEditEntry(e, day); }}
                  >
                    <Edit className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))
          )}
          {can('attendance:edit') && (
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6 ml-2"
              onClick={() => handleAddNewEntry(day)}
              aria-label="Agregar nuevo registro"
            >
              <PlusCircle className="h-3 w-3" />
            </Button>
          )}
        </div>
      ),
    },
    {
      key: "delay", header: "Atraso (min)", headerClassName: "text-right", className: "text-right",
      cell: (day) => day.delayMinutes > 0
        ? <span className="text-amber-500 font-bold">{day.delayMinutes}</span>
        : "0",
    },
    {
      key: "hours", header: "Horas", headerClassName: "text-right", className: "text-right font-mono",
      cell: (day) => formatHoursDecimal(day.totalHours),
    },
    {
      key: "overtime", header: "Extras", headerClassName: "text-right",
      className: "text-right font-mono text-green-600",
      cell: (day) => day.overtimeHours,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {editingLog && (
        <EditAttendanceLogDialog
          log={editingLog}
          isOpen={!!editingLog}
          onClose={() => setEditingLog(null)}
        />
      )}

      <PageHeader
        title="Reporte Semanal de Asistencia"
        description="Selecciona un trabajador y una semana para ver el detalle de horas trabajadas, atrasos y horas extras (Ley 21.561 - 44 horas semanales)."
      />

      <Card>
        <CardHeader>
          <CardTitle>Filtros del Reporte</CardTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
            <div>
              <label className="text-sm font-medium">Trabajador</label>
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-label="Seleccionar trabajador"
                    className="w-full justify-between"
                  >
                    <span className="truncate">
                      {selectedUserId
                        ? (users || []).find((u: User) => u.id === selectedUserId)?.name ??
                          "Selecciona un trabajador..."
                        : "Selecciona un trabajador..."}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Buscar trabajador..." />
                    <CommandList>
                      <CommandEmpty>No se encontró el trabajador.</CommandEmpty>
                      <CommandGroup>
                        {(users || [])
                          ?.filter((u: User) => u.role !== "guardia")
                          .map((user: User) => (
                            <CommandItem
                              key={user.id}
                              value={user.name}
                              onSelect={() => {
                                setSelectedUserId(user.id);
                                setPopoverOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedUserId === user.id
                                    ? "opacity-100"
                                    : "opacity-0"
                                )}
                              />
                              {user.name}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <label className="text-sm font-medium">Semana del</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    aria-label="Seleccionar semana"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(weekInterval.start, "dd 'de' MMM", { locale: es })} -{" "}
                    {format(weekInterval.end, "dd 'de' MMM, yyyy", { locale: es })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => date && setSelectedDate(date)}
                    locale={es}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardHeader>
      </Card>

      {selectedUser ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Resumen Semanal de {selectedUser.name}</CardTitle>
              <CardDescription>
                Total de horas trabajadas, atrasos y horas extras para la semana seleccionada.
                {workerShift
                  ? ` Turno: ${workerShift.shift.name} (${workerShift.shift.shiftType}).`
                  : " Sin turno asignado (regla Lun–Vie)."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Horas Trabajadas</p>
                <p className="text-3xl font-bold">{weeklyTotals.totalHours}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Minutos de Atraso</p>
                <p className="text-3xl font-bold text-amber-500">
                  {weeklyTotals.totalDelays}
                </p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Horas Extras</p>
                <p className="text-3xl font-bold text-green-500">
                  {weeklyTotals.overtimeHours}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Detalle Diario</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                data={weeklyReport}
                rowKey={(day) => day.date}
                columns={dailyColumns}
                className="border-0 rounded-none"
                rowClassName={(day) => day.isAbsent ? "bg-muted/30" : undefined}
                empty={{ icon: <UserSearch className="h-6 w-6" />, title: 'Sin días en el período seleccionado.' }}
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="p-12">
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground">
              <UserSearch className="h-16 w-16 mb-4" />
              <h3 className="text-xl font-semibold">Selecciona un Trabajador</h3>
              <p className="mt-2">
                Elige un trabajador del menú de arriba para generar su reporte de
                asistencia.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
