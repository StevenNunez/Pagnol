'use client';

// La calculadora de liquidación que vivía acá quedó RETIRADA (ADR-011).
//
// Producía un PDF con aspecto de liquidación de sueldo a partir de constantes
// legales quemadas y desactualizadas —el tope de gratificación salía de un sueldo
// mínimo de $460.000, valor de 2023— y sin conceptos que la ley exige: tope
// imponible, impuesto único de segunda categoría, asignación familiar, AFC según
// el tipo de contrato y plan de Isapre. Además no descontaba las ausencias: las
// pintaba en rojo en pantalla y no las llevaba al cálculo.
//
// Nada de eso se corrigió acá porque el módulo de Remuneraciones ya lo reemplaza
// entero, con paramétrica versionada, planilla persistente y snapshot inmutable.
// Se deja esta pantalla en vez de borrar la ruta para que quien tenga el enlace
// guardado sepa a dónde ir, en lugar de encontrarse un 404 — o, peor, de seguir
// emitiendo documentos con cifras que ya no son las de la ley.

import Link from 'next/link';
import { PageShell } from '@/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, FileSpreadsheet, AlertTriangle } from 'lucide-react';

export default function MonthlyReportRetiredPage() {
    return (
        <PageShell
            title="Liquidación de Sueldo"
            description="Esta calculadora fue reemplazada por el módulo de Remuneraciones."
        >
            <Card className="rounded-[1.5rem] border-warning/40 bg-warning-subtle/40">
                <CardContent className="flex flex-col gap-6 p-8">
                    <div className="flex items-start gap-4">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warning-subtle">
                            <AlertTriangle className="h-6 w-6 text-warning-subtle-foreground" />
                        </span>
                        <div className="space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                Herramienta retirada
                            </p>
                            <h2 className="text-lg font-bold text-foreground">
                                Esta calculadora ya no emite liquidaciones
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                Calculaba con valores legales fijos que quedaron desactualizados y
                                omitía conceptos obligatorios —tope imponible, impuesto único,
                                asignación familiar y seguro de cesantía según el tipo de contrato—,
                                por lo que sus resultados no sirven para emitir un documento real.
                            </p>
                        </div>
                    </div>

                    <div className="rounded-xl border bg-card p-5">
                        <p className="text-sm text-foreground">
                            El módulo de <strong>Remuneraciones</strong> lo reemplaza: calcula con la
                            paramétrica legal vigente a la fecha de cada período, guarda la planilla
                            con su snapshot y genera el PDF de liquidación por trabajador.
                        </p>
                        <Button asChild className="mt-4 rounded-[1.5rem] shadow-lg shadow-primary/10 transition hover:scale-105 active:scale-95">
                            <Link href="/dashboard/rrhh/remuneraciones">
                                <FileSpreadsheet className="mr-2 h-4 w-4" />
                                Ir a Remuneraciones
                                <ArrowRight className="ml-2 h-4 w-4" />
                            </Link>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </PageShell>
    );
}
