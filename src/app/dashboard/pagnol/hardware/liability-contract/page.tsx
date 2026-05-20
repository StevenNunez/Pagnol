"use client";

import React, { useState, useCallback } from "react";
import { useAuth } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Shield,
  CheckCircle2,
  AlertCircle,
  Download,
  Eye,
  DollarSign,
  Calendar,
  Zap,
  Loader2,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import jsPDF from "jspdf";
import "jspdf-autotable";

const LiabilityContractPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [showPreview, setShowPreview] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleDownloadPDF = useCallback(async () => {
    setIsGenerating(true);
    try {
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 20;

      // Header
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageW, 40, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("PAGNOL ASSET MANAGEMENT", margin, 18);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text("CONTRATO DE RESPONSABILIDAD — HARDWARE OPERATIVO", margin, 28);
      doc.setFontSize(8);
      doc.text(`Generado: ${new Date().toLocaleDateString("es-CL")} — ${currentUser?.name || "Administrador"}`, margin, 36);

      doc.setTextColor(15, 23, 42);

      let y = 55;
      const addSection = (title: string, content: string[]) => {
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text(title.toUpperCase(), margin, y);
        y += 6;
        doc.setDrawColor(230, 130, 0);
        doc.setLineWidth(0.5);
        doc.line(margin, y, pageW - margin, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        content.forEach(line => {
          const wrapped = doc.splitTextToSize(line, pageW - margin * 2);
          doc.text(wrapped, margin, y);
          y += wrapped.length * 5 + 2;
        });
        y += 4;
      };

      addSection("1. Objeto del Contrato", [
        "Este contrato establece los términos de cobertura de responsabilidad civil para el hardware entregado por PAGNOL Asset Management al personal autorizado de la faena.",
      ]);

      addSection("2. Vigencia", [
        "La cobertura es válida por 12 meses desde la fecha de entrega del dispositivo, renovable anualmente mediante acuerdo escrito entre las partes.",
      ]);

      addSection("3. Cobertura Incluida", [
        "• Daños accidentales por caída o golpe durante operación normal.",
        "• Daño por exposición accidental a agua u otros líquidos.",
        "• Robo o hurto del dispositivo debidamente denunciado.",
        "• Reemplazo por dispositivo equivalente o de mayor especificación técnica.",
      ]);

      addSection("4. Exclusiones", [
        "• Daño intencional o uso negligente.",
        "• Falta de cumplimiento de mantenimiento preventivo según manual.",
        "• Uso fuera de las especificaciones técnicas del fabricante.",
        "• Modificación no autorizada del dispositivo o sus componentes.",
        "• Pérdida por desastres naturales o causas de fuerza mayor.",
        "• Almacenamiento inadecuado fuera del área de operaciones.",
      ]);

      addSection("5. Responsabilidad del Empleado", [
        "• Cuidado y custodia adecuada del dispositivo asignado.",
        "• Cumplimiento estricto del manual de usuario Pagnol.",
        "• Reporte inmediato de daño o robo (máximo 24 horas).",
        "• Devolución del dispositivo al término del contrato o la relación laboral.",
      ]);

      addSection("6. Proceso de Reclamación", [
        "1. Notificar el incidente dentro de 24 horas a través del portal Pagnol.",
        "2. Proporcionar fotos, descripción del incidente y número de serie del dispositivo.",
        "3. Evaluación por el equipo Pagnol (24-48 horas hábiles).",
        "4. Reemplazo o reembolso según corresponda, descontado el deducible.",
      ]);

      // Cost table
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("7. ESTRUCTURA DE COSTOS Y DEDUCIBLES", margin, y);
      y += 6;
      doc.setDrawColor(230, 130, 0);
      doc.line(margin, y, pageW - margin, y);
      y += 4;

      (doc as any).autoTable({
        startY: y,
        head: [["Dispositivo", "Costo (USD)", "Prima Anual", "%", "Deducible"]],
        body: costStructure.map(r => [
          r.device,
          `$${r.unitCost.toLocaleString("es-CL")}`,
          `$${r.premium.toLocaleString("es-CL")}`,
          `${r.premiumPercent}%`,
          `$${r.deductible.toLocaleString("es-CL")}`,
        ]),
        theme: "striped",
        headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold", fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        margin: { left: margin, right: margin },
      });

      y = (doc as any).lastAutoTable.finalY + 16;

      addSection("8. Resolución de Conflictos", [
        "Cualquier disputa será resuelta mediante arbitraje según las leyes de la República de Chile, sin perjuicio de los derechos del consumidor establecidos en la Ley 19.496.",
      ]);

      // Signature section
      if (y > 230) { doc.addPage(); y = 20; }
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("FIRMAS", margin, y);
      y += 8;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      const sigW = (pageW - margin * 2 - 20) / 2;
      doc.rect(margin, y, sigW, 30);
      doc.rect(margin + sigW + 20, y, sigW, 30);
      doc.text("Representante PAGNOL", margin + 4, y + 35);
      doc.text("Empleado / Responsable", margin + sigW + 24, y + 35);
      y += 40;
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`PAGNOL Asset Management — Documento generado digitalmente el ${new Date().toLocaleString("es-CL")}`, margin, y + 10);

      doc.save(`Pagnol_Contrato_Responsabilidad_${new Date().toISOString().split("T")[0]}.pdf`);
    } finally {
      setIsGenerating(false);
    }
  }, [currentUser]);

  const contractTerms = [
    {
      category: "Cobertura",
      icon: Shield,
      items: [
        { label: "Daños Accidentales", coverage: "Sí" },
        { label: "Robo o Hurto", coverage: "Sí" },
        { label: "Daño por Agua", coverage: "Sí (Accidental)" },
        { label: "Daño por Golpe", coverage: "Sí" },
        { label: "Desgaste Normal", coverage: "No" },
        { label: "Uso Negligente", coverage: "No" },
      ],
    },
    {
      category: "Exclusiones",
      icon: AlertCircle,
      items: [
        { label: "Daño Intencional", coverage: "Excluido" },
        { label: "Falta de Mantenimiento", coverage: "Excluido" },
        { label: "Modificación No Autorizada", coverage: "Excluido" },
        { label: "Uso Fuera de Especificación", coverage: "Excluido" },
        { label: "Desastres Naturales", coverage: "Limitado" },
        { label: "Almacenamiento Inadecuado", coverage: "Excluido" },
      ],
    },
  ];

  const costStructure = [
    {
      device: "Pistola QR/Barras USB",
      unitCost: 2500,
      premium: 50,
      premiumPercent: 2,
      deductible: 250,
    },
    {
      device: "Pistola QR/Barras Bluetooth",
      unitCost: 3500,
      premium: 70,
      premiumPercent: 2,
      deductible: 350,
    },
    {
      device: "Impresora de Etiquetas",
      unitCost: 5000,
      premium: 100,
      premiumPercent: 2,
      deductible: 500,
    },
    {
      device: "Lector Biométrico",
      unitCost: 4000,
      premium: 80,
      premiumPercent: 2,
      deductible: 400,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Contrato de Responsabilidad"
        description="Términos y condiciones de cobertura para hardware entregado."
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-green-50 to-emerald-50">
          <CardContent className="p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-2">
                  Período
                </p>
                <p className="text-2xl font-black text-green-600">12 Meses</p>
              </div>
              <Calendar className="h-12 w-12 text-green-600 opacity-20" />
            </div>
            <p className="text-xs text-slate-600 mt-4">Renovable anualmente</p>
          </CardContent>
        </Card>

        <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-blue-50 to-indigo-50">
          <CardContent className="p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-2">
                  Prima Promedio
                </p>
                <p className="text-2xl font-black text-blue-600">2%</p>
              </div>
              <DollarSign className="h-12 w-12 text-blue-600 opacity-20" />
            </div>
            <p className="text-xs text-slate-600 mt-4">Del valor unitario anual</p>
          </CardContent>
        </Card>

        <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-orange-50 to-amber-50">
          <CardContent className="p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-2">
                  Tiempo de Proceso
                </p>
                <p className="text-2xl font-black text-orange-600">48 Horas</p>
              </div>
              <Zap className="h-12 w-12 text-orange-600 opacity-20" />
            </div>
            <p className="text-xs text-slate-600 mt-4">Para reclamaciones online</p>
          </CardContent>
        </Card>
      </div>

      {/* Coverage Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {contractTerms.map((section, idx) => (
          <Card key={idx} className="rounded-[2.5rem] border-none shadow-xl bg-slate-100">
            <CardHeader className="p-8">
              <CardTitle className="text-lg font-black uppercase flex items-center gap-3">
                <section.icon className="h-5 w-5 text-primary" />
                {section.category}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8">
              <div className="space-y-3">
                {section.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    className="flex justify-between items-center p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <span className="text-sm font-bold text-slate-700">{item.label}</span>
                    <span
                      className={`text-xs font-black px-3 py-1 rounded-md ${
                        item.coverage === "Sí"
                          ? "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300"
                          : item.coverage === "Excluido"
                          ? "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300"
                          : "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300"
                      }`}
                    >
                      {item.coverage}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cost Structure */}
      <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-100">
        <CardHeader className="p-8">
          <CardTitle className="text-lg font-black uppercase flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-primary" />
            Estructura de Costos
          </CardTitle>
          <CardDescription>Primas y deductibles por dispositivo</CardDescription>
        </CardHeader>
        <CardContent className="p-8">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left py-3 px-4 font-black text-slate-600 uppercase">Dispositivo</th>
                  <th className="text-right py-3 px-4 font-black text-slate-600 uppercase">Costo</th>
                  <th className="text-right py-3 px-4 font-black text-slate-600 uppercase">Prima Anual</th>
                  <th className="text-right py-3 px-4 font-black text-slate-600 uppercase">%</th>
                  <th className="text-right py-3 px-4 font-black text-slate-600 uppercase">Deducible</th>
                </tr>
              </thead>
              <tbody>
                {costStructure.map((row, idx) => (
                  <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-4 px-4 font-bold text-slate-900">{row.device}</td>
                    <td className="py-4 px-4 text-right font-mono text-slate-700">
                      ${row.unitCost.toLocaleString("es-CL")}
                    </td>
                    <td className="py-4 px-4 text-right font-bold text-green-600">
                      ${row.premium.toLocaleString("es-CL")}
                    </td>
                    <td className="py-4 px-4 text-right text-slate-600">{row.premiumPercent}%</td>
                    <td className="py-4 px-4 text-right font-mono text-slate-700">
                      ${row.deductible.toLocaleString("es-CL")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Process Flow */}
      <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-100">
        <CardHeader className="p-8">
          <CardTitle className="text-lg font-black uppercase">Proceso de Reclamación</CardTitle>
        </CardHeader>
        <CardContent className="p-8">
          <div className="space-y-4">
            {[
              {
                step: 1,
                title: "Notificar Incidente",
                description:
                  "Reporta el daño dentro de 24 horas a través del portal de reclamaciones",
              },
              {
                step: 2,
                title: "Documentación",
                description:
                  "Proporciona fotos, video y descripción detallada del incidente",
              },
              {
                step: 3,
                title: "Evaluación",
                description: "Nuestro equipo evalúa la cobertura (24-48 horas)",
              },
              {
                step: 4,
                title: "Resolución",
                description:
                  "Reemplazo o reembolso según corresponda (menos deducible)",
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-4 pb-4 last:pb-0">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary text-white font-black">
                    {item.step}
                  </div>
                </div>
                <div className="flex-grow">
                  <h4 className="font-bold text-sm text-slate-900">{item.title}</h4>
                  <p className="text-xs text-slate-600 mt-1">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Button
          onClick={() => setShowPreview(true)}
          variant="outline"
          className="flex-1 sm:flex-none h-12 rounded-xl font-black uppercase tracking-widest"
        >
          <Eye className="h-4 w-4 mr-2" /> Ver Contrato Completo
        </Button>

        <Button
          onClick={handleDownloadPDF}
          disabled={isGenerating}
          className="flex-1 sm:flex-none h-12 rounded-xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest"
        >
          {isGenerating ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generando...</>
          ) : (
            <><Download className="h-4 w-4 mr-2" /> Descargar PDF</>
          )}
        </Button>
      </div>

      {/* Contract Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="rounded-[2.5rem] max-h-[80vh] overflow-y-auto max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black uppercase">Contrato de Responsabilidad</DialogTitle>
            <DialogDescription>Leer términos y condiciones completos</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-slate-700 leading-relaxed">
            <section>
              <h3 className="font-black text-base mb-2 uppercase">1. Objeto del Contrato</h3>
              <p>
                Este contrato establece los términos de cobertura de responsabilidad civil para el hardware entregado
                por PAGNOL Asset Management al personal autorizado.
              </p>
            </section>

            <section>
              <h3 className="font-black text-base mb-2 uppercase">2. Vigencia</h3>
              <p>
                La cobertura es válida por 12 meses desde la fecha de entrega del dispositivo, renovable anualmente.
              </p>
            </section>

            <section>
              <h3 className="font-black text-base mb-2 uppercase">3. Cobertura Incluida</h3>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Daños accidentales por caída o golpe</li>
                <li>Daño por exposición a agua (accidental)</li>
                <li>Robo o hurto del dispositivo</li>
                <li>Reemplazo por dispositivo equivalente o de mayor especificación</li>
              </ul>
            </section>

            <section>
              <h3 className="font-black text-base mb-2 uppercase">4. Exclusiones</h3>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Daño intencional</li>
                <li>Falta de cumplimiento de mantenimiento preventivo</li>
                <li>Uso fuera de las especificaciones técnicas</li>
                <li>Modificación no autorizada del dispositivo</li>
                <li>Pérdida por desastres naturales</li>
                <li>Almacenamiento inadecuado</li>
              </ul>
            </section>

            <section>
              <h3 className="font-black text-base mb-2 uppercase">5. Proceso de Reclamación</h3>
              <p>
                Las reclamaciones deben ser notificadas dentro de 24 horas del incidente, adjuntando documento que
                acredite propiedad del dispositivo y descripción del daño.
              </p>
            </section>

            <section>
              <h3 className="font-black text-base mb-2 uppercase">6. Responsabilidad del Empleado</h3>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Cuidado y custodia adecuada del dispositivo</li>
                <li>Cumplimiento de manual de usuario</li>
                <li>Reporte inmediato de daño o robo</li>
                <li>Devolución del dispositivo al término del contrato</li>
              </ul>
            </section>

            <section>
              <h3 className="font-black text-base mb-2 uppercase">7. Deducible y Costos</h3>
              <p>
                El deducible es variable según el dispositivo y está especificado en la tabla de estructura de costos.
              </p>
            </section>

            <section>
              <h3 className="font-black text-base mb-2 uppercase">8. Resolución de Conflictos</h3>
              <p>
                Cualquier disputa será resuelta mediante arbitraje según las leyes de Chile, sin perjuicio de derechos
                del consumidor.
              </p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LiabilityContractPage;
