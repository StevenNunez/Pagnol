

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
} from "date-fns";
import { es } from "date-fns/locale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
const HOLIDAYS: Date[] = [
  new Date(2025, 8, 18),
  new Date(2025, 8, 19),
];

export default function AttendanceReportPage() {
  const { users, attendanceLogs, can } = useAppState();
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

  const calculateDailySummary = useCallback(
    (logs: AttendanceLog[], day: Date): DailySummary => {
      const isHoliday = HOLIDAYS.some(
        (h) => h.toDateString() === day.toDateString()
      );
      const dayOfWeek = getDay(day);
      const isSaturday = dayOfWeek === 6;
      const isFriday = dayOfWeek === 5;

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
          dayName: isHoliday
            ? `${format(day, "EEEE", { locale: es })} (Feriado)`
            : format(day, "EEEE", { locale: es }),
          dayDate: day,
          entries: [],
          totalHours: 0,
          overtimeHours: "00:00",
          delayMinutes: 0,
          isAbsent: true,
        };
      }

      const startWorkTime = parse(WORK_SCHEDULE.weekdays.start, "HH:mm", day);
      const endWorkTime = parse(
        isFriday ? WORK_SCHEDULE.friday.end : WORK_SCHEDULE.weekdays.end,
        "HH:mm",
        day
      );
      const lunchStartTime = parse(WORK_SCHEDULE.lunchBreak.start, "HH:mm", day);
      const lunchEndTime = parse(WORK_SCHEDULE.lunchBreak.end, "HH:mm", day);

      let totalMillis = 0;
      let delayMinutes = 0;
      let overtimeMillis = 0;

      const effectiveStart = max([entries[0].dateObj, startWorkTime]);
      const lastOut = entries[entries.length - 1];

      if (!isHoliday && !isSaturday && entries[0].dateObj > startWorkTime) {
        delayMinutes = Math.round(
          (entries[0].dateObj.getTime() - startWorkTime.getTime()) / 60000
        );
      }

      if (!isHoliday && !isSaturday && lastOut.dateObj > endWorkTime) {
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

      if (isSaturday || isHoliday) {
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
        dayName: isHoliday
          ? `${format(day, "EEEE", { locale: es })} (Feriado)`
          : format(day, "EEEE", { locale: es }),
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
    []
  );

  const weeklyReport = useMemo((): DailySummary[] => {
    if (!selectedUserId || !users || !attendanceLogs) return [];

    const userLogs = attendanceLogs.filter(
      (log: AttendanceLog) => log.userId === selectedUserId
    );

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
  }, [selectedUserId, weekDays, attendanceLogs, users, calculateDailySummary]);

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
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Día</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Registros</TableHead>
                    <TableHead className="text-right">Atraso (min)</TableHead>
                    <TableHead className="text-right">Horas</TableHead>
                    <TableHead className="text-right">Extras</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeklyReport.map((day) => (
                    <TableRow
                      key={day.date}
                      className={day.isAbsent ? "bg-muted/30" : ""}
                    >
                      <TableCell className="font-medium capitalize">
                        {day.dayName}
                      </TableCell>
                      <TableCell>{day.date}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          {day.isAbsent ? (
                            <span className="text-muted-foreground text-xs">
                              Ausente
                            </span>
                          ) : (
                            day.entries.map((e, i) => (
                              <div key={i} className="flex items-center gap-1">
                                <span
                                  className={
                                    e.type === "in"
                                      ? "text-green-400"
                                      : "text-red-400"
                                  }
                                >
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
                                            ? format(
                                                new Date(e.originalTimestamp),
                                                "HH:mm"
                                              )
                                            : "N/A"}
                                        </p>
                                        <p>
                                          Modificado por:{" "}
                                          {userMap.get(e.modifiedBy) ?? "Desconocido"}
                                        </p>
                                        <p>
                                          Fecha mod:{" "}
                                          {format(
                                            new Date(e.modifiedAt),
                                            "dd/MM/yy HH:mm"
                                          )}
                                        </p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                                {can('attendance:edit') && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5"
                                    onClick={() => {
                                      handleEditEntry(e, day);
                                    }}
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
                      </TableCell>
                      <TableCell className="text-right">
                        {day.delayMinutes > 0 ? (
                          <span className="text-amber-500 font-bold">
                            {day.delayMinutes}
                          </span>
                        ) : (
                          "0"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatHoursDecimal(day.totalHours)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600">
                        {day.overtimeHours}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
