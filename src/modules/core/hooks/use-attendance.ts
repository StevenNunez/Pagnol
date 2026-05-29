"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isSameDay,
  format,
  parse,
  max,
  min,
  isSaturday,
  differenceInCalendarDays,
  startOfDay,
  parseISO,
} from 'date-fns';
import { es } from 'date-fns/locale';
import type { AttendanceLog, ShiftSchedule, ContractWorker } from '@/modules/core/lib/data';

interface DailySummary {
  date: string;
  dayName: string;
  isBusinessDay: boolean;
  isRestDay: boolean; // On-cycle rest day for rotating shifts
  entries: { id: string; time: string; type: 'in' | 'out' }[];
  totalHours: number;
  delayMinutes: number;
  overtimeHours: string;
  isAbsent: boolean;
}

const STANDARD_HOLIDAYS: string[] = [
  "01-01","05-01","05-21","06-29","07-16",
  "08-15","09-18","09-19","10-12","10-31","11-01","12-08","12-25",
];

/** Returns the position (0-based) in the rotation cycle for a given date. */
export function getCyclePosition(date: Date, schedule: ShiftSchedule): number {
  const cycleLength = schedule.daysOn + schedule.daysOff;
  const refDate = startOfDay(parseISO(schedule.rotationReferenceDate));
  const diff = differenceInCalendarDays(startOfDay(date), refDate);
  return ((diff % cycleLength) + cycleLength) % cycleLength;
}

/** True when the worker is scheduled to work on the given date. */
export function isWorkDay(date: Date, schedule: ShiftSchedule): boolean {
  if (schedule.shiftType === '5x2') {
    const dow = getDay(date);
    const mmdd = format(date, 'MM-dd');
    return dow !== 0 && dow !== 6 && !STANDARD_HOLIDAYS.includes(mmdd);
  }
  // Rotating shifts: use cycle position only (no weekday/holiday rules)
  return getCyclePosition(date, schedule) < schedule.daysOn;
}

/** Returns true for the "rest" (off) portion of a rotating shift. */
export function isRestDay(date: Date, schedule: ShiftSchedule): boolean {
  if (schedule.shiftType === '5x2') return false;
  return !isWorkDay(date, schedule);
}

/** Finds the active shift for a worker, or null if none assigned. */
export function getWorkerShift(
  userId: string,
  contractWorkers: ContractWorker[],
  shiftSchedules: ShiftSchedule[]
): ShiftSchedule | null {
  const cw = contractWorkers.find(w => w.userId === userId && !w.endDate);
  if (!cw?.shiftScheduleId) return null;
  return shiftSchedules.find(s => s.id === cw.shiftScheduleId) ?? null;
}

// ── useMonthlyAttendance ─────────────────────────────────────────────────────

