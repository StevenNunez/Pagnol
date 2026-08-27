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
                Flujo del proceso — de la necesidad a la baja
            </p>

            {/* Nivel 1 — las tres puertas */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Node tone="terreno" step="F1 · Terreno" title="Solicitud de Material" detail="Hay stock en el pañol" />
                <Node tone="terreno" step="F1 · Terreno" title="Solicitud de Compra" detail="No hay stock, o el ítem no existe" />
                <Node tone="terreno" step="F1 · Terreno" title="Solicitud de Arriendo" detail="El equipo se arrienda" />
            </div>

            <Down label="Las tres convergen" />

            {/* Nivel 2 — el gate */}
            <Node
                tone="gate"
                step="F2 · Puerta única del gasto"
                title="Autorización del Administrador de Contratos (ADC)"
                detail="Sin esta firma, ni el pañol ni Abastecimiento ven la solicitud. Rechazar la cierra con motivo y fecha."
            />

            <Down label="Se bifurca según el tipo" />

            {/* Nivel 3 — las dos ramas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Rama material */}
                <div className="rounded-[1.25rem] border-2 border-primary bg-primary/5 p-5 space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                        Rama Material · el pañol
                    </p>
                    <div className="space-y-3">
                        <Node tone="panol" step="F3" title="Aprobación por criticidad" detail="Clase A, B o C según el ítem más crítico del carrito" />
                        <LaneStep tone="panol" text="El pañolero aprueba B y C. La clase A exige un mando superior." />
                        <Node tone="panol" step="F5" title="Entrega en pañol" detail="Verificación biométrica del receptor, o excepción autorizada" />
                        <LaneStep tone="panol" text="Quedan quién entregó, quién recibió, cuándo y cómo se acreditó." />
                    </div>
                </div>

                {/* Rama compra */}
                <div className="rounded-[1.25rem] border-2 border-border bg-muted/40 p-5 space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        Rama Compra y Arriendo · Abastecimiento
                    </p>
                    <div className="space-y-3">
                        <Node tone="compra" step="F4" title="RFQ → Comparador → Orden de Compra" detail="Se cotiza, se compara y se adjudica. La OC lleva contrato y centro de costo." />
                        <LaneStep tone="compra" text="El arriendo confirmado materializa el equipo como activo arrendado." />
                        <Node tone="compra" step="F8" title="Recepción ligada a la OC" detail="Ingreso físico con fotos. Si el ítem no existía, aquí nace como activo." />
                        <LaneStep tone="compra" text="Se recibe contra lo ordenado, no contra lo que llegó suelto." />
                    </div>
                </div>
            </div>

            <Down label="Ambas ramas terminan en el mismo lugar" />

            {/* Nivel 4 — kardex */}
            <Node
                tone="panol"
                step="F6 · Trazabilidad"
                title="Kardex y ledger de stock por contrato × pañol"
                detail="Dos registros que tienen que cuadrar: la historia de cada movimiento y la foto de cuánto hay, desglosado por contrato y por pañol."
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5">
                <Node tone="panol" step="F7" title="Devolución" detail="El saldo pendiente se recalcula en el servidor antes de aceptar" />
                <Node tone="compra" step="Ciclo de vida" title="Mantenimiento" detail="OT preventiva, correctiva o predictiva" />
                <Node tone="cierre" step="Cierre" title="Baja del activo" detail="Se archiva, nunca se borra: su historia sigue consultable" />
            </div>

            <Down label="En paralelo, el dinero" />

            {/* Nivel 5 — ledger financiero */}
            <div className="rounded-[1.25rem] border-2 border-success bg-success-subtle/50 p-5 space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-success">
                    F9 y F10 · El hecho económico
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Node tone="dinero" step="Al emitir la OC" title="Comprometido" detail="Plata que ya no está disponible" />
                    <Node tone="dinero" step="Al recepcionar" title="Devengado" detail="El gasto ocurrió" />
                    <Node tone="dinero" step="Al pagar la factura" title="Pagado" detail="La plata salió" />
                </div>
                <p className="text-sm text-success-subtle-foreground">
                    Los tres alimentan el presupuesto contra real y el margen por contrato. Ningún
                    asiento se edita ni se borra: una corrección es un asiento inverso.
                </p>
            </div>
        </div>
    );
}
