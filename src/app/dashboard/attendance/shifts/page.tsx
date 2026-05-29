"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/modules/core/hooks/use-toast";
import { RotateCcw, Plus, Trash2, Pencil, Moon, Sun, Clock } from "lucide-react";
import type { ShiftSchedule, ShiftType } from "@/modules/core/lib/data";
import { format } from "date-fns";

const SHIFT_PRESETS: Record<ShiftType, { daysOn: number; daysOff: number; label: string; color: string }> = {
  "5x2":   { daysOn: 5,  daysOff: 2,  label: "5×2 — Lun a Vie",    color: "bg-blue-100 text-blue-800 border-blue-200" },
  "4x3":   { daysOn: 4,  daysOff: 3,  label: "4×3 — Rot. Corta",   color: "bg-green-100 text-green-800 border-green-200" },
  "7x7":   { daysOn: 7,  daysOff: 7,  label: "7×7 — Semanal",      color: "bg-orange-100 text-orange-800 border-orange-200" },
  "14x14": { daysOn: 14, daysOff: 14, label: "14×14 — Quincenal",   color: "bg-purple-100 text-purple-800 border-purple-200" },
  "21x7":  { daysOn: 21, daysOff: 7,  label: "21×7 — Mensual ext.", color: "bg-red-100 text-red-800 border-red-200" },
  "custom": { daysOn: 0, daysOff: 0,  label: "Personalizado",       color: "bg-slate-100 text-slate-700 border-slate-200" },
};

const shiftSchema = z.object({
  name: z.string().min(1, "Nombre requerido"),
  shiftType: z.enum(["5x2", "4x3", "7x7", "14x14", "21x7", "custom"]),
  daysOn: z.coerce.number().min(1),
  daysOff: z.coerce.number().min(1),
  workStart: z.string().regex(/^\d{2}:\d{2}$/, "Formato HH:mm"),
  workEnd: z.string().regex(/^\d{2}:\d{2}$/, "Formato HH:mm"),
  isNightShift: z.boolean().default(false),
  lunchStart: z.string().optional(),
  lunchEnd: z.string().optional(),
  rotationReferenceDate: z.string().min(1, "Fecha de referencia requerida"),
});

type ShiftFormData = z.infer<typeof shiftSchema>;

