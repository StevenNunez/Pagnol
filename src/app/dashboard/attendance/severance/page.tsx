
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import dynamic from 'next/dynamic';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { Loader2, Calculator, ChevronsUpDown, Check, Calendar as CalendarIcon, FileDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { differenceInDays, differenceInMonths, differenceInYears, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Checkbox } from '@/components/ui/checkbox';
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { User } from '@/modules/core/lib/data';

const Calendar = dynamic(() => import('@/components/ui/calendar').then(mod => mod.Calendar), { ssr: false });


const severanceSchema = z.object({
  workerId: z.string({ required_error: 'Debes seleccionar un trabajador.' }),
  lastSalary: z.coerce.number().min(1, 'El sueldo es requerido.'),
  startDate: z.date({ required_error: 'La fecha de inicio es requerida.' }),
  endDate: z.date({ required_error: 'La fecha de término es requerida.' }),
  terminationCause: z.string({ required_error: 'La causal de término es requerida.' }),
  noticeGiven: z.boolean().default(false),
  vacationDaysTaken: z.coerce.number().min(0, 'Los días tomados no pueden ser negativos.').default(0),
});

type SeveranceFormData = z.infer<typeof severanceSchema>;

const TERMINATION_CAUSES = {
    'necesidades_empresa': 'Art. 161 inc. 1: Necesidades de la empresa',
    'desahucio': 'Art. 161 inc. 2: Desahucio del empleador',
    'mutuo_acuerdo': 'Art. 159 n° 1: Mutuo acuerdo de las partes',
    'renuncia': 'Art. 159 n° 2: Renuncia del trabajador',
    'vencimiento_plazo': 'Art. 159 n° 4: Vencimiento del plazo convenido',
    'conclusion_trabajo': 'Art. 159 n° 5: Conclusión del trabajo o servicio',
};

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(Math.round(value));
};