export function useMonthlyAttendance(
  userId: string | null,
  year: number,
  month: number,
  shiftSchedule?: ShiftSchedule | null
) {
  const { attendanceLogs } = useAppState();
  const [report, setReport] = useState<{
    period: { start: Date; end: Date };
    dailySummaries: DailySummary[];
    summary: {
      totalBusinessDays: number;
      workedDays: number;
      absentDays: number;
      totalWorkedHours: string;
      totalOvertimeHours: string;
      totalOvertimeHoursNumber: number;
      totalDelayMinutes: number;
    };
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const checkIsBusinessDay = useCallback((day: Date): boolean => {
    if (shiftSchedule) return isWorkDay(day, shiftSchedule);
    const dow = getDay(day);
    if (dow === 0) return false;
    return !STANDARD_HOLIDAYS.includes(format(day, 'MM-dd'));
  }, [shiftSchedule]);

  const calculateDailySummary = useCallback(
    (logs: AttendanceLog[], day: Date): DailySummary => {
      const dayIsBusiness = checkIsBusinessDay(day);
      const dayIsRest = shiftSchedule ? isRestDay(day, shiftSchedule) : false;

      // Determine work times from shift schedule (or fall back to defaults)
      const workStartStr = shiftSchedule?.workStart ?? (isSaturday(day) ? '08:00' : '08:00');
      const workEndStr = shiftSchedule
        ? shiftSchedule.workEnd
        : isSaturday(day) ? '13:00' : getDay(day) === 5 ? '17:00' : '18:00';
      const lunchStartStr = shiftSchedule?.lunchStart ?? '13:00';
      const lunchEndStr = shiftSchedule?.lunchEnd ?? '14:00';

      const entries = logs.map(l => ({
        ...l,
        dateObj: new Date(l.timestamp),
      })).sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

      if (entries.length === 0) {
        return {
          date: format(day, 'dd/MM/yyyy'),
          dayName: format(day, 'EEEE', { locale: es }),
          isBusinessDay: dayIsBusiness,
          isRestDay: dayIsRest,
          entries: [],
          totalHours: 0,
          overtimeHours: '00:00',
          delayMinutes: 0,
          isAbsent: dayIsBusiness,
        };
      }

      const startWorkTime = parse(workStartStr, 'HH:mm', day);
      const endWorkTime = parse(workEndStr, 'HH:mm', day);
      const lunchStartTime = parse(lunchStartStr, 'HH:mm', day);
      const lunchEndTime = parse(lunchEndStr, 'HH:mm', day);

      let totalMillis = 0;
      let delayMinutes = 0;
      let overtimeMillis = 0;

      if (dayIsBusiness && entries[0].dateObj > startWorkTime) {
        delayMinutes = Math.round(
          (entries[0].dateObj.getTime() - startWorkTime.getTime()) / 60000
        );
      }

      const sessionPairs: [Date, Date][] = [];
      for (let i = 0; i < entries.length - 1; i += 2) {
        if (entries[i].type === 'in' && entries[i + 1]?.type === 'out') {
          sessionPairs.push([entries[i].dateObj, entries[i + 1].dateObj]);
        }
      }

      sessionPairs.forEach(([start, end]) => {
        let sessionMillis = end.getTime() - start.getTime();
        const lunchOverlapStart = max([start, lunchStartTime]);
        const lunchOverlapEnd = min([end, lunchEndTime]);
        const lunchOverlap = Math.max(0, lunchOverlapEnd.getTime() - lunchOverlapStart.getTime());
        sessionMillis -= lunchOverlap;
        totalMillis += sessionMillis;
      });

      const lastOut = entries.filter(e => e.type === 'out').pop()?.dateObj;
      if (lastOut && lastOut > endWorkTime) {
        overtimeMillis = lastOut.getTime() - endWorkTime.getTime();
      }

      // For rotating shift rest days, all hours count as overtime
      if (dayIsRest && sessionPairs.length > 0) {
        const [start, end] = sessionPairs[0];
        totalMillis = end.getTime() - start.getTime();
        overtimeMillis = totalMillis;
      }

      const totalHours = totalMillis / (1000 * 60 * 60);
      const overtimeHours = Math.floor(overtimeMillis / (1000 * 60 * 60));
      const overtimeMinutes = Math.floor((overtimeMillis % (1000 * 60 * 60)) / (1000 * 60));

      return {
        date: format(day, 'dd/MM/yyyy'),
        dayName: format(day, 'EEEE', { locale: es }),
        isBusinessDay: dayIsBusiness,
        isRestDay: dayIsRest,
        entries: entries.map(e => ({ id: e.id, time: format(e.dateObj, 'HH:mm'), type: e.type })),
        totalHours: Math.max(0, totalHours),
        overtimeHours: `${String(overtimeHours).padStart(2, '0')}:${String(overtimeMinutes).padStart(2, '0')}`,
        delayMinutes: Math.max(0, delayMinutes),
        isAbsent: false,
      };
    },
    [checkIsBusinessDay, shiftSchedule]
  );

  useEffect(() => {
    if (!userId) { setReport(null); return; }
    setLoading(true);

    const start = startOfMonth(new Date(year, month - 1));
    const end = endOfMonth(new Date(year, month - 1));
    const monthDays = eachDayOfInterval({ start, end });

    const userLogs = (attendanceLogs || []).filter((log: AttendanceLog) => {
      if (log.userId !== userId) return false;
      const logDate = new Date(log.timestamp);
      return logDate >= start && logDate <= end;
    });

    const dailySummaries = monthDays.map(day => {
      const logsForDay = userLogs.filter((log: AttendanceLog) =>
        isSameDay(new Date(log.timestamp), day)
      );
      return calculateDailySummary(logsForDay, day);
    });

    const totalBusinessDays = monthDays.filter(d => checkIsBusinessDay(d)).length;
    const workedDays = dailySummaries.filter(d => !d.isAbsent && d.totalHours > 0).length;
    const absentDays = totalBusinessDays - workedDays;

    const totalWorkedMinutes = dailySummaries.reduce((acc, d) => acc + d.totalHours * 60, 0);
    const totalWorkedHours = `${Math.floor(totalWorkedMinutes / 60)}:${String(Math.round(totalWorkedMinutes % 60)).padStart(2, '0')}`;

    const totalOvertimeMillis = dailySummaries.reduce((acc, d) => {
      const [h, m] = d.overtimeHours.split(':').map(Number);
      return acc + h * 3600000 + m * 60000;
    }, 0);
    const totalOvertimeH = Math.floor(totalOvertimeMillis / 3600000);
    const totalOvertimeM = Math.floor((totalOvertimeMillis % 3600000) / 60000);
    const totalOvertimeFormatted = `${String(totalOvertimeH).padStart(2, '0')}:${String(totalOvertimeM).padStart(2, '0')}`;
    const totalOvertimeHoursNumber = totalOvertimeMillis / 3600000;
    const totalDelayMinutes = dailySummaries.reduce((acc, d) => acc + d.delayMinutes, 0);

    setReport({
      period: { start, end },
      dailySummaries,
      summary: {
        totalBusinessDays,
        workedDays,
        absentDays,
        totalWorkedHours,
        totalOvertimeHours: totalOvertimeFormatted,
        totalOvertimeHoursNumber,
        totalDelayMinutes,
      },
    });
    setLoading(false);
  }, [userId, year, month, attendanceLogs, calculateDailySummary, checkIsBusinessDay]);

  return { report, loading };
}
