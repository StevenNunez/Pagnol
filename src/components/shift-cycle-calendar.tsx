'use client';

import React, { useMemo, useState } from 'react';
import {
    addMonths, eachDayOfInterval, endOfMonth, format, getDay, isSameDay,
    startOfMonth,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { isWorkDay } from '@/modules/core/hooks/use-attendance';
import type { ShiftSchedule } from '@/modules/core/lib/data';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

interface ShiftCycleCalendarProps {
    shift: ShiftSchedule;
    /** Ancla del ciclo del trabajador; null/undefined = referencia del turno. */
    rotationStartDate?: string | null;
    className?: string;
}

/**
 * Mini-calendario del ciclo de rotación: pinta los días "on" (trabaja) y "off"
 * (descanso) del mes, con navegación, para verificar de un vistazo que el patrón
 * calza con la realidad ANTES de que corra la asistencia. Compartido por la
 * página de Turnos y los flujos de asignación de turno.
 */
export function ShiftCycleCalendar({ shift, rotationStartDate, className }: ShiftCycleCalendarProps) {
    const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
    const today = new Date();

    const days = useMemo(
        () => eachDayOfInterval({ start: startOfMonth(monthDate), end: endOfMonth(monthDate) }),
        [monthDate]
    );
    // Lunes = 0 … Domingo = 6 (getDay: domingo = 0)
    const leadingBlanks = (getDay(days[0]) + 6) % 7;

    return (
        <div className={cn('space-y-1.5', className)}>
            <div className="flex items-center justify-between">
                <button
                    type="button"
                    onClick={() => setMonthDate(m => addMonths(m, -1))}
                    className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                    <ChevronLeft size={13} />
                </button>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    {format(monthDate, 'MMMM yyyy', { locale: es })}
                </p>
                <button
                    type="button"
                    onClick={() => setMonthDate(m => addMonths(m, 1))}
                    className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                    <ChevronRight size={13} />
                </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5">
                {WEEKDAYS.map((d, i) => (
                    <div key={i} className="text-center text-[8px] font-black uppercase text-muted-foreground/60 pb-0.5">{d}</div>
                ))}
                {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`b${i}`} />)}
                {days.map(day => {
                    const on = isWorkDay(day, shift, rotationStartDate);
                    const isToday = isSameDay(day, today);
                    return (
                        <div
                            key={day.toISOString()}
                            title={`${format(day, 'dd/MM')} — ${on ? 'Trabaja' : 'Descanso'}`}
                            className={cn(
                                'aspect-square rounded-md flex items-center justify-center text-[9px] font-bold',
                                on
                                    ? 'bg-success-subtle text-success-subtle-foreground'
                                    : 'bg-muted text-muted-foreground/50',
                                isToday && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                            )}
                        >
                            {format(day, 'd')}
                        </div>
                    );
                })}
            </div>
            <div className="flex items-center gap-3 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-success-subtle inline-block border border-success/30" /> Trabaja</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-muted inline-block border" /> Descanso</span>
            </div>
        </div>
    );
}
