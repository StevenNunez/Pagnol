import type { Metadata } from 'next';
import Link from 'next/link';
import * as React from 'react';
import { ArrowLeft, Info, AlertTriangle, CheckCircle2, Users } from 'lucide-react';
import { ProcessFlow } from './process-flow';

export const metadata: Metadata = {
    title: 'Control de Activos y Abastecimiento',
    description:
        'Proceso de control de activos de PAGNOL asociado al área de Abastecimiento: diagrama de flujo, ' +
        'manual de las diez fases (del maestro de activos ISO 55001 al cierre económico) y descriptor de ' +
        'roles y responsabilidades con matriz RACI.',
};

const FECHA_CORTE = '27 de agosto de 2026';

/* ── Primitivos locales del documento ─────────────────────────── */

function Meta({ donde, quien }: { donde: string; quien: string }) {
    return (
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-x-8 gap-y-1 text-sm text-muted-foreground mb-5">
            <span>
                <span className="font-bold text-foreground">Dónde:</span>{' '}
                <code className="rounded-md border bg-muted px-1.5 py-0.5 text-xs">{donde}</code>
            </span>
            <span>
                <span className="font-bold text-foreground">Quién:</span> {quien}
            </span>
        </div>
    );
}

function Phase({
    id,
    code,
    title,
    children,
}: {
    id: string;
    code: string;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section id={id} className="scroll-mt-24 border-t pt-8">
            <div className="flex flex-wrap items-baseline gap-3 mb-3">
                <span className="rounded-xl border-2 border-primary bg-primary/10 px-2.5 py-1 text-xs font-black text-primary">
                    {code}
                </span>
                <h3 className="text-2xl font-bold tracking-tight text-balance">{title}</h3>
            </div>
            <div className="space-y-4 leading-relaxed">{children}</div>
        </section>
    );
}

const NOTE_STYLES = {
    info: { box: 'border-info bg-info-subtle text-info-subtle-foreground', icon: Info },
    warn: { box: 'border-warning bg-warning-subtle text-warning-subtle-foreground', icon: AlertTriangle },
    ok: { box: 'border-success bg-success-subtle text-success-subtle-foreground', icon: CheckCircle2 },
} as const;

