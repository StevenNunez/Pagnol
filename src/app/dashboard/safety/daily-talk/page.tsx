
"use client";

import React, { useState, useMemo, useRef } from "react";
import { useForm, Controller, useFieldArray, SubmitHandler } from "react-hook-form";
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
import { Loader2, Save, Calendar as CalendarIcon, Camera, Trash2, Users, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import SignaturePad from "@/components/signature-pad";
import Image from "next/image";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { User } from "@/modules/core/lib/data";
import { suggestMiningSafetyTalkTopic } from "@/actions/ask-ferro";

const attendeeSchema = z.object({
  id: z.string(),
  name: z.string(),
  rut: z.string().optional(),
  signed: z.boolean().default(false),
  signedAt: z.date().optional().nullable(),
  signature: z.string().optional().nullable(),
});


const FormSchema = z.object({
  obra: z.string().min(3, "La obra es requerida"),
  fecha: z.date({ required_error: "La fecha es requerida." }),
  asistentes: z.array(attendeeSchema).min(1, "Debes seleccionar al menos un asistente."),
  temas: z.string().min(10, "Debes describir los temas tratados."),
  firma: z.string().min(1, "La firma es requerida."),
  foto: z.string().optional(),
});

type FormData = z.infer<typeof FormSchema>;

export default function DailyTalkPage() {
  const { users, addDailyTalk } = useAppState();
  const { user: authUser } = useAuth();
  const { toast } = useToast();

  const signaturePadRef = useRef<any>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  
  const [isSuggesting, setIsSuggesting] = useState(false);
  
  const workers = useMemo(() => 
    (users || []).filter(u => u.role !== 'guardia')
    .sort((a,b) => a.name.localeCompare(b.name)), 
  [users]);

  const { control, handleSubmit, setValue, watch, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      obra: "File 721",
      fecha: new Date(),
      asistentes: [],
      temas: "",
      firma: "",
      foto: "",
    },
  });

  const { fields, replace } = useFieldArray({
    control,
    name: "asistentes",
  });
  
  const selectedAsistentes = watch('asistentes');
  const evidencePhoto = watch('foto');

  const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        if (typeof e.target?.result === 'string') {
          setValue('foto', e.target.result, { shouldValidate: true });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const removePhoto = () => {
    setValue('foto', '');
  };
  
  const handleSuggestTopic = async () => {
    setIsSuggesting(true);
    try {
        const response = await suggestMiningSafetyTalkTopic();
        if (response.ok && response.answer) {
            setValue('temas', response.answer, { shouldValidate: true });
            toast({ title: "Sugerencia generada", description: "Se ha insertado un tema para la charla." });
        } else {
            throw new Error(response.error || "No se pudo obtener sugerencia.");
        }
    } catch(e: any) {
        toast({ variant: 'destructive', title: 'Error de IA', description: e.message });
    } finally {
        setIsSuggesting(false);
    }
  };

  const onSubmit: SubmitHandler<FormData> = async (data) => {
     if (!authUser) {
      toast({ variant: "destructive", title: "Error", description: "No se pudo identificar al expositor." });
      return;
    }
    try {
      const attendeesWithSanitizedRut = data.asistentes.map(a => ({...a, rut: a.rut || ''}));
      
      const dataToSave = {
        ...data,
        fecha: data.fecha.toISOString(),
        asistentes: attendeesWithSanitizedRut,
        expositorId: authUser.id,
        expositorName: authUser.name,
      };

      await addDailyTalk(dataToSave as any);
      toast({
        title: "Charla Guardada y Asignada",
        description: "El registro fue guardado. Los asistentes deben firmar desde su propio perfil.",
      });
      reset();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error al Guardar",
        description: error.message || "No se pudo guardar el registro de la charla.",
      });
    }
  };
  
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8">
      <PageHeader
        title="Charla Diaria de Seguridad"
        description="Registra la charla de 5 minutos, los asistentes y los temas tratados."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Información de la Charla</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="obra">Obra</Label>
                <Input id="obra" {...control.register('obra')} />
                {errors.obra && <p className="text-xs text-destructive">{errors.obra.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Fecha de la Charla</Label>
                 <Controller
                    name="fecha"
                    control={control}
                    render={({ field }) => (
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {field.value ? format(field.value, "PPP", { locale: es }) : <span>Selecciona fecha</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent>
                        </Popover>
                    )}
                />
                 {errors.fecha && <p className="text-xs text-destructive">{errors.fecha.message}</p>}
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label>Expositor</Label>
                <Input value={authUser?.name || ''} readOnly disabled />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <CardTitle>Temas Tratados</CardTitle>
                    <Button type="button" variant="outline" size="sm" onClick={handleSuggestTopic} disabled={isSuggesting}>
                        {isSuggesting ? <Loader2 className="mr-2 h-3 w-3 animate-spin"/> : <Sparkles className="mr-2 h-3 w-3"/>}
                        Sugerir Tema con IA
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="Describe brevemente los puntos clave de la charla de seguridad..."
                {...control.register('temas')}
                className="h-32"
              />
              {errors.temas && <p className="text-xs text-destructive mt-2">{errors.temas.message}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
                <CardTitle>Foto de Evidencia</CardTitle>
                 <CardDescription>Adjunta una foto de la charla (opcional).</CardDescription>
            </CardHeader>
            <CardContent>
                {evidencePhoto ? (
                     <div className="relative group w-full max-w-sm aspect-video">
                        <Image src={evidencePhoto} alt="Evidencia de charla" layout="fill" className="object-cover rounded-md" />
                        <Button
                            type="button" variant="destructive" size="icon"
                            className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={removePhoto}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ) : (
                    <>
                    <Button type="button" variant="outline" onClick={() => cameraInputRef.current?.click()}>
                        <Camera className="mr-2 h-4 w-4" /> Tomar o Subir Foto
                    </Button>
                     <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handlePhotoUpload}
                        className="hidden"
                    />
                    </>
                )}
                 {errors.foto && <p className="text-xs text-destructive mt-2">{errors.foto.message}</p>}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Users/> Lista de Asistentes</CardTitle>
                </CardHeader>
                <CardContent>
                     <ScrollArea className="h-72 border rounded-md">
                        <div className="p-4 space-y-2">
                            {workers.map(worker => (
                                <div key={worker.id} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`worker-${worker.id}`}
                                        checked={selectedAsistentes.some(a => a.id === worker.id)}
                                        onCheckedChange={(checked) => {
                                            const newAsistentes = checked
                                                ? [...selectedAsistentes, {id: worker.id, name: worker.name, rut: worker.rut || '', signed: false, signedAt: null, signature: null}]
                                                : selectedAsistentes.filter(a => a.id !== worker.id);
                                            replace(newAsistentes);
                                        }}
                                    />
                                    <Label htmlFor={`worker-${worker.id}`} className="font-normal">{worker.name}</Label>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                    {errors.asistentes && <p className="text-xs text-destructive mt-2">{errors.asistentes.message}</p>}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Firma del Expositor</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="w-full h-40 border rounded-md bg-white">
                        <SignaturePad
                            ref={signaturePadRef}
                            onEnd={() => {
                                if (signaturePadRef.current) {
                                    setValue('firma', signaturePadRef.current.getTrimmedCanvas().toDataURL('image/png'), { shouldValidate: true });
                                }
                            }}
                        />
                    </div>
                    {errors.firma && <p className="text-xs text-destructive mt-2">{errors.firma.message}</p>}
                </CardContent>
            </Card>
        </div>
      </div>
      
       <div className="flex justify-end pt-4">
            <Button type="submit" size="lg" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                Guardar y Asignar Firmas
            </Button>
       </div>
    </form>
  );
}
