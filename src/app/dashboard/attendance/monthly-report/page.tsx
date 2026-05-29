
"use client";

import React, { useState, useMemo, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { useMonthlyAttendance } from "@/modules/core/hooks/use-attendance";
import { es } from "date-fns/locale";
import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserSearch, FileDown, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/modules/core/hooks/use-toast";

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: format(new Date(0, i), "MMMM", { locale: es }),
}));
const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

const IMM_TOPE = 4.75; // Ingreso Mínimo Mensual para tope de gratificación
const SUELDO_MINIMO = 460000; // Valor de referencia, podría ser dinámico
const TOPE_GRATIFICACION_ANUAL = IMM_TOPE * SUELDO_MINIMO;
const TOPE_GRATIFICACION_MENSUAL = TOPE_GRATIFICACION_ANUAL / 12;

export default function MonthlyReportPage() {
  const { users, currentTenant } = useAppState();
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  // --- State for manual inputs ---
  const [sueldoBase, setSueldoBase] = useState(0);
  const [gratificacion, setGratificacion] = useState(0);
  const [calcularGratificacion, setCalcularGratificacion] = useState(true);
  const [valorHoraExtra, setValorHoraExtra] = useState(0);
  const [bonoResponsabilidad, setBonoResponsabilidad] = useState(0);
  const [aguinaldo, setAguinaldo] = useState(0);
  const [movilizacion, setMovilizacion] = useState(0);
  const [colacion, setColacion] = useState(0);
  const [afpPorcentaje, setAfpPorcentaje] = useState(10.77); // Default a una AFP común
  const [saludPorcentaje, setSaludPorcentaje] = useState(7.0);
  const [seguroCesantiaPorcentaje, setSeguroCesantiaPorcentaje] = useState(0.6);
  const [anticipo, setAnticipo] = useState(0);

  const selectedUser = useMemo(
    () => (users || []).find((u) => u.id === selectedUserId),
    [users, selectedUserId]
  );

  const { report, loading } = useMonthlyAttendance(
    selectedUserId,
    selectedYear,
    selectedMonth
  );

  useEffect(() => {
    setSueldoBase(0);
    setGratificacion(0);
    setValorHoraExtra(0);
    setBonoResponsabilidad(0);
    setAguinaldo(0);
    setMovilizacion(0);
    setColacion(0);
    setAfpPorcentaje(10.77);
    setSaludPorcentaje(7.0);
    setSeguroCesantiaPorcentaje(0.6);
    setAnticipo(0);
  }, [selectedUserId, selectedMonth, selectedYear]);

  const calculations = useMemo(() => {
    const sueldo = Number(sueldoBase) || 0;
    const factorHoraExtra = 1.5;
    const valorHoraNormal = sueldo / 180; // 44 horas semanales -> ~180 horas mensuales
    const valorHE = valorHoraExtra > 0 ? valorHoraExtra : valorHoraNormal * factorHoraExtra;
    const horasExtrasCalculadas = (report?.summary.totalOvertimeHoursNumber ?? 0) * valorHE;

    const gratificacionCalculada = calcularGratificacion
      ? Math.min((sueldo * 0.25), TOPE_GRATIFICACION_MENSUAL)
      : gratificacion;
    
    const otrosHaberesImponibles = bonoResponsabilidad + aguinaldo;
    const totalImponible = sueldo + gratificacionCalculada + horasExtrasCalculadas + otrosHaberesImponibles;

    const totalNoImponible = movilizacion + colacion;
    const totalHaberes = totalImponible + totalNoImponible;

    const descuentoAfp = (totalImponible * afpPorcentaje) / 100;
    const descuentoSalud = (totalImponible * saludPorcentaje) / 100;
    const descuentoSeguroCesantia = (totalImponible * seguroCesantiaPorcentaje) / 100;
    
    const totalDescuentosLegales = descuentoAfp + descuentoSalud + descuentoSeguroCesantia;
    const totalOtrosDescuentos = anticipo;
    const totalDescuentos = totalDescuentosLegales + totalOtrosDescuentos;

    const sueldoLiquido = totalHaberes - totalDescuentos;

    return {
      valorHE,
      horasExtrasCalculadas,
      gratificacionCalculada,
      totalImponible,
      totalNoImponible,
      totalHaberes,
      descuentoAfp,
      descuentoSalud,
      descuentoSeguroCesantia,
      totalDescuentosLegales,
      totalOtrosDescuentos,
      totalDescuentos,
      sueldoLiquido,
    };
  }, [
    sueldoBase, gratificacion, calcularGratificacion, bonoResponsabilidad, aguinaldo,
    report, valorHoraExtra, movilizacion, colacion, afpPorcentaje, saludPorcentaje,
    seguroCesantiaPorcentaje, anticipo
  ]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(Math.round(value));
  };
  
  const generatePDF = async () => {
    if (!selectedUser || !report) {
      toast({ variant: 'destructive', title: 'Error', description: 'Faltan datos para generar el PDF.' });
      return;
    }
    
    const doc = new jsPDF();
    const COLORS = { primary: '#2980b9', text: '#34495e', lightGray: '#ecf0f1' };
    
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
        doc.text('LIQUIDACIÓN DE SUELDO', doc.internal.pageSize.getWidth() / 2, 25, { align: 'center' });

        autoTable(doc, {
          startY: 40,
          theme: "plain",
          styles: { fontSize: 9 },
          body: [
            ["Razón Social:", currentTenant?.name || 'N/A', "Nombre Trabajador:", selectedUser.name],
            ["RUT:", "—", "RUT Trabajador:", selectedUser.rut || 'N/A'],
            ["Dirección:", "—", "Cargo:", selectedUser.cargo || 'N/A'],
            ["Período:", format(report.period.start, "MMMM yyyy", { locale: es }), "", ""],
          ],
        });

        autoTable(doc, {
            head: [['HABERES', 'MONTO']],
            body: [
              ['Sueldo Base', formatCurrency(sueldoBase)],
              ['Gratificación Legal', formatCurrency(calculations.gratificacionCalculada)],
              [`Horas Extras (${report.summary.totalOvertimeHours})`, formatCurrency(calculations.horasExtrasCalculadas)],
              ['Bono Responsabilidad', formatCurrency(bonoResponsabilidad)],
              ['Aguinaldo', formatCurrency(aguinaldo)],
              [{ content: 'Total Imponible', styles: { fontStyle: 'bold' } }, { content: formatCurrency(calculations.totalImponible), styles: { fontStyle: 'bold' } }],
              ['Movilización', formatCurrency(movilizacion)],
              ['Colación', formatCurrency(colacion)],
              [{ content: 'Total No Imponible', styles: { fontStyle: 'bold' } }, { content: formatCurrency(calculations.totalNoImponible), styles: { fontStyle: 'bold' } }],
              [{ content: 'TOTAL HABERES', styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } }, { content: formatCurrency(calculations.totalHaberes), styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } }],
            ],
            startY: (doc as any).lastAutoTable.finalY + 2,
            theme: 'grid',
            styles: { fontSize: 9 },
            headStyles: { fillColor: COLORS.primary }
        });

        autoTable(doc, {
            head: [['DESCUENTOS', 'MONTO']],
            body: [
              [`Cotización AFP (${afpPorcentaje.toFixed(2)}%)`, formatCurrency(calculations.descuentoAfp)],
              [`Cotización Salud (${saludPorcentaje.toFixed(2)}%)`, formatCurrency(calculations.descuentoSalud)],
              [`Seguro Cesantía (${seguroCesantiaPorcentaje.toFixed(2)}%)`, formatCurrency(calculations.descuentoSeguroCesantia)],
              [{ content: 'Total Descuentos Legales', styles: { fontStyle: 'bold' } }, { content: formatCurrency(calculations.totalDescuentosLegales), styles: { fontStyle: 'bold' } }],
              ['Anticipo Quincenal', formatCurrency(anticipo)],
              [{ content: 'Total Otros Descuentos', styles: { fontStyle: 'bold' } }, { content: formatCurrency(calculations.totalOtrosDescuentos), styles: { fontStyle: 'bold' } }],
              [{ content: 'TOTAL DESCUENTOS', styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } }, { content: formatCurrency(calculations.totalDescuentos), styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } }],
            ],
            startY: (doc as any).lastAutoTable.finalY,
            theme: 'grid',
            styles: { fontSize: 9 },
            headStyles: { fillColor: COLORS.primary }
        });

        autoTable(doc, {
            body: [
              [{ content: 'LÍQUIDO A PAGAR', styles: { fontStyle: 'bold', fontSize: 12 } }, { content: formatCurrency(calculations.sueldoLiquido), styles: { fontStyle: 'bold', fontSize: 12, halign: 'right' } }],
            ],
            startY: (doc as any).lastAutoTable.finalY,
            theme: 'grid',
        });
        
        const finalY = (doc as any).lastAutoTable.finalY;
        doc.setFontSize(8);
        doc.text('_________________________', doc.internal.pageSize.getWidth() / 2, finalY + 20, { align: 'center'});
        doc.text('Firma del Trabajador', doc.internal.pageSize.getWidth() / 2, finalY + 25, { align: 'center'});
        doc.text('Certifico que he recibido conforme el pago de mi remuneración y que el presente documento es el fiel reflejo de las operaciones ocurridas en el mes.', 15, finalY + 35, { maxWidth: doc.internal.pageSize.getWidth() - 30 });
        
        doc.save(`Liquidacion_${selectedUser.name.replace(/\s/g, '_')}_${selectedMonth}_${selectedYear}.pdf`);
      };
    } catch(e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo cargar el logo para el PDF.' });
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Calculadora de Liquidación de Sueldo"
        description="Genera un resumen mensual de asistencia y calcula la liquidación de sueldo."
      />

      <Card>
        <CardHeader>
          <CardTitle>Selección de Reporte</CardTitle>
          <CardDescription>
            Elige un trabajador y el período para generar el informe.
          </CardDescription>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            <Select value={selectedUserId || ""} onValueChange={setSelectedUserId}>
              <SelectTrigger><SelectValue placeholder="Selecciona un trabajador..." /></SelectTrigger>
              <SelectContent>
                {(users || [])
                  .filter((u) => u.role !== "guardia")
                  .map((user) => (<SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={String(selectedMonth)} onValueChange={(val) => setSelectedMonth(Number(val))}>
              <SelectTrigger><SelectValue placeholder="Selecciona un mes..." /></SelectTrigger>
              <SelectContent>{MONTHS.map((m) => (<SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>))}</SelectContent>
            </Select>
            <Select value={String(selectedYear)} onValueChange={(val) => setSelectedYear(Number(val))}>
              <SelectTrigger><SelectValue placeholder="Selecciona un año..." /></SelectTrigger>
              <SelectContent>{YEARS.map((y) => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}</SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>

      {!selectedUserId ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
              <UserSearch className="h-16 w-16 mb-4 mx-auto" />
              <h3 className="text-xl font-semibold">Selecciona un Trabajador</h3>
              <p className="mt-2">Elige a un trabajador para ver su reporte y calcular su liquidación.</p>
          </CardContent>
        </Card>
      ) : loading ? (
         <Card><CardContent className="p-12 text-center text-muted-foreground">
            <Loader2 className="h-12 w-12 animate-spin mb-4 mx-auto" />
            <p className="text-xl font-semibold">Cargando reporte...</p>
          </CardContent></Card>
      ) : (
        report && selectedUser && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                <div className="lg:col-span-1 space-y-8">
                    <Card>
                        <CardHeader><CardTitle>Resumen de Asistencia</CardTitle><CardDescription>Período: {format(report.period.start, "MMMM yyyy", { locale: es })}</CardDescription></CardHeader>
                        <CardContent className="grid grid-cols-2 gap-4 text-center">
                             <div className="p-2 bg-muted rounded-lg"><p className="text-xs text-muted-foreground">Días Hábiles</p><p className="text-xl font-bold">{report.summary.totalBusinessDays}</p></div>
                             <div className="p-2 bg-muted rounded-lg"><p className="text-xs text-muted-foreground">Días Trabajados</p><p className="text-xl font-bold">{report.summary.workedDays}</p></div>
                             <div className="p-2 bg-muted rounded-lg"><p className="text-xs text-muted-foreground">Ausencias</p><p className="text-xl font-bold text-red-500">{report.summary.absentDays}</p></div>
                             <div className="p-2 bg-muted rounded-lg"><p className="text-xs text-muted-foreground">Atrasos (min)</p><p className="text-xl font-bold text-amber-500">{report.summary.totalDelayMinutes}</p></div>
                             <div className="p-2 bg-muted rounded-lg col-span-2"><p className="text-xs text-muted-foreground">Horas Extras</p><p className="text-xl font-bold text-green-500">{report.summary.totalOvertimeHours}</p></div>
                        </CardContent>
                    </Card>
                    <Card><CardHeader><CardTitle>Datos para Cálculo</CardTitle><CardDescription>Ingresa los valores para la liquidación.</CardDescription></CardHeader>
                        <CardContent className="space-y-4">
                            <h4 className="font-semibold text-sm text-primary">Haberes</h4>
                            <div className="space-y-2"><Label htmlFor="sueldoBase">Sueldo Base</Label><Input id="sueldoBase" type="number" value={sueldoBase} onChange={e => setSueldoBase(Number(e.target.value))} /></div>
                            <div className="flex items-center space-x-2"><Switch id="calc-grat" checked={calcularGratificacion} onCheckedChange={setCalcularGratificacion} /><Label htmlFor="calc-grat">Calcular Gratificación Legal (25%)</Label></div>
                            {!calcularGratificacion && <div className="space-y-2"><Label htmlFor="gratificacion">Gratificación Manual</Label><Input id="gratificacion" type="number" value={gratificacion} onChange={e => setGratificacion(Number(e.target.value))} /></div>}
                            <div className="space-y-2"><Label htmlFor="bonoResponsabilidad">Bono Responsabilidad</Label><Input id="bonoResponsabilidad" type="number" value={bonoResponsabilidad} onChange={e => setBonoResponsabilidad(Number(e.target.value))} /></div>
                            <div className="space-y-2"><Label htmlFor="aguinaldo">Aguinaldo</Label><Input id="aguinaldo" type="number" value={aguinaldo} onChange={e => setAguinaldo(Number(e.target.value))} /></div>
                            <div className="space-y-2"><Label htmlFor="valorHoraExtra">Valor Hora Extra (si es distinto al legal)</Label><Input id="valorHoraExtra" type="number" value={valorHoraExtra} onChange={e => setValorHoraExtra(Number(e.target.value))} /></div>
                            <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="movilizacion">Movilización</Label><Input id="movilizacion" type="number" value={movilizacion} onChange={e => setMovilizacion(Number(e.target.value))} /></div><div className="space-y-2"><Label htmlFor="colacion">Colación</Label><Input id="colacion" type="number" value={colacion} onChange={e => setColacion(Number(e.target.value))} /></div></div>
                            <hr className="my-4"/><h4 className="font-semibold text-sm text-destructive">Descuentos</h4>
                            <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="afp">AFP (%)</Label><Input id="afp" type="number" step="0.01" value={afpPorcentaje} onChange={e => setAfpPorcentaje(Number(e.target.value))} /></div><div className="space-y-2"><Label htmlFor="salud">Salud (%)</Label><Input id="salud" type="number" step="0.01" value={saludPorcentaje} onChange={e => setSaludPorcentaje(Number(e.target.value))} /></div></div>
                            <div className="space-y-2"><Label htmlFor="seguroCesantia">Seguro Cesantía (%)</Label><Input id="seguroCesantia" type="number" step="0.01" value={seguroCesantiaPorcentaje} onChange={e => setSeguroCesantiaPorcentaje(Number(e.target.value))} /></div>
                            <div className="space-y-2"><Label htmlFor="anticipo">Anticipo Quincenal</Label><Input id="anticipo" type="number" value={anticipo} onChange={e => setAnticipo(Number(e.target.value))} /></div>
                        </CardContent>
                    </Card>
                </div>
                <Card className="lg:col-span-2">
                    <CardHeader className="flex flex-row justify-between items-start">
                        <div><CardTitle>Liquidación para {selectedUser.name}</CardTitle><CardDescription>Período: {format(report.period.start, "MMMM yyyy", { locale: es })}</CardDescription></div>
                        <Button onClick={generatePDF}><FileDown className="mr-2 h-4 w-4" />Descargar PDF</Button>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm">
                            <div className="space-y-2"><h3 className="font-bold text-lg border-b pb-2 mb-2">HABERES</h3>
                                <div className="flex justify-between"><span>Sueldo Base:</span> <span>{formatCurrency(sueldoBase)}</span></div>
                                <div className="flex justify-between"><span>Gratificación Legal:</span> <span>{formatCurrency(calculations.gratificacionCalculada)}</span></div>
                                <div className="flex justify-between"><span>Horas Extras ({report.summary.totalOvertimeHours}):</span> <span>{formatCurrency(calculations.horasExtrasCalculadas)}</span></div>
                                <div className="flex justify-between"><span>Bono Responsabilidad:</span> <span>{formatCurrency(bonoResponsabilidad)}</span></div>
                                <div className="flex justify-between"><span>Aguinaldo:</span> <span>{formatCurrency(aguinaldo)}</span></div>
                                <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Total Imponible:</span> <span>{formatCurrency(calculations.totalImponible)}</span></div>
                                <div className="flex justify-between pt-2"><span>Movilización:</span> <span>{formatCurrency(movilizacion)}</span></div>
                                <div className="flex justify-between"><span>Colación:</span> <span>{formatCurrency(colacion)}</span></div>
                                <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Total No Imponible:</span> <span>{formatCurrency(calculations.totalNoImponible)}</span></div>
                                <div className="flex justify-between font-bold text-lg bg-muted p-2 rounded-md mt-4"><span>TOTAL HABERES:</span> <span>{formatCurrency(calculations.totalHaberes)}</span></div>
                            </div>
                             <div className="space-y-2"><h3 className="font-bold text-lg border-b pb-2 mb-2">DESCUENTOS</h3>
                                <div className="flex justify-between"><span>Cotización AFP ({afpPorcentaje.toFixed(2)}%):</span> <span>{formatCurrency(calculations.descuentoAfp)}</span></div>
                                <div className="flex justify-between"><span>Cotización Salud ({saludPorcentaje.toFixed(2)}%):</span> <span>{formatCurrency(calculations.descuentoSalud)}</span></div>
                                <div className="flex justify-between"><span>Seguro Cesantía ({seguroCesantiaPorcentaje.toFixed(2)}%):</span> <span>{formatCurrency(calculations.descuentoSeguroCesantia)}</span></div>
                                <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Total Descuentos Legales:</span> <span>{formatCurrency(calculations.totalDescuentosLegales)}</span></div>
                                <div className="flex justify-between pt-2"><span>Anticipo Quincenal:</span> <span>{formatCurrency(anticipo)}</span></div>
                                <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Total Otros Descuentos:</span> <span>{formatCurrency(calculations.totalOtrosDescuentos)}</span></div>
                                <div className="flex justify-between font-bold text-lg bg-muted p-2 rounded-md mt-4"><span>TOTAL DESCUENTOS:</span> <span className="text-destructive">{formatCurrency(calculations.totalDescuentos)}</span></div>
                            </div>
                        </div>
                        <div className="pt-6 text-center"><h3 className="text-muted-foreground font-semibold">SUELDO LÍQUIDO A PAGAR</h3><p className="text-4xl font-bold text-primary tracking-tight">{formatCurrency(calculations.sueldoLiquido)}</p></div>
                    </CardContent>
                </Card>
            </div>
        )
      )}
    </div>
  );
}