export default function SeverancePage() {
    const { users, currentTenant } = useAppState();
    const { toast } = useToast();
    const [workerPopoverOpen, setWorkerPopoverOpen] = useState(false);
    const [calculationResult, setCalculationResult] = useState<any>(null);

    const { control, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<SeveranceFormData>({
        resolver: zodResolver(severanceSchema),
        defaultValues: {
            lastSalary: 0,
            startDate: new Date(),
            endDate: new Date(),
            terminationCause: '',
            noticeGiven: false,
            vacationDaysTaken: 0,
        }
    });

    const selectedWorkerId = watch('workerId');
    const selectedWorker = useMemo(() => (users || []).find((u: User) => u.id === selectedWorkerId), [selectedWorkerId, users]);

    useEffect(() => {
        if (selectedWorker) {
            if (selectedWorker.fechaIngreso) {
                const startDate = new Date(selectedWorker.fechaIngreso as any);
                setValue('startDate', startDate);
            }
        }
    }, [selectedWorker, setValue]);
    
    const onSubmit = (data: SeveranceFormData) => {
        const { startDate, endDate, lastSalary, terminationCause, noticeGiven, vacationDaysTaken } = data;

        const yearsOfService = differenceInYears(endDate, startDate);
        const monthsRemainder = differenceInMonths(endDate, startDate) % 12;
        let computedYears = yearsOfService;
        if (monthsRemainder >= 6) {
            computedYears += 1;
        }

        const yearsForIndemnity = Math.min(computedYears, 11);
        
        const paysNoticeIndemnity = ['necesidades_empresa', 'desahucio'].includes(terminationCause) && !noticeGiven;
        const paysYearsIndemnity = ['necesidades_empresa', 'desahucio'].includes(terminationCause);
        
        const indemnityPerYear = paysYearsIndemnity ? lastSalary * yearsForIndemnity : 0;
        
        const noticeIndemnity = paysNoticeIndemnity ? lastSalary : 0;

        const totalDaysWorked = differenceInDays(endDate, startDate) + 1;
        const totalVacationDaysEarned = (totalDaysWorked / 365) * 15;
        const pendingVacationDays = Math.max(0, totalVacationDaysEarned - vacationDaysTaken);
        const vacationPay = (lastSalary / 30) * pendingVacationDays;

        const totalSeverance = indemnityPerYear + noticeIndemnity + vacationPay;
        
        setCalculationResult({
            indemnityPerYear,
            noticeIndemnity,
            vacationPay,
            totalSeverance,
            yearsForIndemnity,
            pendingVacationDays
        });
    };
    
    const handleGeneratePDF = async () => {
        if (!calculationResult || !selectedWorker) {
            toast({ title: "Error", description: "Calcula el finiquito primero y selecciona un trabajador.", variant: "destructive" });
            return;
        }

        const doc = new jsPDF();
        const COLORS = { primary: '#2980b9', text: '#34495e' };
        
        try {
            const response = await fetch('/logo.png');
            const blob = await response.blob();
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const base64data = reader.result;

                doc.addImage(base64data as string, 'PNG', 15, 15, 30, 15);
                doc.setFontSize(16);
                doc.setFont('helvetica', 'bold');
                doc.text('FINIQUITO DE CONTRATO DE TRABAJO', doc.internal.pageSize.getWidth() / 2, 25, { align: 'center' });

                autoTable(doc, {
                  startY: 40,
                  theme: "plain",
                  styles: { fontSize: 9 },
                  body: [
                    ["Razón Social:", currentTenant?.name || 'N/A', "Nombre Trabajador:", selectedWorker.name],
                    ["RUT:", "—", "RUT Trabajador:", selectedWorker.rut || 'N/A'],
                    ["Dirección:", "—", "Fecha Ingreso:", format(watch('startDate'), "dd/MM/yyyy")],
                    ["", "", "Fecha Término:", format(watch('endDate'), "dd/MM/yyyy")],
                  ],
                });

                autoTable(doc, {
                    head: [['CONCEPTO', 'MONTO']],
                    body: [
                        [`Indemnización por ${calculationResult.yearsForIndemnity} Años de Servicio`, formatCurrency(calculationResult.indemnityPerYear)],
                        ['Indemnización Sustitutiva del Aviso Previo', formatCurrency(calculationResult.noticeIndemnity)],
                        [`Feriado Proporcional (${calculationResult.pendingVacationDays.toFixed(2)} días)`, formatCurrency(calculationResult.vacationPay)],
                        [{ content: 'TOTAL FINIQUITO', styles: { fontStyle: 'bold' } }, { content: formatCurrency(calculationResult.totalSeverance), styles: { fontStyle: 'bold' } }],
                    ],
                    startY: (doc as any).lastAutoTable.finalY + 5,
                    theme: 'grid',
                    styles: { fontSize: 10 },
                    headStyles: { fillColor: COLORS.primary }
                });

                const finalY = (doc as any).lastAutoTable.finalY;
                doc.setFontSize(10);
                const text = `A ${format(new Date(), "d 'de' MMMM 'de' yyyy", { locale: es })}, ${selectedWorker.name}, RUT ${selectedWorker.rut || 'N/A'}, declara haber recibido de ${currentTenant?.name || 'la empresa'}, la suma de ${formatCurrency(calculationResult.totalSeverance)}, por concepto del total de los haberes que le corresponden por el término de su contrato de trabajo. Declara, asimismo, no tener reclamo alguno que formular en contra de la empresa.`;
                const splitText = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - 30);
                doc.text(splitText, 15, finalY + 15);

                doc.text('_________________________', 40, finalY + 60);
                doc.text('Firma Trabajador', 50, finalY + 65);
                
                doc.text('_________________________', doc.internal.pageSize.getWidth() - 100, finalY + 60);
                doc.text('Firma Empleador', doc.internal.pageSize.getWidth() - 90, finalY + 65);
                
                doc.save(`Finiquito_${selectedWorker.name.replace(/\s/g, '_')}.pdf`);
            };
        } catch (e) {
            console.error(e);
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo cargar el logo para el PDF.' });
        }
    };


    return (
        <div className="flex flex-col gap-8">
            <PageHeader title="Generador de Finiquito" description="Calcula el finiquito de un trabajador según la normativa chilena actualizada." />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle>Datos para el Cálculo</CardTitle>
                        <CardDescription>Ingresa la información del trabajador y el término de contrato.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                            <Controller
                                name="workerId"
                                control={control}
                                render={({ field }) => (
                                    <div className="space-y-2">
                                        <Label>Trabajador</Label>
                                        <Popover open={workerPopoverOpen} onOpenChange={setWorkerPopoverOpen}>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" role="combobox" className="w-full justify-between">
                                                    <span className="truncate">{(users || []).find((u: User) => u.id === field.value)?.name || "Selecciona un trabajador..."}</span>
                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                                <Command>
                                                    <CommandInput placeholder="Buscar trabajador..." />
                                                    <CommandList>
                                                        <CommandEmpty>No se encontró el trabajador.</CommandEmpty>
                                                        <CommandGroup>
                                                            {(users || []).filter((u: User) => u.role !== 'guardia').map((user: User) => (
                                                                <CommandItem key={user.id} value={user.name} onSelect={() => { field.onChange(user.id); setWorkerPopoverOpen(false); }}>
                                                                    <Check className={cn("mr-2 h-4 w-4", field.value === user.id ? "opacity-100" : "opacity-0")} />
                                                                    {user.name}
                                                                </CommandItem>
                                                            ))}
                                                        </CommandGroup>
                                                    </CommandList>
                                                </Command>
                                            </PopoverContent>
                                        </Popover>
                                        {errors.workerId && <p className="text-xs text-destructive">{errors.workerId.message}</p>}
                                    </div>
                                )}
                            />

                            <div className="grid grid-cols-2 gap-4">
                                <Controller name="startDate" control={control} render={({ field }) => ( <div className="space-y-2"><Label>Fecha Inicio Contrato</Label><Popover><PopoverTrigger asChild><Button variant="outline" className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4" />{field.value ? format(field.value, 'dd/MM/yyyy') : "Selecciona"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} /></PopoverContent></Popover>{errors.startDate && <p className="text-xs text-destructive">{errors.startDate.message}</p>}</div> )} />
                                <Controller name="endDate" control={control} render={({ field }) => ( <div className="space-y-2"><Label>Fecha Término Contrato</Label><Popover><PopoverTrigger asChild><Button variant="outline" className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4" />{field.value ? format(field.value, 'dd/MM/yyyy') : "Selecciona"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} /></PopoverContent></Popover>{errors.endDate && <p className="text-xs text-destructive">{errors.endDate.message}</p>}</div> )} />
                            </div>

                            <Controller name="lastSalary" control={control} render={({ field }) => ( <div className="space-y-2"><Label>Última Remuneración Mensual Imponible</Label><Input type="number" placeholder="Ej: 650000" {...field} />{errors.lastSalary && <p className="text-xs text-destructive">{errors.lastSalary.message}</p>}</div> )} />
                            <Controller name="vacationDaysTaken" control={control} render={({ field }) => ( <div className="space-y-2"><Label>Días de Vacaciones Tomados</Label><Input type="number" placeholder="0" {...field} />{errors.vacationDaysTaken && <p className="text-xs text-destructive">{errors.vacationDaysTaken.message}</p>}</div> )} />
                            <Controller name="terminationCause" control={control} render={({ field }) => ( <div className="space-y-2"><Label>Causal de Término</Label><Select onValueChange={field.onChange} value={field.value}><SelectTrigger><SelectValue placeholder="Selecciona una causal..." /></SelectTrigger><SelectContent>{Object.entries(TERMINATION_CAUSES).map(([key, value]) => <SelectItem key={key} value={key}>{value}</SelectItem>)}</SelectContent></Select>{errors.terminationCause && <p className="text-xs text-destructive">{errors.terminationCause.message}</p>}</div> )} />
                             <Controller
                                name="noticeGiven"
                                control={control}
                                render={({ field }) => (
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="noticeGiven"
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                    <Label htmlFor="noticeGiven">¿Se dio aviso previo de 30 días?</Label>
                                </div>
                                )}
                            />
                            
                            <Button type="submit" className="w-full" disabled={isSubmitting}>
                                {isSubmitting ? <Loader2 className="mr-2 animate-spin" /> : <Calculator className="mr-2" />}
                                Calcular Finiquito
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                <Card className="lg:col-span-2">
                    <CardHeader className="flex flex-row items-start justify-between">
                        <div>
                            <CardTitle>Resultado del Finiquito</CardTitle>
                            <CardDescription>Desglose de los montos calculados.</CardDescription>
                        </div>
                        {calculationResult && <Button variant="outline" onClick={handleGeneratePDF}><FileDown className="mr-2"/>Descargar PDF</Button>}
                    </CardHeader>
                    <CardContent>
                        {calculationResult ? (
                            <div className="space-y-4 text-sm">
                                <div className="flex justify-between items-center bg-muted p-3 rounded-lg">
                                    <span className="font-semibold">Indemnización por Años de Servicio ({calculationResult.yearsForIndemnity} años)</span>
                                    <span className="font-bold text-base">{formatCurrency(calculationResult.indemnityPerYear)}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 rounded-lg">
                                    <span className="font-semibold">Indemnización Sustitutiva del Aviso Previo</span>
                                    <span>{formatCurrency(calculationResult.noticeIndemnity)}</span>
                                </div>
                                <div className="flex justify-between items-center bg-muted p-3 rounded-lg">
                                    <span className="font-semibold">Feriado Proporcional ({calculationResult.pendingVacationDays.toFixed(2)} días)</span>
                                    <span className="font-bold text-base">{formatCurrency(calculationResult.vacationPay)}</span>
                                </div>
                                <div className="border-t pt-4 mt-4 flex justify-between items-center text-lg">
                                    <span className="font-bold text-primary">TOTAL FINIQUITO A PAGAR</span>
                                    <span className="font-extrabold text-primary text-2xl">{formatCurrency(calculationResult.totalSeverance)}</span>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center text-muted-foreground py-16">
                                <p>Ingresa los datos en el formulario para ver el cálculo del finiquito.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
