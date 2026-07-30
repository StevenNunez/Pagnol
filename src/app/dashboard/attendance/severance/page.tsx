'use client';

// La calculadora de finiquito que vivía acá quedó RETIRADA (ADR-012).
//
// No persistía nada —el único registro de un finiquito emitido era el PDF que
// quedaba en la carpeta de Descargas de quien lo generó— y tenía cuatro defectos
// con consecuencia en plata:
//   1. Pagaba el feriado proporcional como si los días fueran CORRIDOS cuando la
//      ley los define HÁBILES (art. 67 y 69), en contra del trabajador.
//   2. No aplicaba el tope de 90 UF del art. 172 a la base de indemnización.
//   3. Contaba un año completo con fracción de exactamente 6 meses, cuando el
//      art. 163 exige fracción SUPERIOR a seis meses.
//   4. No contemplaba el feriado progresivo del art. 68.
//
// El módulo de Finiquitos lo reemplaza entero. Se conserva la ruta con este aviso
// para quien tenga el enlace guardado.

import Link from 'next/link';
import { PageShell } from '@/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, FileText, AlertTriangle } from 'lucide-react';

export default function SeveranceRetiredPage() {
    return (
        <PageShell
            title="Generador de Finiquito"
            description="Esta calculadora fue reemplazada por el módulo de Finiquitos."
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
                                Esta calculadora ya no emite finiquitos
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                No guardaba el documento y su cálculo tenía diferencias con la
                                normativa: pagaba el feriado proporcional en días hábiles en vez de
                                corridos, no aplicaba el tope legal de 90 UF a las indemnizaciones y
                                no consideraba el feriado progresivo.
                            </p>
                        </div>
                    </div>

                    <div className="rounded-xl border bg-card p-5">
                        <p className="text-sm text-foreground">
                            El módulo de <strong>Finiquitos</strong> lo reemplaza: toma la antigüedad
                            y la base de cálculo del contrato laboral, las vacaciones tomadas de la
                            asistencia y los anticipos pendientes, guarda el documento con su
                            snapshot y lo registra en el dominio financiero.
                        </p>
                        <Button asChild className="mt-4 rounded-[1.5rem] shadow-lg shadow-primary/10 transition hover:scale-105 active:scale-95">
                            <Link href="/dashboard/rrhh/finiquitos">
                                <FileText className="mr-2 h-4 w-4" />
                                Ir a Finiquitos
                                <ArrowRight className="ml-2 h-4 w-4" />
                            </Link>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </PageShell>
    );
}