export default function ShiftsPage() {
  const { shiftSchedules, addShiftSchedule, updateShiftSchedule, deleteShiftSchedule, can } = useAppState();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<ShiftSchedule | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canManage = can('shifts:manage') || can('attendance:edit');

  const { register, handleSubmit, watch, setValue, reset, formState: { errors, isSubmitting } } = useForm<ShiftFormData>({
    resolver: zodResolver(shiftSchema),
    defaultValues: {
      shiftType: "7x7", daysOn: 7, daysOff: 7,
      workStart: "08:00", workEnd: "20:00",
      isNightShift: false, lunchStart: "13:00", lunchEnd: "14:00",
      rotationReferenceDate: format(new Date(), "yyyy-MM-dd"),
    },
  });

  const watchedType = watch("shiftType");
  const watchedNight = watch("isNightShift");

  const handleTypeChange = (type: ShiftType) => {
    setValue("shiftType", type);
    const preset = SHIFT_PRESETS[type];
    if (type !== "custom") {
      setValue("daysOn", preset.daysOn);
      setValue("daysOff", preset.daysOff);
    }
  };

  const openCreate = () => {
    setEditingShift(null);
    reset({
      shiftType: "7x7", daysOn: 7, daysOff: 7,
      workStart: "08:00", workEnd: "20:00",
      isNightShift: false, lunchStart: "13:00", lunchEnd: "14:00",
      rotationReferenceDate: format(new Date(), "yyyy-MM-dd"),
    });
    setDialogOpen(true);
  };

  const openEdit = (shift: ShiftSchedule) => {
    setEditingShift(shift);
    reset({
      name: shift.name,
      shiftType: shift.shiftType,
      daysOn: shift.daysOn,
      daysOff: shift.daysOff,
      workStart: shift.workStart,
      workEnd: shift.workEnd,
      isNightShift: shift.isNightShift,
      lunchStart: shift.lunchStart ?? "",
      lunchEnd: shift.lunchEnd ?? "",
      rotationReferenceDate: shift.rotationReferenceDate,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (data: ShiftFormData) => {
    try {
      if (editingShift) {
        await updateShiftSchedule(editingShift.id, {
          name: data.name, shiftType: data.shiftType,
          daysOn: data.daysOn, daysOff: data.daysOff,
          workStart: data.workStart, workEnd: data.workEnd,
          isNightShift: data.isNightShift,
          lunchStart: data.lunchStart || undefined,
          lunchEnd: data.lunchEnd || undefined,
          rotationReferenceDate: data.rotationReferenceDate,
        });
        toast({ title: "Turno actualizado" });
      } else {
        await addShiftSchedule({
          name: data.name, shiftType: data.shiftType,
          daysOn: data.daysOn, daysOff: data.daysOff,
          workStart: data.workStart, workEnd: data.workEnd,
          isNightShift: data.isNightShift,
          lunchStart: data.lunchStart || undefined,
          lunchEnd: data.lunchEnd || undefined,
          rotationReferenceDate: data.rotationReferenceDate,
        });
        toast({ title: "Turno creado" });
      }
      setDialogOpen(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteShiftSchedule(id);
      toast({ title: "Turno eliminado" });
      setDeletingId(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Gestión de Turnos"
          description="Define los esquemas de rotación para faenas mineras: 7×7, 14×14, 4×3 y más."
        />
        {canManage && (
          <Button onClick={openCreate} className="shrink-0 bg-pagnol-orange hover:bg-orange-600 text-white font-black uppercase text-[10px] tracking-widest rounded-xl px-6 gap-2">
            <Plus size={16} /> Nuevo Turno
          </Button>
        )}
      </div>

      {shiftSchedules.length === 0 ? (
        <Card>
          <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
            <RotateCcw size={40} className="opacity-30" />
            <p className="font-semibold text-lg">Sin turnos configurados</p>
            <p className="text-sm max-w-xs">Crea turnos de rotación para asignarlos a los trabajadores de cada contrato.</p>
            {canManage && <Button onClick={openCreate} variant="outline" className="mt-2">Crear primer turno</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shiftSchedules.map(shift => {
            const preset = SHIFT_PRESETS[shift.shiftType];
            return (
              <Card key={shift.id} className="group">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{shift.name}</CardTitle>
                      <CardDescription className="text-[10px] font-black uppercase tracking-widest mt-1">
                        {shift.daysOn} días trabajo / {shift.daysOff} días descanso
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className={`shrink-0 text-[9px] font-black uppercase tracking-widest ${preset.color}`}>
                      {shift.shiftType}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    {shift.isNightShift ? <Moon size={14} className="text-indigo-500 shrink-0" /> : <Sun size={14} className="text-amber-500 shrink-0" />}
                    <span className="font-mono font-bold">{shift.workStart} – {shift.workEnd}</span>
                    <span className="text-muted-foreground text-[10px]">
                      {shift.isNightShift ? "Nocturno" : "Diurno"}
                    </span>
                  </div>
                  {shift.lunchStart && shift.lunchEnd && !shift.isNightShift && (
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Clock size={12} />
                      <span>Colación: {shift.lunchStart} – {shift.lunchEnd}</span>
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    Referencia: <span className="font-mono">{shift.rotationReferenceDate}</span>
                  </div>

                  {/* Cycle visualizer */}
                  <div className="flex gap-0.5 flex-wrap">
                    {Array.from({ length: Math.min(shift.daysOn + shift.daysOff, 28) }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-2 flex-1 min-w-[6px] rounded-sm ${i < shift.daysOn ? 'bg-green-500' : 'bg-slate-200'}`}
                      />
                    ))}
                    {shift.daysOn + shift.daysOff > 28 && <span className="text-[9px] text-muted-foreground self-end">…</span>}
                  </div>

                  {canManage && (
                    <div className="flex gap-2 pt-1">
                      <Button variant="outline" size="sm" className="flex-1 h-7 text-[10px]" onClick={() => openEdit(shift)}>
                        <Pencil size={11} className="mr-1" /> Editar
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-[10px] text-destructive hover:text-destructive" onClick={() => setDeletingId(shift.id)}>
                        <Trash2 size={11} />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingShift ? "Editar turno" : "Nuevo turno de trabajo"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label>Nombre del turno</Label>
              <Input placeholder="Ej: Turno A — 7×7 Diurno" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1">
              <Label>Tipo de rotación</Label>
              <Select value={watchedType} onValueChange={v => handleTypeChange(v as ShiftType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(SHIFT_PRESETS) as ShiftType[]).map(k => (
                    <SelectItem key={k} value={k}>
                      <span className="font-mono font-bold mr-2">{k}</span>
                      {SHIFT_PRESETS[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Días de trabajo</Label>
                <Input type="number" min={1} {...register("daysOn")} disabled={watchedType !== "custom"} />
              </div>
              <div className="space-y-1">
                <Label>Días de descanso</Label>
                <Input type="number" min={1} {...register("daysOff")} disabled={watchedType !== "custom"} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Inicio jornada</Label>
                <Input type="time" {...register("workStart")} />
              </div>
              <div className="space-y-1">
                <Label>Fin jornada</Label>
                <Input type="time" {...register("workEnd")} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch id="night" checked={watchedNight} onCheckedChange={v => setValue("isNightShift", v)} />
              <Label htmlFor="night">Turno nocturno (cruza medianoche)</Label>
            </div>

            {!watchedNight && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Inicio colación</Label>
                  <Input type="time" {...register("lunchStart")} />
                </div>
                <div className="space-y-1">
                  <Label>Fin colación</Label>
                  <Input type="time" {...register("lunchEnd")} />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label>Fecha de referencia del ciclo</Label>
              <Input type="date" {...register("rotationReferenceDate")} />
              <p className="text-[10px] text-muted-foreground">
                El día 1 del ciclo de rotación (día que el trabajador inicia su turno "on").
              </p>
              {errors.rotationReferenceDate && <p className="text-xs text-destructive">{errors.rotationReferenceDate.message}</p>}
            </div>

            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {editingShift ? "Guardar cambios" : "Crear turno"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar turno?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se desvinculará de todos los trabajadores asignados. Esta acción no se puede deshacer.
          </p>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button variant="destructive" onClick={() => deletingId && handleDelete(deletingId)}>Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
