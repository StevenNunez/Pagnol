import * as React from 'react';
import { ArrowDown, CornerDownRight } from 'lucide-react';

/**
 * Diagrama del proceso de control de activos, dibujado con la grilla y los tokens
 * del sistema de diseño (nada de imágenes ni librerías): así respeta el modo oscuro
 * y se reordena solo en pantallas angostas.
 *
 * Las clases de color van en mapas estáticos — las construidas con template strings
 * se purgan en producción.
 */

type Tone = 'terreno' | 'gate' | 'panol' | 'compra' | 'dinero' | 'cierre';

const TONE_BOX: Record<Tone, string> = {
    terreno: 'border-info bg-info-subtle text-info-subtle-foreground',
    gate: 'border-warning bg-warning-subtle text-warning-subtle-foreground',
    panol: 'border-primary bg-primary/10 text-foreground',
    compra: 'border-border bg-muted text-foreground',
    dinero: 'border-success bg-success-subtle text-success-subtle-foreground',
    cierre: 'border-destructive/50 bg-destructive/10 text-foreground',
};

const TONE_LABEL: Record<Tone, string> = {
    terreno: 'text-info',
    gate: 'text-warning',
    panol: 'text-primary',
    compra: 'text-muted-foreground',
    dinero: 'text-success',
    cierre: 'text-destructive',
};

function Node({
    tone,
    step,
    title,
    detail,
}: {
    tone: Tone;
    step?: string;
    title: string;
    detail?: string;
}) {
    return (
        <div className={`rounded-[1.25rem] border-2 px-5 py-4 h-full ${TONE_BOX[tone]}`}>
            {step && (
                <p className={`text-[10px] font-black uppercase tracking-widest mb-1.5 ${TONE_LABEL[tone]}`}>
                    {step}
                </p>
            )}
            <p className="font-bold leading-snug text-balance">{title}</p>
            {detail && <p className="text-sm opacity-80 mt-1.5 leading-snug">{detail}</p>}
        </div>
    );
}

function Down({ label }: { label?: string }) {
    return (
        <div className="flex flex-col items-center gap-1 py-3" aria-hidden="true">
            {label && (
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    {label}
                </span>
            )}
            <ArrowDown className="h-5 w-5 text-muted-foreground" />
        </div>
    );
}

function LaneStep({ tone, text }: { tone: Tone; text: string }) {
    return (
        <div className="flex items-start gap-3">
            <CornerDownRight className={`h-4 w-4 shrink-0 mt-1 ${TONE_LABEL[tone]}`} aria-hidden="true" />
            <p className="text-sm leading-snug">{text}</p>
        </div>
    );
}

export function ProcessFlow() {
    return (
        <div className="rounded-[1.5rem] border bg-card p-6 sm:p-8">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-6">
                De la necesidad en terreno hasta que el equipo se da de baja
            </p>

            {/* Nivel 1 — las tres puertas */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Node tone="terreno" step="Paso 1" title="Pedido de material" detail="Hay stock en el pañol" />
                <Node tone="terreno" step="Paso 1" title="Pedido de compra" detail="No hay stock, o el ítem no existe" />
                <Node tone="terreno" step="Paso 1" title="Pedido de arriendo" detail="El equipo se arrienda" />
            </div>

            <Down label="Los tres pasan por el mismo lugar" />

            {/* Nivel 2 — el gate */}
            <Node
                tone="gate"
                step="Paso 2 · Aquí se filtra todo el gasto"
                title="El Administrador de Contratos autoriza"
                detail="Sin esa autorización, ni el pañol ni Abastecimiento ven el pedido. Si lo rechaza, queda cerrado con el motivo y la fecha."
            />

            <Down label="Se separa según lo que se pidió" />

            {/* Nivel 3 — las dos ramas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Rama material */}
                <div className="rounded-[1.25rem] border-2 border-primary bg-primary/5 p-5 space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                        Si hay stock en el pañol
                    </p>
                    <div className="space-y-3">
                        <Node tone="panol" step="Paso 3" title="Aprobación según qué tan crítico es el ítem" detail="Clase A, B o C" />
                        <LaneStep tone="panol" text="El pañolero aprueba B y C. La clase A la firma un jefe." />
                        <Node tone="panol" step="Paso 5" title="Entrega en el pañol" detail="Se verifica con la cara quién retira, o se autoriza una excepción" />
                        <LaneStep tone="panol" text="Queda quién entregó, quién recibió, cuándo y cómo se comprobó." />
                    </div>
                </div>

                {/* Rama compra */}
                <div className="rounded-[1.25rem] border-2 border-border bg-muted/40 p-5 space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        Si hay que comprar o arrendar
                    </p>
                    <div className="space-y-3">
                        <Node tone="compra" step="Paso 4" title="Se pide cotización, se compara y se emite la orden de compra" detail="La orden lleva el contrato y el centro de costo" />
                        <LaneStep tone="compra" text="Al confirmar un arriendo, el equipo entra al inventario como equipo arrendado." />
                        <Node tone="compra" step="Paso 8" title="Recepción contra la orden de compra" detail="Ingreso físico con fotos. Si el ítem no existía, aquí se crea." />
                        <LaneStep tone="compra" text="Se recibe contra lo que se pidió, no contra lo que llegó suelto." />
                    </div>
                </div>
            </div>

            <Down label="Los dos caminos terminan igual" />

            {/* Nivel 4 — kardex */}
            <Node
                tone="panol"
                step="Paso 6 · Todo queda anotado"
                title="Kardex y stock por contrato y por pañol"
                detail="Dos registros que tienen que dar lo mismo: la historia de cada movimiento y cuánto hay hoy, separado por contrato y por pañol."
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5">
                <Node tone="panol" step="Paso 7" title="Devolución" detail="El sistema calcula cuánto debe esa persona antes de aceptarla" />
                <Node tone="compra" step="Después" title="Mantención" detail="Preventiva, correctiva o por falla" />
                <Node tone="cierre" step="Después" title="Baja del equipo" detail="Se archiva, nunca se borra: su historia sigue disponible" />
            </div>

            <Down label="En paralelo, la plata" />

            {/* Nivel 5 — el costo */}
            <div className="rounded-[1.25rem] border-2 border-success bg-success-subtle/50 p-5 space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-success">
                    Pasos 9 y 10 · Cómo se anota el costo
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Node tone="dinero" step="Al emitir la orden" title="Comprometido" detail="Plata que ya está tomada, aunque no se haya gastado" />
                    <Node tone="dinero" step="Al recibir" title="Gastado" detail="La compra ya ocurrió" />
                    <Node tone="dinero" step="Al pagar la factura" title="Pagado" detail="La plata salió" />
                </div>
                <p className="text-sm text-success-subtle-foreground">
                    Los tres alimentan el presupuesto contra lo real y cuánto gana o pierde cada
                    contrato. Nada se edita ni se borra: una corrección se anota como un movimiento
                    en contra.
                </p>
            </div>
        </div>
    );
}
