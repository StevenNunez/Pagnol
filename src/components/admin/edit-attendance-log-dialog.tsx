"use client";

import React, { useEffect, useMemo } from "react";
import { useForm, SubmitHandler, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Save, Trash2 } from "lucide-react";
import { AttendanceLog, User } from "@/modules/core/lib/data";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

const FormSchema = z.object({
  time: z
    .string()
    .regex(
      /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
      "El formato de hora debe ser HH:mm (ej: 08:05 o 17:30)."
    ),
  type: z.enum(["in", "out"], { required_error: "Debes seleccionar el tipo." }),
});

type FormData = z.infer<typeof FormSchema>;

interface EditAttendanceLogDialogProps {
  log: Partial<AttendanceLog> & { forDate?: Date; forUser?: User };
  isOpen: boolean;
  onClose: () => void;
}

export function EditAttendanceLogDialog({
  log,
  isOpen,
  onClose,
}: EditAttendanceLogDialogProps) {
  const { updateAttendanceLog, addManualAttendance, deleteAttendanceLog } = useAppState();
  const { toast } = useToast();

  const isEditing = Boolean(log.id);

  const initialTimestamp = useMemo(() => {
    if (isEditing && log.timestamp) {
      return new Date(log.timestamp);
    }
    return null;
  }, [isEditing, log.timestamp]);

  const userName = isEditing ? log.userName : log.forUser?.name;

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      time: "",
      type: "in",
    },
  });

  useEffect(() => {
    if (isOpen) {
      if (isEditing && initialTimestamp) {
        reset({
          time: format(initialTimestamp, "HH:mm"),
          type: log.type || "in",
        });
      } else {
        reset({
          time: "",
          type: "in",
        });
      }
    }
  }, [isOpen, isEditing, initialTimestamp, log.type, reset]);

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    try {
      const targetDate = isEditing ? initialTimestamp : log.forDate;
      if (!targetDate) {
        throw new Error("No se proporcionó una fecha válida para el registro.");
      }

      const [hours, minutes] = data.time.split(":").map(Number);
      const newTimestamp = new Date(targetDate);
      newTimestamp.setHours(hours, minutes, 0, 0);

      if (isEditing && log.id && initialTimestamp) {
        await updateAttendanceLog(log.id, newTimestamp, data.type, initialTimestamp);
        toast({
          title: "Registro Actualizado",
          description: `El registro de ${userName} ha sido actualizado para el ${format(
            targetDate,
            "dd/MM/yyyy"
          )}.`,
        });
      } else if (!isEditing && log.forUser && log.forDate) {
        await addManualAttendance(log.forUser.id, log.forDate, data.time, data.type);
        toast({
          title: "Registro Añadido",
          description: `Se ha añadido un nuevo registro para ${userName} el ${format(
            log.forDate,
            "dd/MM/yyyy"
          )}.`,
        });
      } else {
        throw new Error("Datos insuficientes para procesar el registro.");
      }

      onClose();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error.message || "No se pudo guardar el registro. Por favor, intenta de nuevo.",
      });
    }
  };

  const handleDelete = async () => {
    if (!log.id) return;
    try {
      await deleteAttendanceLog(log.id);
      toast({
        title: "Registro Eliminado",
        description: "El registro de asistencia ha sido eliminado correctamente.",
        variant: "destructive",
      });
      onClose();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo eliminar el registro."
      });
    }
  };


  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar" : "Añadir"} Registro de Asistencia
          </DialogTitle>
          <DialogDescription>
            {isEditing ? "Modificando" : "Añadiendo"} un registro para{" "}
            <span className="font-semibold">{userName || "Desconocido"}</span>
            {log.forDate ? ` para el día ${format(log.forDate, "dd/MM/yyyy")}` : ""}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Hora */}
            <div className="space-y-2">
              <Label htmlFor="time">Hora (formato 24h)</Label>
              <Input
                id="time"
                placeholder="Ej: 08:05"
                {...register("time")}
                aria-invalid={errors.time ? "true" : "false"}
              />
              {errors.time && (
                <p className="text-xs text-destructive">{errors.time.message}</p>
              )}
            </div>

            {/* Tipo */}
            <div className="space-y-2">
              <Label htmlFor="type">Tipo de Registro</Label>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger id="type" aria-label="Tipo de registro">
                      <SelectValue placeholder="Selecciona..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in">Entrada</SelectItem>
                      <SelectItem value="out">Salida</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.type && (
                <p className="text-xs text-destructive">{errors.type.message}</p>
              )}
            </div>
          </div>

          {isEditing && initialTimestamp && (
            <p className="text-xs text-muted-foreground text-center pt-2">
              Hora original: {format(initialTimestamp, "HH:mm:ss")}
            </p>
          )}

          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between w-full">
            <div>
              {isEditing && (
                 <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="destructive">
                        <Trash2 className="mr-2 h-4 w-4" /> Eliminar
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Confirmar eliminación?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta acción no se puede deshacer. Se eliminará permanentemente este registro de asistencia.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDelete}
                          className="bg-destructive hover:bg-destructive/90"
                        >
                          Sí, eliminar registro
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" /> Guardar Cambios
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
