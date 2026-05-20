"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, ArrowLeft, Save, CircleUserRound, CalendarDays, Calendar as CalendarIcon, Camera, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import SignaturePad from "@/components/signature-pad";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { AssignedSafetyTask as AssignedChecklist, SafetyInspection as ChecklistItemType, User } from "@/modules/core/lib/data";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'N/A';
    const jsDate = date instanceof Date ? date : new Date(date as any);
    return format(jsDate, "d 'de' MMMM, yyyy", { locale: es });
};

export default function AssignedChecklistPage() {
    const params = useParams();
    const router = useRouter();
    const { assignedChecklists, users, isLoading, completeAssignedChecklist } = useAppState();
    const { user } = useAuth();
    const { toast } = useToast();
    
    const signaturePadRef = useRef<any>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    const checklistId = params.id as string;

    const checklist = useMemo(() => {
        if (!assignedChecklists) return null;
        return assignedChecklists.find(c => c.id === checklistId) || null;
    }, [assignedChecklists, checklistId]);

    const [checklistData, setChecklistData] = useState<AssignedChecklist | null>(checklist);

    useEffect(() => {
        setChecklistData(checklist);
    }, [checklist]);


    const handleItemChange = (itemIndex: number, field: keyof any, value: any) => {
        if (!checklistData) return;
        
        setChecklistData(prevData => {
            if (!prevData) return null;
            const newItems = [...(prevData.items || [])];
            const currentItem = { ...newItems[itemIndex] };

            if (field === 'yes' || field === 'no' || field === 'na') {
                (currentItem as any).yes = field === 'yes' ? value : false;
                (currentItem as any).no = field === 'no' ? value : false;
                (currentItem as any).na = field === 'na' ? value : false;
            } else {
                (currentItem as any)[field] = value;
            }
            
            newItems[itemIndex] = currentItem;
            return { ...prevData, items: newItems };
        });
    };

    const handleSignatureEnd = () => {
        if (!signaturePadRef.current) return;
        const signature = signaturePadRef.current.getTrimmedCanvas().toDataURL('image/png');
        setChecklistData(prevData => {
            if (!prevData) return null;
            const performedBy = prevData.performedBy || {};
            return {
                ...prevData,
                performedBy: {
                    ...performedBy,
                    name: user?.name || 'Desconocido',
                    role: 'Supervisor',
                    signature: signature,
                    date: new Date().toISOString(),
                }
            };
        });
    }

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
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.8); // Compress to 80% quality JPEG

                        setChecklistData(prevData => {
                            if (!prevData) return null;
                            return {
                                ...prevData,
                                evidencePhotos: [...(prevData.evidencePhotos || []), dataUrl]
                            };
                        });
                    };
                    img.src = e.target.result;
                }
            };
            reader.readAsDataURL(file);
        }
    };


    const removePhoto = (index: number) => {
        if (!checklistData || !checklistData.evidencePhotos) return;
        const newPhotos = checklistData.evidencePhotos.filter((_, i) => i !== index);
        setChecklistData({ ...checklistData, evidencePhotos: newPhotos });
    };

    const handleSave = async () => {
        if (!checklistData) return;
        
        const isEveryItemAnswered = (checklistData.items || []).every(item => (item as any).yes || (item as any).no || (item as any).na);
        if (!isEveryItemAnswered) {
            toast({ variant: 'destructive', title: 'Error', description: 'Debes responder a todos los ítems (Sí, No, o N/A).' });
            return;
        }
        if (!checklistData.performedBy?.signature) {
            toast({ variant: 'destructive', title: 'Error', description: 'La firma de conformidad es obligatoria.' });
            return;
        }
        if (!checklistData.evidencePhotos || checklistData.evidencePhotos.length === 0) {
            toast({ variant: 'destructive', title: 'Error', description: 'Debes adjuntar al menos una foto de evidencia.' });
            return;
        }

        try {
            await completeAssignedChecklist(checklistData);
            toast({ title: "Checklist Enviado", description: "El formulario ha sido guardado y enviado para su revisión." });
            router.push('/dashboard/safety/assigned-checklists');
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error al Guardar", description: error.message || "No se pudo guardar el formulario." });
        }
    };


    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    if (!checklistData) {
        return (
            <div>
                <Button variant="ghost" onClick={() => router.back()}><ArrowLeft className="mr-2"/> Volver</Button>
                <PageHeader title="Checklist no encontrado" description="El checklist que buscas no existe o no tienes permiso para verlo." />
            </div>
        );
    }
    
    return (
        <div className="flex flex-col gap-8">
            <div className="flex items-center gap-4">
                 <Button variant="outline" size="icon" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <PageHeader title={checklistData.templateTitle} description={`Completando para la obra: ${checklistData.area}`} className="mb-0"/>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Ítems a Verificar</CardTitle>
                    <CardDescription>Completa cada punto del checklist. Todos los campos son requeridos.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {(checklistData.items || []).map((item: any, index) => (
                        <div key={index} className="p-4 border rounded-lg space-y-4">
                            <p className="font-semibold">{index + 1}. {item.element}</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <RadioGroup 
                                    className="flex space-x-4 items-center" 
                                    value={item.yes ? 'yes' : item.no ? 'no' : item.na ? 'na' : ''}
                                    onValueChange={(val) => handleItemChange(index, val as any, true)}
                                >
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="yes" id={`yes-${index}`} />
                                        <Label htmlFor={`yes-${index}`}>Sí</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="no" id={`no-${index}`} />
                                        <Label htmlFor={`no-${index}`}>No</Label>
                                    </div>
                                     <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="na" id={`na-${index}`} />
                                        <Label htmlFor={`na-${index}`}>N/A</Label>
                                    </div>
                                </RadioGroup>
                                <div className="space-y-2">
                                    <Label>Responsable</Label>
                                    <Select 
                                        value={item.responsibleUserId} 
                                        onValueChange={(value) => handleItemChange(index, 'responsibleUserId', value)}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Asignar responsable..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {users.map(u => (
                                                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Fecha Cumplimiento</Label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant={"outline"}
                                                className={cn(
                                                "w-full justify-start text-left font-normal",
                                                !item.completionDate && "text-muted-foreground"
                                                )}
                                            >
                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                {item.completionDate ? format(item.completionDate instanceof Date ? item.completionDate : new Date(item.completionDate as any), "PPP", {locale: es}) : <span>Selecciona fecha</span>}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0">
                                            <Calendar
                                                mode="single"
                                                selected={item.completionDate instanceof Date ? item.completionDate : (item.completionDate ? new Date(item.completionDate as any) : undefined)}
                                                onSelect={(date) => handleItemChange(index, 'completionDate', date)}
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                     <CardTitle>Observaciones Generales</CardTitle>
                </CardHeader>
                <CardContent>
                    <Textarea 
                        placeholder="Añade cualquier observación adicional aquí..."
                        value={checklistData.observations || ''}
                        onChange={(e) => setChecklistData({ ...checklistData, observations: e.target.value })}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Evidencia Fotográfica</CardTitle>
                    <CardDescription>Adjunta al menos una foto como evidencia de la inspección.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        {checklistData.evidencePhotos && checklistData.evidencePhotos.map((photo, index) => (
                            <div key={index} className="relative group aspect-square">
                                <Image src={photo} alt={`Evidencia ${index + 1}`} layout="fill" className="object-cover rounded-md" />
                                <Button
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
                    <Button variant="outline" onClick={() => cameraInputRef.current?.click()}>
                        <Camera className="mr-2 h-4 w-4" />
                        Añadir Foto
                    </Button>
                    <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handlePhotoUpload}
                        className="hidden"
                    />
                </CardContent>
            </Card>

             <Card>
                <CardHeader>
                    <CardTitle>Firma de Conformidad</CardTitle>
                    <CardDescription>Firma en el recuadro para confirmar que has realizado la inspección.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="w-full h-48 border rounded-md bg-white relative">
                        <SignaturePad ref={signaturePadRef} onEnd={handleSignatureEnd}/>
                    </div>
                     {checklistData.performedBy?.signature && (
                        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground p-4 bg-muted rounded-md">
                           <div className="flex items-center gap-2">
                             <CircleUserRound className="h-4 w-4"/>
                             <p>Realizado por: <span className="font-semibold text-foreground">{checklistData.performedBy.name}</span></p>
                           </div>
                           <div className="flex items-center gap-2">
                             <CalendarDays className="h-4 w-4"/>
                             <p>Fecha: <span className="font-semibold text-foreground">{formatDate(checklistData.performedBy.date)}</span></p>
                           </div>
                        </div>
                    )}
                </CardContent>
            </Card>
            
            <div className="flex justify-end gap-4">
                 <Button variant="outline" onClick={() => router.back()}>Cancelar</Button>
                 <Button onClick={handleSave}><Save className="mr-2"/> Guardar y Enviar</Button>
            </div>

        </div>
    );
}
