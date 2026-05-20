"use client";
import { useState, useEffect, useMemo, useCallback } from 'react';
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
  isSaturday
} from 'date-fns';
import { es } from 'date-fns/locale';
import { AttendanceLog, WORK_SCHEDULE } from '@/modules/core/lib/data';

interface DailySummary {
  date: string;
  dayName: string;
  isBusinessDay: boolean;
  entries: { id: string; time: string; type: 'in' | 'out' }[];
  totalHours: number;
  delayMinutes: number;
  overtimeHours: string;
  isAbsent: boolean;
}

const HOLIDAYS: string[] = ["01-01", "05-01", "05-21", "06-29", "07-16", "08-15", "09-18", "09-19", "10-12", "10-31", "11-01", "12-08", "12-25"];

export function useMonthlyAttendance(userId: string | null, year: number, month: number) {
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
      totalOvertimeHoursNumber: number; // Added for calculations
      totalDelayMinutes: number;
    };
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const isBusinessDay = useCallback((day: Date) => {
    const dayOfWeek = getDay(day);
    if (dayOfWeek === 0) return false; // Sunday
    const formattedDate = format(day, 'MM-dd');
    if (HOLIDAYS.includes(formattedDate)) return false;
    return true;
  }, []);

  const calculateDailySummary = useCallback(
    (logs: AttendanceLog[], day: Date): DailySummary => {
      const dayIsBusiness = isBusinessDay(day);
      const dayIsSaturday = isSaturday(day);
      const isFriday = getDay(day) === 5;

      const entries = logs.map(l => ({
        ...l,
        dateObj: new Date(l.timestamp),
      })).sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

      if (entries.length === 0) {
        return {
          date: format(day, 'dd/MM/yyyy'),
          dayName: format(day, 'EEEE', { locale: es }),
          isBusinessDay: dayIsBusiness,
          entries: [],
          totalHours: 0,
          overtimeHours: '00:00',
          delayMinutes: 0,
          isAbsent: dayIsBusiness,
        };
      }

      const schedule = dayIsSaturday ? WORK_SCHEDULE.saturday : (isFriday ? WORK_SCHEDULE.friday : WORK_SCHEDULE.weekdays);
      const startWorkTime = parse(schedule.start, 'HH:mm', day);
      const endWorkTime = parse(schedule.end, 'HH:mm', day);
      const lunchStartTime = parse(WORK_SCHEDULE.lunchBreak.start, 'HH:mm', day);
      const lunchEndTime = parse(WORK_SCHEDULE.lunchBreak.end, 'HH:mm', day);
      
      let totalMillis = 0;
      let delayMinutes = 0;
      let overtimeMillis = 0;
      
      if (dayIsBusiness && !dayIsSaturday && entries[0].dateObj > startWorkTime) {
        delayMinutes = Math.round((entries[0].dateObj.getTime() - startWorkTime.getTime()) / 60000);
      }
      
      const sessionPairs: [Date, Date][] = [];
      for (let i = 0; i < entries.length - 1; i += 2) {
          if(entries[i].type === 'in' && entries[i+1]?.type === 'out') {
            sessionPairs.push([entries[i].dateObj, entries[i+1].dateObj]);
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

      if (dayIsSaturday) {
          totalMillis = (sessionPairs[0]?.[1].getTime() ?? 0) - (sessionPairs[0]?.[0].getTime() ?? 0);
          overtimeMillis = totalMillis;
      }

      const totalHours = totalMillis / (1000 * 60 * 60);
      const overtimeHours = Math.floor(overtimeMillis / (1000 * 60 * 60));
      const overtimeMinutes = Math.floor((overtimeMillis % (1000 * 60 * 60)) / (1000 * 60));

      return {
        date: format(day, 'dd/MM/yyyy'),
        dayName: format(day, 'EEEE', { locale: es }),
        isBusinessDay: dayIsBusiness,
        entries: entries.map(e => ({ id: e.id, time: format(e.dateObj, 'HH:mm'), type: e.type })),
        totalHours: Math.max(0, totalHours),
        overtimeHours: `${String(overtimeHours).padStart(2, '0')}:${String(overtimeMinutes).padStart(2, '0')}`,
        delayMinutes: Math.max(0, delayMinutes),
        isAbsent: false,
      };
    },
    [isBusinessDay]
  );
  
    useEffect(() => {
    if (!userId) {
      setReport(null);
      return;
    }
    setLoading(true);

    const start = startOfMonth(new Date(year, month - 1));
    const end = endOfMonth(new Date(year, month - 1));
    const monthDays = eachDayOfInterval({ start, end });

    const userLogs = (attendanceLogs || []).filter(
      (log: AttendanceLog) => {
          if (log.userId !== userId) return false;
          const logDate = new Date(log.timestamp);
          return logDate >= start && logDate <= end;
      }
    );

    const dailySummaries = monthDays.map((day) => {
      const logsForDay = userLogs.filter((log: AttendanceLog) => {
        const logDate = new Date(log.timestamp);
        return isSameDay(logDate, day);
      });
      return calculateDailySummary(logsForDay, day);
    });

    const totalBusinessDays = monthDays.filter(day => isBusinessDay(day)).length;
    const workedDays = dailySummaries.filter(d => !d.isAbsent && d.totalHours > 0).length;
    const absentDays = totalBusinessDays - workedDays;
    const totalWorkedMinutes = dailySummaries.reduce((acc, day) => acc + day.totalHours * 60, 0);
    const totalWorkedHours = `${Math.floor(totalWorkedMinutes / 60)}:${String(Math.round(totalWorkedMinutes % 60)).padStart(2, '0')}`;
    
    const totalOvertimeMillis = dailySummaries.reduce((acc, day) => {
        const [hours, minutes] = day.overtimeHours.split(':').map(Number);
        return acc + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);
    }, 0);
    
    const totalOvertimeHours = Math.floor(totalOvertimeMillis / (1000 * 60 * 60));
    const totalOvertimeMinutes = Math.floor((totalOvertimeMillis % (1000 * 60 * 60)) / (1000 * 60));
    const totalOvertimeFormatted = `${String(totalOvertimeHours).padStart(2, '0')}:${String(totalOvertimeMinutes).padStart(2, '0')}`;
    const totalOvertimeHoursNumber = totalOvertimeMillis / (1000 * 60 * 60);

    const totalDelayMinutes = dailySummaries.reduce((acc, day) => acc + day.delayMinutes, 0);

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
  }, [userId, year, month, attendanceLogs, calculateDailySummary, isBusinessDay]);


  return { report, loading };
}
