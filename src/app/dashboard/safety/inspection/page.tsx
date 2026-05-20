"use client";

import React, { useState, useMemo, useRef } from "react";
import { useForm, Controller, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Loader2, Send, Camera, Trash2, Calendar as CalendarIcon } from "lucide-react";
import Image from "next/image";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";


const InspectionSchema = z.object({
  work: z.string().min(3, "El nombre de la obra es requerido."),
  location: z.string().optional(),
  description: z.string().min(10, "La descripción debe tener al menos 10 caracteres."),
  riskLevel: z.enum(['leve', 'grave', 'fatal'], { required_error: "Debes seleccionar un nivel de riesgo." }),
  actionPlan: z.string().min(5, "El plan de acción es requerido."),
  assignedTo: z.string({ required_error: "Debes asignar un responsable." }),
  deadline: z.date().optional(),
});

type InspectionFormData = z.infer<typeof InspectionSchema>;

export default function SafetyInspectionPage() {
  const { users, addSafetyInspection } = useAppState();
  const { user: authUser } = useAuth();
  const { toast } = useToast();
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [evidencePhotos, setEvidencePhotos] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const assignableUsers = useMemo(() => {
    return users.filter(u => ['supervisor', 'administrador'].includes(u.role));
  }, [users]);
  
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<InspectionFormData>({
    resolver: zodResolver(InspectionSchema),
    defaultValues: {
      work: 'File 721', // Default value
    }
  });


  const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
        const file = event.target.files[0];
        const reader = new FileReader();
        
        reader.onload = (e) => {
            if (typeof e.target?.result === 'string') {
                const img = document.createElement('img');
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 800;
                    const MAX_HEIGHT = 800;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return;
                    
                    ctx.drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

                    setEvidencePhotos(prev => [...prev, dataUrl]);
                };
                img.src = e.target.result;
            }
        };
        reader.readAsDataURL(file);
        event.target.value = ''; // Reset input
    }
  };

  const removePhoto = (index: number) => {
    setEvidencePhotos(prev => prev.filter((_, i) => i !== index));
  };
  
  const onSubmit: SubmitHandler<InspectionFormData> = async (data) => {
      if (evidencePhotos.length === 0) {
          toast({ variant: 'destructive', title: 'Error', description: 'Debes adjuntar al menos una foto de evidencia.' });
          return;
      }
      if (!authUser) {
          toast({ variant: 'destructive', title: 'Error', description: 'No se pudo identificar al inspector.' });
          return;
      }

      setIsSubmitting(true);
      try {
          await addSafetyInspection({
              ...data,
              evidencePhotos,
              inspectorId: authUser.id,
              inspectorName: authUser.name,
              inspectorRole: authUser.role,
          });
          toast({ title: 'Inspección Registrada', description: 'La tarea ha sido asignada al responsable.' });
          reset();
          setEvidencePhotos([]);
      } catch (error: any) {
           toast({ variant: 'destructive', title: 'Error al Registrar', description: error.message || 'No se pudo guardar la inspección.' });
      } finally {
          setIsSubmitting(false);
      }
  };


  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8">
      <PageHeader
        title="Nueva Inspección de Seguridad"
        description="Reporta una observación de seguridad, asigna un responsable y un plan de acción."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Columna Izquierda - PARTE 1 */}
        <div className="lg:col-span-2 space-y-8">
            <Card>
                <CardHeader>
                    <CardTitle>Parte 1: Reporte de Observación</CardTitle>
                    <CardDescription>Llenado por APR, Administrador de Obra o Jefe de Bodega.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div className="space-y-2">
                            <Label htmlFor="work">Obra</Label>
                            <Input id="work" {...register('work')} />
                            {errors.work && <p className="text-xs text-destructive">{errors.work.message}</p>}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="location">Ubicación Específica (Opcional)</Label>
                            <Input id="location" placeholder="Ej: Sector grúas, Bodega N°3" {...register('location')} />
                        </div>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="description">Descripción de la Observación</Label>
                        <Textarea id="description" placeholder="Detalla la condición o acto inseguro observado..." {...register('description')} />
                        {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="riskLevel">Nivel de Riesgo</Label>
                        <Controller
                            name="riskLevel"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger><SelectValue placeholder="Selecciona el riesgo..." /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="leve">Leve</SelectItem>
                                        <SelectItem value="grave">Grave</SelectItem>
                                        <SelectItem value="fatal">Fatal</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                        {errors.riskLevel && <p className="text-xs text-destructive">{errors.riskLevel.message}</p>}
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="actionPlan">Plan de Acción Inmediato</Label>
                        <Textarea id="actionPlan" placeholder="Describe la medida correctiva que se debe tomar..." {...register('actionPlan')} />
                        {errors.actionPlan && <p className="text-xs text-destructive">{errors.actionPlan.message}</p>}
                    </div>
                    <div className="space-y-2">
                        <Label>Evidencia Fotográfica</Label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                            {evidencePhotos.map((photo, index) => (
                                <div key={index} className="relative group aspect-square">
                                    <Image src={photo} alt={`Evidencia ${index + 1}`} layout="fill" className="object-cover rounded-md" />
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="icon"
                                        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => removePhoto(index)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                        <Button type="button" variant="outline" onClick={() => cameraInputRef.current?.click()}>
                            <Camera className="mr-2 h-4 w-4" /> Añadir Foto
                        </Button>
                        <input
                            ref={cameraInputRef}
                            type="file" accept="image/*" capture="environment"
                            onChange={handlePhotoUpload} className="hidden"
                        />
                    </div>
                </CardContent>
            </Card>
        </div>
        
        {/* Columna Derecha - PARTE 2 */}
        <div className="lg:col-span-1 space-y-8">
             <Card>
                <CardHeader>
                    <CardTitle>Parte 2: Asignación y Cierre</CardTitle>
                    <CardDescription>Asigna un responsable y una fecha límite para resolver la observación.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                     <div className="space-y-2">
                        <Label htmlFor="assignedTo">Asignar a Responsable</Label>
                        <Controller
                            name="assignedTo"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger><SelectValue placeholder="Selecciona un responsable..." /></SelectTrigger>
                                    <SelectContent>
                                        {assignableUsers.map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.role === 'administrador' ? 'Director' : 'Supervisor'})</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                         {errors.assignedTo && <p className="text-xs text-destructive">{errors.assignedTo.message}</p>}
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="deadline">Fecha Límite de Cumplimiento</Label>
                         <Controller
                            name="deadline"
                            control={control}
                            render={({ field }) => (
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant={"outline"}
                                            className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}
                                        >
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {field.value ? format(field.value, "PPP", { locale: es }) : <span>Selecciona una fecha</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <Calendar mode="single" selected={field.value || undefined} onSelect={field.onChange} initialFocus />
                                    </PopoverContent>
                                </Popover>
                            )}
                        />
                         {errors.deadline && <p className="text-xs text-destructive">{errors.deadline.message}</p>}
                    </div>
                     <Button type="submit" className="w-full" disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                        Registrar y Notificar
                    </Button>
                </CardContent>
            </Card>
        </div>
      </div>
    </form>
  );
}