function Note({
    tone = 'info',
    title,
    children,
}: {
    tone?: keyof typeof NOTE_STYLES;
    title?: string;
    children: React.ReactNode;
}) {
    const { box, icon: Icon } = NOTE_STYLES[tone];
    return (
        <div className={`rounded-[1.25rem] border-l-4 border-y border-r p-5 flex gap-4 ${box}`}>
            <Icon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1.5 min-w-0">
                {title && <p className="font-bold">{title}</p>}
                <div className="text-sm leading-relaxed [&_strong]:font-bold">{children}</div>
            </div>
        </div>
    );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
    return (
        <div className="overflow-x-auto rounded-[1.25rem] border bg-card">
            <table className="w-full min-w-[520px] text-sm">
                <thead>
                    <tr className="border-b bg-muted">
                        {head.map((h) => (
                            <th
                                key={h}
                                className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-muted-foreground whitespace-nowrap"
                            >
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={i} className="border-b last:border-0">
                            {row.map((cell, j) => (
                                <td key={j} className="px-4 py-3 align-top leading-snug">
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Route({ children }: { children: string }) {
    return <code className="rounded-md border bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap">{children}</code>;
}

/* ── Índice lateral ───────────────────────────────────────────── */

const TOC = [
    { group: 'Parte A', items: [{ id: 'flujo', label: 'Diagrama de flujo' }, { id: 'puertas', label: 'Las tres puertas' }] },
    {
        group: 'Parte B · Fases',
        items: [
            { id: 'f0', label: 'F0 · Maestro de activos' },
            { id: 'f1', label: 'F1 · Necesidad en terreno' },
            { id: 'f2', label: 'F2 · Autorización ADC' },
            { id: 'f3', label: 'F3 · Aprobación por clase' },
            { id: 'abastecimiento', label: 'F4 · Compra y arriendo' },
            { id: 'f5', label: 'F5 · Entrega en pañol' },
            { id: 'f6', label: 'F6 · Custodia y kardex' },
            { id: 'f7', label: 'F7 · Devolución' },
            { id: 'f8', label: 'F8 · Recepción' },
            { id: 'f9', label: 'F9 · Factura y pago' },
            { id: 'f10', label: 'F10 · Cierre económico' },
            { id: 'ciclo', label: 'Mantención y baja' },
        ],
    },
    {
        group: 'Parte C · Roles',
        items: [
            { id: 'roles', label: 'Quién hace qué' },
            { id: 'raci', label: 'Matriz RACI' },
            { id: 'sod', label: 'Separación de funciones' },
            { id: 'aislamiento', label: 'Aislamiento' },
        ],
    },
    { group: 'Cierre', items: [{ id: 'pendiente', label: 'Qué está en desarrollo' }] },
];

/* ── Matriz RACI ──────────────────────────────────────────────── */

const RACI_HEAD = ['Fase', 'Supervisor', 'ADC', 'Abastec.', 'Pañolero', 'Finanzas', 'Admin.'];
const RACI_ROWS: [string, string, string, string, string, string, string][] = [
    ['F0 Alta y clasificación', 'I', 'I', 'C', 'R', 'I', 'A'],
    ['F1 Solicitud desde terreno', 'R/A', 'I', '–', 'I', '–', 'I'],
    ['F2 Autorización', 'I', 'R/A', 'I', 'I', 'I', 'C'],
    ['F3 Aprobación por clase', 'I', 'I', '–', 'R (B/C)', '–', 'A (clase A)'],
    ['F4 Cotización y OC', 'I', 'I', 'R/A', 'I', 'C', 'I'],
    ['F5 Entrega verificada', 'C', 'I', '–', 'R/A', '–', 'I'],
    ['F6 Custodia y kardex', 'A', 'I', 'I', 'R', 'I', 'I'],
    ['F7 Devolución', 'R', 'I', '–', 'A', '–', 'I'],
    ['F8 Recepción', 'I', 'I', 'R/A', 'R', 'I', 'I'],
    ['F9 Factura y pago', '–', 'I', 'R', '–', 'A', 'I'],
    ['F10 Cierre económico', '–', 'C', 'C', '–', 'R/A', 'I'],
    ['Mantenimiento', 'I', '–', 'C', 'C', 'I', 'A'],
    ['Baja del activo', 'I', 'C', 'I', 'R', 'C', 'A'],
];

const RACI_COLOR: Record<string, string> = {
    R: 'text-primary font-black',
    A: 'text-destructive font-black',
    C: 'text-info font-bold',
    I: 'text-muted-foreground',
};

function RaciCell({ value }: { value: string }) {
    // "R/A" y "R (B/C)" comparten celda: se colorea la letra inicial.
    const key = value.charAt(0);
    return <span className={RACI_COLOR[key] ?? 'text-muted-foreground'}>{value}</span>;
}

/* ── Página ───────────────────────────────────────────────────── */

export default function ControlDeActivosPage() {
    return (
        <div className="max-w-6xl mx-auto px-6 sm:px-8 py-12 sm:py-16 animate-in fade-in duration-500">
            <Link
                href="/ayuda"
                className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors mb-10"
            >
                <ArrowLeft className="h-4 w-4" />
                Centro de Ayuda
            </Link>

            {/* Cabecera */}
            <header className="border-b-2 border-foreground pb-8 mb-12">
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-6">
                    <span className="text-primary">PROC-01</span>
                    <span>Documento vivo</span>
                    <span>Corte: {FECHA_CORTE}</span>
                </div>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tighter text-balance mb-5">
                    Control de activos asociado a Abastecimiento
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
                    Desde que en terreno aparece una necesidad hasta que el activo se da de baja,
                    incluyendo su costo. Diagrama de flujo, las diez fases explicadas una a una, y
                    quién responde por cada una.
                </p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-10 lg:gap-14 items-start">
                {/* Índice */}
                {/* En móvil el índice sería una lista de 20 enlaces antes del contenido. */}
                <nav
                    aria-label="Contenido del documento"
                    className="hidden lg:block lg:sticky lg:top-24 border-l-2 pl-5 text-sm"
                >
                    {TOC.map((section) => (
                        <div key={section.group} className="mb-6 last:mb-0">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">
                                {section.group}
                            </p>
                            <ul className="space-y-1.5">
                                {section.items.map((item) => (
                                    <li key={item.id}>
                                        <a
                                            href={`#${item.id}`}
                                            className="text-muted-foreground hover:text-primary transition-colors"
                                        >
                                            {item.label}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </nav>

                <main className="min-w-0 space-y-10">
                    {/* Principio */}
                    <div className="rounded-[1.5rem] border-2 border-primary bg-primary/5 p-7">
                        <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-3">
                            Principio que gobierna el proceso
                        </p>
                        <p className="text-xl font-bold leading-snug text-balance">
                            Ningún activo entra, sale, se mueve o se consume sin dejar un hecho
                            registrado, atribuido a una persona y a un contrato.
                        </p>
                    </div>

                    <div className="space-y-4 leading-relaxed">
                        <p>De ahí salen las cuatro reglas duras del sistema:</p>
                        <ol className="list-decimal pl-6 space-y-2 marker:font-bold marker:text-primary">
                            <li>
                                <strong>Toda compra nace de una solicitud.</strong> No existe la orden
                                de compra espontánea.
                            </li>
                            <li>
                                <strong>Toda solicitud de terreno pasa por el ADC</strong> antes de que
                                Abastecimiento la vea.
                            </li>
                            <li>
                                <strong>El stock total siempre cuadra con su desglose</strong> por
                                contrato y pañol. Es un invariante, no una aspiración.
                            </li>
                            <li>
                                <strong>Los hechos económicos no se editan ni se borran</strong>: se
                                corrigen con un asiento inverso.
                            </li>
                        </ol>
                    </div>

                    {/* ── PARTE A ── */}
                    <section id="flujo" className="scroll-mt-24 space-y-6 pt-4">
                        <div className="flex items-baseline gap-4 border-t-2 border-foreground pt-5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                                Parte A
                            </span>
                            <h2 className="text-3xl font-black tracking-tight">Diagrama de flujo</h2>
                        </div>

                        <ProcessFlow />

                        <div id="puertas" className="scroll-mt-24 space-y-4">
                            <h3 className="text-xl font-bold tracking-tight">Las tres puertas de entrada</h3>
                            <Table
                                head={['Puerta', 'Cuándo se usa', 'Pantalla']}
                                rows={[
                                    [<strong key="a">Solicitud de Material</strong>, 'El ítem existe y hay stock en el pañol', <Route key="b">/supervisor/request</Route>],
                                    [<strong key="c">Solicitud de Compra</strong>, 'No hay stock, o el ítem no existe todavía', <Route key="d">/supervisor/purchase-request-form</Route>],
                                    [<strong key="e">Solicitud de Arriendo</strong>, 'El equipo se arrienda, no se compra', <Route key="f">/supervisor/rental-request</Route>],
                                ]}
                            />
                            <p className="leading-relaxed">
                                Las tres desembocan en la <strong>misma bandeja del ADC</strong>. Esa es
                                la puerta única del gasto.
                            </p>
                        </div>
                    </section>

                    {/* ── PARTE B ── */}
                    <section className="space-y-8 pt-4">
                        <div className="flex items-baseline gap-4 border-t-2 border-foreground pt-5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                                Parte B
                            </span>
                            <h2 className="text-3xl font-black tracking-tight">Las diez fases</h2>
                        </div>

                        <Phase id="f0" code="F0" title="Maestro de activos: alta y clasificación">
                            <Meta donde="/pagnol/activos" quien="Pañolero · Jefe de Mantención · Administrador" />
                            <p>
                                Antes de que exista movimiento tiene que existir el activo. Pagnol
                                clasifica cada uno siguiendo la lógica de ISO 55000/55001:
                            </p>
                            <Table
                                head={['Campo', 'Para qué sirve', 'Valores']}
                                rows={[
                                    [<strong key="1">Clase</strong>, <>Define <strong>quién puede aprobar</strong> una solicitud de ese ítem</>, 'A crítico · B importante · C fungible'],
                                    [<strong key="2">Tipo de uso</strong>, 'Distingue lo que se consume de lo que se devuelve', 'Consumible · Reutilizable Controlado · Herramienta Menor · Repuesto Crítico · Activo Fijo · IT Controlado'],
                                    [<strong key="3">Naturaleza contable</strong>, 'Cómo pega en el resultado', 'CAPEX · OPEX · Inventario Estratégico · Activo Menor Capitalizable'],
                                    [<strong key="4">Propiedad</strong>, 'De quién es el activo', 'Propio · Arrendado · Del cliente (comodato) · Subcontrato'],
                                    [<strong key="5">Estado</strong>, 'Situación actual', 'Disponible · En Uso · En Mantenimiento · Para Baja · Extraviado'],
                                    [<strong key="6">Riesgo</strong>, 'Matriz probabilidad × impacto (1–5)', 'Prioriza el plan de mantenimiento'],
                                    [<strong key="7">Confiabilidad</strong>, 'MTBF, MTTR, % de disponibilidad', 'Indicadores del activo'],
                                ]}
                            />
                            <p>
                                Se suman número de serie, marca, vida útil, costo unitario, ficha
                                técnica, fotos, documentos (manual, garantía, certificado, análisis de
                                causa raíz) y jerarquía padre-hijo.
                            </p>
                            <p>
                                <strong>Cómo se define la clase:</strong> la empresa configura dos
                                umbrales de monto. Sobre el umbral A el ítem es crítico; entre A y B es
                                importante; bajo B es fungible. La clase se puede ajustar a mano por ítem.
                            </p>
                            <Note tone="warn" title="Por qué importa">
                                La clase no es una etiqueta decorativa — es lo que decide quién firma. Un
                                ítem mal clasificado deja pasar un gasto crítico con una firma de menor
                                rango.
                            </Note>
                            <p>
                                <strong>Alta masiva:</strong> <Route>/pagnol/carga-masiva</Route> sube el
                                catálogo inicial por planilla.
                            </p>
                        </Phase>

                        <Phase id="f1" code="F1" title="Detección de la necesidad en terreno">
                            <Meta
                                donde="/supervisor"
                                quien="Supervisor · Jefe de Terreno · Jefe de Mantención · Jefe de Oficina Técnica · ADC"
                            />
                            <p>El solicitante arma un <strong>carrito</strong> con uno o varios ítems y declara:</p>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>
                                    <strong>Contrato o área</strong> al que se imputa — de aquí sale
                                    después la atribución del costo.
                                </li>
                                <li>
                                    <strong>Justificación</strong>, obligatoria en la solicitud de compra.
                                </li>
                                <li>
                                    <strong>Beneficiario</strong>, es decir quién retira: el propio
                                    solicitante, una persona dirigida, o <em>retiro abierto</em> — el
                                    receptor se identifica recién al momento de la entrega.
                                </li>
                            </ul>
                            <p>
                                Al enviarse, la solicitud recibe un <strong>código correlativo legible</strong>{' '}
                                (por ejemplo <Route>PAG-PRQ-0007</Route>) y nace pendiente, sin
                                autorización. Mientras no la tenga, Abastecimiento y el pañol{' '}
                                <strong>no la ven</strong>.
                            </p>
                            <Note title="Variante — suministro del cliente">
                                Una solicitud de compra puede dirigirse al cliente del contrato en vez de a
                                un proveedor: el ADC autoriza, se envía el correo al cliente, y la
                                recepción materializa el ítem como activo de propiedad <em>cliente</em>. Es
                                un comodato — se devuelve al cierre del contrato, y su stock vive en una
                                fila separada del propio: nunca se mezclan.
                            </Note>
                        </Phase>

                        <Phase id="f2" code="F2" title="Autorización del Administrador de Contratos">
                            <Meta donde="/authorizations" quien="ADC · Director de Faena · Administrador" />
                            <p>
                                Es <strong>el gate del proceso</strong>: una sola bandeja con tres
                                pestañas — material, compra y arriendo — que muestra únicamente lo
                                pendiente y sin autorizar.
                            </p>
                            <p>
                                El ADC ve quién pide, para qué contrato, qué ítems, la justificación, la
                                clase más alta del carrito y el monto estimado. Autoriza (y queda
                                estampado quién y cuándo) o rechaza (y queda el motivo y la fecha).
                            </p>
                            <Note tone="ok" title="Regla">
                                La autorización del ADC es un hecho fechado y atribuido, no un check. Viaja
                                con la solicitud el resto de su vida.
                            </Note>
                        </Phase>

                        <Phase id="f3" code="F3" title="Aprobación por criticidad">
                            <Meta donde="/bodega/requests" quien="Pañolero · Administrador · Director de Faena" />
                            <p>
                                Autorizada por el ADC, la solicitud de material llega al pañol. Quien
                                aprueba debe tener el permiso de la{' '}
                                <strong>clase más alta presente en el carrito</strong>:
                            </p>
                            <Table
                                head={['Clase', 'Significado', 'Quién aprueba por defecto']}
                                rows={[
                                    [<strong key="a">A</strong>, 'Crítico', 'Administrador · Soporte Pagnol · Director de Faena'],
                                    [<strong key="b">B</strong>, 'Importante', <>Los anteriores <strong>+ Pañolero</strong></>],
                                    [<strong key="c">C</strong>, 'Fungible', <>Los anteriores <strong>+ Pañolero</strong></>],
                                ]}
                            />
                            <p>
                                Si el pañolero no tiene la clase requerida, no puede aprobar: la solicitud
                                espera al mando que sí la tiene.
                            </p>
                        </Phase>

                        <Phase id="abastecimiento" code="F4" title="Gestión de compra y cotización de arriendo">
                            <Meta donde="/abastecimiento" quien="Abastecimiento" />
                            <p>
                                El hub muestra el flujo obligatorio en la propia pantalla:{' '}
                                <strong>Solicitudes → RFQ → Comparador → Órdenes → Recepción → Pagos</strong>.
                            </p>
                            <Table
                                head={['Paso', 'Pantalla', 'Qué ocurre']}
                                rows={[
                                    [<strong key="1">Solicitudes</strong>, <Route key="1r">/solicitudes</Route>, <>Bandeja de lo autorizado. Se agrupan en <strong>lotes</strong> para cotizar junto lo que conviene junto.</>],
                                    [<strong key="2">RFQ</strong>, <Route key="2r">/rfq</Route>, 'Se pide cotización a uno o varios proveedores del maestro.'],
                                    [<strong key="3">Comparador</strong>, <Route key="3r">/comparador</Route>, 'Las cotizaciones se ponen lado a lado para adjudicar.'],
                                    [<strong key="4">Órdenes</strong>, <Route key="4r">/ordenes</Route>, 'Se emite la OC con centro de costo y contrato. Generada → enviada → cerrada, o anulada.'],
                                    [<strong key="5">Proveedores</strong>, <Route key="5r">/proveedores</Route>, 'Maestro 360°: sus órdenes, recepciones y pagos.'],
                                ]}
                            />
                            <p>
                                <strong>Arriendo:</strong> al confirmar la OC, el equipo se materializa
                                automáticamente como activo de propiedad <em>arrendado</em>, conservando
                                el vínculo al contrato de arriendo. Se devuelve al arrendador al término,
                                cerrando el activo.
                            </p>
                            <Note title="Trazabilidad">
                                La OC conserva el vínculo a la solicitud que la originó, y ésta al ADC que
                                la autorizó y al supervisor que la pidió. La cadena se reconstruye desde
                                cualquier extremo.
                            </Note>
                        </Phase>

                        <Phase id="f5" code="F5" title="Entrega en pañol con verificación de identidad">
                            <Meta donde="/pagnol/movimientos" quien="Pañolero" />
                            <p>
                                Es el momento más delicado del proceso: el activo cambia de manos. Pagnol
                                lo cierra con <strong>verificación biométrica facial en el navegador</strong>.
                            </p>
                            <ol className="list-decimal pl-6 space-y-2 marker:font-bold marker:text-primary">
                                <li>El pañolero abre la solicitud aprobada y confirma ítems y cantidades.</li>
                                <li>
                                    La cámara captura el rostro del receptor y lo compara contra su
                                    plantilla enrolada.{' '}
                                    <strong>La comparación ocurre en el dispositivo</strong>: nunca sale
                                    una imagen del rostro.
                                </li>
                                <li>
                                    Si coincide, la entrega se cierra: quedan registrados quién entregó,
                                    quién recibió, cuándo y cómo se acreditó.
                                </li>
                            </ol>
                            <Note tone="warn" title="Excepción">
                                Si la verificación no es posible — sin cámara, condiciones de terreno — la
                                entrega puede salir en modo excepción, y eso exige autorización de un ADC
                                o Administrador. Queda marcado como excepción: no se disimula como si
                                hubiera sido verificado.
                            </Note>
                            <p>
                                <strong>Atribución automática.</strong> El <strong>contrato</strong> sale
                                del vínculo trabajador ↔ contrato activo: uno solo se auto-completa,
                                varios hacen que el pañolero elija, ninguno cae al pozo común de la
                                empresa. El <strong>pañol</strong> se marca solo si quien atiende
                                administra uno.
                            </p>
                        </Phase>

                        <Phase id="f6" code="F6" title="Custodia y trazabilidad">
                            <Meta donde="/reports/contract-stock" quien="Pañolero · Supervisor · Reportes" />
                            <p>
                                Cada movimiento escribe en <strong>dos lugares que tienen que cuadrar</strong>:
                            </p>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>
                                    <strong>El kardex</strong> — la historia: qué se movió, cuánto, cuándo,
                                    quién, a qué contrato y desde qué pañol.
                                </li>
                                <li>
                                    <strong>El ledger de stock</strong> — la foto: cuánto hay de cada
                                    material por contrato y por pañol. «Sin contrato» es el pozo común de
                                    la empresa.
                                </li>
                            </ul>
                            <p>
                                El invariante <em>suma del desglose = stock total</em> se sostiene en las
                                tres operaciones del ledger: aporte, consumo (que cascadea contrato pedido
                                → pozo común → otros contratos, del mayor al menor) y transferencia
                                estricta entre contratos.
                            </p>
                            <Note tone="ok" title="Quién es el custodio">
                                En orden: receptor verificado por biometría → beneficiario dirigido →
                                solicitante. La misma fórmula alimenta «cuánto tengo pendiente de
                                devolver» y «quién tiene este activo», para que las dos vistas nunca se
                                contradigan.
                            </Note>
                            <p>
                                El reporte de stock por contrato entrega la valorización (cantidad × costo
                                unitario), la matriz material × contrato y el kardex del período, con
                                exportación a Excel.
                            </p>
                        </Phase>

                        <Phase id="f7" code="F7" title="Devolución y reintegro">
                            <Meta
                                donde="/supervisor/return-request → /bodega/return-requests"
                                quien="Custodio · Pañolero"
                            />
                            <p>
                                El custodio declara qué devuelve. El sistema{' '}
                                <strong>recalcula el saldo pendiente en el servidor</strong> antes de
                                aceptar: suma lo que esa persona tomó en solicitudes aprobadas y resta lo
                                que ya devolvió. La pantalla puede mostrar un saldo optimista, pero nunca
                                es la única barrera — nadie devuelve más de lo que tiene.
                            </p>
                            <p>
                                El pañolero aprueba o rechaza. Aprobada, la cantidad vuelve al stock{' '}
                                <strong>al mismo contrato y pañol de donde salió</strong>, y se escribe el
                                movimiento inverso en el kardex.
                            </p>
                        </Phase>

                        <Phase id="f8" code="F8" title="Recepción y materialización del activo">
                            <Meta donde="/abastecimiento/recepcion" quien="Abastecimiento · Pañolero" />
                            <p>
                                La recepción está <strong>ligada a la Orden de Compra</strong>: se recibe
                                contra lo que se ordenó, no contra lo que llegó suelto. Se registra la
                                cantidad efectivamente recibida, se pueden adjuntar fotos del ingreso, y
                                ahí ocurre lo importante:
                            </p>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>
                                    Si el ítem <strong>no existía</strong> en el maestro, la recepción lo{' '}
                                    <strong>crea como activo</strong> — vuelve a F0 para completar su
                                    clasificación.
                                </li>
                                <li>
                                    Si ya existía, <strong>suma stock</strong> al contrato y pañol
                                    correspondientes y escribe el kardex.
                                </li>
                                <li>
                                    Si vino del cliente, nace con propiedad <em>cliente</em> y su stock
                                    queda separado.
                                </li>
                            </ul>
                            <Note tone="warn" title="En desarrollo">
                                La distinción entre comprar un <strong>bien</strong> y contratar un{' '}
                                <strong>servicio</strong>. Un servicio no debe tocar el inventario al
                                recibirse; el modelo de datos ya lo contempla y la recepción diferenciada
                                está en curso.
                            </Note>
                        </Phase>

                        <Phase id="f9" code="F9" title="Factura y pago">
                            <Meta donde="/abastecimiento/pagos" quien="Abastecimiento · Jefe de Finanzas" />
                            <p>
                                Recepcionado el pedido, se registra la factura del proveedor y se
                                administra su pago: <strong>pendiente → pagada</strong>, o{' '}
                                <strong>vencida</strong> si pasó su fecha. El hub de Abastecimiento
                                muestra el monto por pagar (pendiente + vencido) y cuántos pagos están
                                vencidos.
                            </p>
                            <Note tone="warn" title="En desarrollo">
                                La facturación electrónica chilena (DTE) tiene la interfaz lista y la
                                integración con el SII pendiente.
                            </Note>
                        </Phase>

                        <Phase id="f10" code="F10" title="Cierre económico: el ledger financiero">
                            <Meta donde="/finanzas" quien="Jefe de Finanzas · Administrador" />
                            <p>
                                El proceso de abastecimiento no termina en la bodega: termina en el
                                resultado del contrato. Cada transición de estado emite un{' '}
                                <strong>hecho económico inmutable</strong>:
                            </p>
                            <Table
                                head={['Cuándo', 'Qué se registra']}
                                rows={[
                                    ['Se emite la Orden de Compra', <><strong>Comprometido</strong> — plata que ya no está disponible aunque no se haya gastado</>],
                                    ['Se recepciona la mercadería', <><strong>Devengado</strong> — el gasto ocurrió</>],
                                    ['Se paga la factura', <><strong>Pagado</strong> — la plata salió</>],
                                ]}
                            />
                            <p>
                                Esos tres momentos alimentan <strong>presupuesto contra real</strong> y el{' '}
                                <strong>margen por contrato</strong> — ingresos contra costos, incluyendo
                                mano de obra y arriendos.
                            </p>
                            <Note tone="ok" title="Regla de oro">
                                Un asiento nunca se edita ni se borra. Una corrección es un asiento
                                inverso. Por eso el histórico es auditable: se puede reconstruir el estado
                                del contrato a cualquier fecha pasada.
                            </Note>
                        </Phase>

                        <Phase id="ciclo" code="···" title="Ciclo de vida posterior: mantenimiento y baja">
                            <p>
                                <strong>Mantenimiento</strong> (<Route>/pagnol/mantenimiento</Route>):
                                órdenes de trabajo preventivas, correctivas y predictivas, con prioridad,
                                responsable asignado, repuestos consumidos — que descuentan del stock —,
                                horas de detención, costo total y análisis de causa raíz. El activo pasa a{' '}
                                <em>En Mantenimiento</em> y vuelve a <em>Disponible</em> al cerrar.
                            </p>
                            <p>
                                <strong>Baja:</strong> un activo llega a <em>Para Baja</em> (fin de vida
                                útil, obsolescencia) o <em>Extraviado</em>. Los arrendados se cierran al
                                devolverlos al arrendador; los del cliente, al cierre del contrato. El
                                activo se archiva — <strong>no se borra</strong>: su kardex y su historia
                                siguen siendo consultables.
                            </p>
                        </Phase>
                    </section>

                    {/* ── PARTE C ── */}
                    <section id="roles" className="scroll-mt-24 space-y-6 pt-4">
                        <div className="flex items-baseline gap-4 border-t-2 border-foreground pt-5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                                Parte C
                            </span>
                            <h2 className="text-3xl font-black tracking-tight">Roles y responsabilidades</h2>
                        </div>

                        <Table
                            head={['Rol', 'Responsabilidad en el control de activos', 'Dónde actúa']}
                            rows={[
                                [<strong key="1">Supervisor</strong>, 'Detecta la necesidad y la solicita. Registra devoluciones. Responde por lo que su cuadrilla tiene en custodia.', 'Solicitudes, devoluciones'],
                                [<strong key="2">Jefe de Terreno</strong>, 'Igual que el supervisor, sobre el avance físico de la obra.', 'Solicitudes, devoluciones'],
                                [<strong key="3">Jefe de Mantención</strong>, 'Solicita repuestos y materiales. Ejecuta las OT y edita la ficha del activo.', 'Solicitudes, mantenimiento'],
                                [<strong key="4">Jefe de Oficina Técnica</strong>, 'Solicita imputando a cualquier contrato. Vigila que el gasto calce con el presupuesto y la Gantt.', 'Solicitudes, control de obra'],
                                [<span key="5"><strong>ADC</strong><br /><span className="text-muted-foreground text-xs">Administrador de Contratos</span></span>, <><strong>Autoriza o rechaza toda solicitud de terreno</strong> antes de que llegue a Abastecimiento. Es el control de gasto del proceso.</>, 'Autorizaciones'],
                                [<strong key="6">Abastecimiento</strong>, 'Cotiza, compara, adjudica, emite las OC, recepciona, mantiene el maestro de proveedores y gestiona los pagos.', 'Módulo Abastecimiento'],
                                [<strong key="7">Pañolero</strong>, 'Custodia física del inventario. Aprueba clases B y C, entrega con verificación de identidad, recibe devoluciones, ingresa stock y transfiere entre pañoles.', 'Pañol / Movimientos'],
                                [<strong key="8">Jefe de Finanzas</strong>, 'Facturas, pagos a proveedores, control del gasto comprometido y devengado.', 'Pagos, Finanzas'],
                                [<strong key="9">Director de Faena</strong>, 'Responsable técnico y legal de la operación (DS 132). Autoriza como mando superior y aprueba clase A.', 'Autorizaciones, reportes'],
                                [<strong key="10">Administrador</strong>, 'Dueño de la cuenta. Configura umbrales de criticidad, pañoles, contratos, usuarios y permisos.', 'Toda la aplicación'],
                                [<strong key="11">Operador</strong>, <><strong>No opera la aplicación: queda registrado en ella.</strong> Recibe activos verificado biométricamente y ve las herramientas a su cargo.</>, 'Recepción de entregas'],
                                [<strong key="12">Gerente General</strong>, 'Observador: visualiza y descarga, sin editar ni aprobar.', 'Reportes'],
                            ]}
                        />

                        <div className="rounded-[1.25rem] border bg-card p-5 flex items-start gap-4">
                            <Users className="h-5 w-5 shrink-0 text-primary mt-0.5" aria-hidden="true" />
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                El catálogo completo de los 24 roles de Pagnol, con los módulos que ve
                                cada uno, está en{' '}
                                <Link href="/ayuda/roles" className="font-bold text-primary hover:underline">
                                    Roles y Responsabilidades
                                </Link>
                                .
                            </p>
                        </div>

                        <div id="raci" className="scroll-mt-24 space-y-4">
                            <h3 className="text-xl font-bold tracking-tight">Matriz RACI</h3>
                            <p className="text-sm text-muted-foreground">
                                <span className="text-primary font-black">R</span> ejecuta ·{' '}
                                <span className="text-destructive font-black">A</span> responde por el
                                resultado · <span className="text-info font-bold">C</span> se le consulta ·{' '}
                                <span className="text-muted-foreground">I</span> se le informa
                            </p>
                            <div className="overflow-x-auto rounded-[1.25rem] border bg-card">
                                <table className="w-full min-w-[640px] text-sm tabular-nums">
                                    <thead>
                                        <tr className="border-b bg-muted">
                                            {RACI_HEAD.map((h, i) => (
                                                <th
                                                    key={h}
                                                    className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground whitespace-nowrap ${
                                                        i === 0 ? 'text-left min-w-[180px]' : 'text-center'
                                                    }`}
                                                >
                                                    {h}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {RACI_ROWS.map((row) => (
                                            <tr key={row[0]} className="border-b last:border-0">
                                                <td className="px-4 py-2.5 font-medium">{row[0]}</td>
                                                {row.slice(1).map((cell, j) => (
                                                    <td key={j} className="px-4 py-2.5 text-center">
                                                        <RaciCell value={cell} />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div id="sod" className="scroll-mt-24 space-y-4">
                            <h3 className="text-xl font-bold tracking-tight">Separación de funciones</h3>
                            <p className="leading-relaxed">
                                El diseño impide, por construcción, que una sola persona cierre el círculo
                                del gasto:
                            </p>
                            <Table
                                head={['Control', 'Cómo se hace cumplir']}
                                rows={[
                                    [<strong key="1">Quien pide no autoriza</strong>, 'El solicitante de terreno no tiene el permiso de autorización del ADC.'],
                                    [<strong key="2">Quien autoriza no compra</strong>, 'El ADC no emite órdenes de compra.'],
                                    [<strong key="3">Quien compra no custodia</strong>, 'Abastecimiento emite la OC; el pañolero tiene la existencia física.'],
                                    [<strong key="4">Quien custodia no aprueba lo crítico</strong>, 'El pañolero aprueba clases B y C; la clase A exige un mando superior.'],
                                    [<strong key="5">Quien recibe queda identificado</strong>, 'La entrega se cierra con verificación biométrica del receptor, o con excepción autorizada — nunca en silencio.'],
                                    [<strong key="6">Quien corrige deja rastro</strong>, 'Los hechos económicos no se editan: se revierten con un asiento inverso fechado y atribuido.'],
                                ]}
                            />
                            <p className="leading-relaxed">
                                Todos los permisos son <strong>configurables por empresa</strong>: esta
                                tabla describe la configuración por defecto, que cada organización puede
                                endurecer o relajar.
                            </p>
                        </div>

                        <div id="aislamiento" className="scroll-mt-24 space-y-4">
                            <h3 className="text-xl font-bold tracking-tight">Aislamiento entre empresas</h3>
                            <p className="leading-relaxed">
                                Pagnol es multi-empresa. Cada dato lleva la empresa a la que pertenece, y
                                la base de datos <strong>rechaza en su propio motor</strong> cualquier
                                lectura o escritura fuera de ella — no depende de que la aplicación se
                                acuerde de filtrar. Ninguna empresa ve el catálogo, el kardex, los precios
                                ni las personas de otra.
                            </p>
                        </div>
                    </section>

                    {/* ── Cierre ── */}
                    <section id="pendiente" className="scroll-mt-24 space-y-6 pt-4">
                        <div className="flex items-baseline gap-4 border-t-2 border-foreground pt-5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                                Cierre
                            </span>
                            <h2 className="text-3xl font-black tracking-tight">Qué está en desarrollo</h2>
                        </div>
                        <p className="leading-relaxed">
                            El proceso está operativo de punta a punta. Lo que sigue abierto, a la fecha
                            de corte:
                        </p>
                        <Table
                            head={['Tema', 'Estado']}
                            rows={[
                                [<>Recepción diferenciada de <strong>servicios</strong>, que no toquen inventario</>, 'En desarrollo'],
                                [<>Autorización del ADC <strong>por lote</strong></>, 'En backlog'],
                                [<>Facturación electrónica <strong>DTE / SII</strong></>, 'Interfaz lista, integración pendiente'],
                                [<>Material de <strong>subcontratistas</strong></>, 'Modelado, sin interfaz'],
                                [<>Prueba manual del <strong>cierre biométrico</strong> por contrato</>, 'Pendiente'],
                            ]}
                        />
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            Este documento se actualiza junto con la aplicación: describe lo que Pagnol
                            hace hoy, no lo que hará.
                        </p>
                    </section>
                </main>
            </div>
        </div>
    );
}
