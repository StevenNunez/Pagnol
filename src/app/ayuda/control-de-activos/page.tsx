import type { Metadata } from 'next';
import Link from 'next/link';
import * as React from 'react';
import { ArrowLeft, Info, AlertTriangle, CheckCircle2, Users } from 'lucide-react';
import { ProcessFlow } from './process-flow';

export const metadata: Metadata = {
    title: 'Control de Activos y Abastecimiento',
    description:
        'Cómo funciona el control de activos en PAGNOL, paso a paso: quién pide, quién autoriza, ' +
        'quién compra, quién entrega y cómo queda anotado el costo. Con el recorrido completo y ' +
        'quién responde por cada paso.',
};

const ACTUALIZADO = '27 de agosto de 2026';

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
                <span className="rounded-xl border-2 border-primary bg-primary/10 px-2.5 py-1 text-xs font-black text-primary whitespace-nowrap">
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
    {
        group: 'Cómo funciona',
        items: [
            { id: 'flujo', label: 'El recorrido completo' },
            { id: 'puertas', label: 'Las tres formas de pedir' },
        ],
    },
    {
        group: 'Paso a paso',
        items: [
            { id: 'f0', label: 'Antes · Dar de alta el equipo' },
            { id: 'f1', label: '1 · Se pide desde terreno' },
            { id: 'f2', label: '2 · Lo autoriza el ADC' },
            { id: 'f3', label: '3 · Lo aprueba el pañol' },
            { id: 'abastecimiento', label: '4 · Se compra o se arrienda' },
            { id: 'f5', label: '5 · Se entrega en el pañol' },
            { id: 'f6', label: '6 · Todo queda anotado' },
            { id: 'f7', label: '7 · Se devuelve' },
            { id: 'f8', label: '8 · Llega lo comprado' },
            { id: 'f9', label: '9 · Se factura y se paga' },
            { id: 'f10', label: '10 · Se anota el costo' },
            { id: 'ciclo', label: 'Después · Mantención y baja' },
        ],
    },
    {
        group: 'Quién hace qué',
        items: [
            { id: 'roles', label: 'Cada rol en este proceso' },
            { id: 'raci', label: 'Matriz RACI' },
            { id: 'sod', label: 'Nadie puede solo' },
            { id: 'aislamiento', label: 'Cada empresa ve lo suyo' },
        ],
    },
    { group: 'Al final', items: [{ id: 'pendiente', label: 'Lo que falta' }] },
];

/* ── Tabla de quién hace qué ──────────────────────────────────── */

const RACI_HEAD = ['Paso', 'Supervisor', 'ADC', 'Abastec.', 'Pañolero', 'Finanzas', 'Admin.'];
const RACI_ROWS: [string, string, string, string, string, string, string][] = [
    ['Antes · Dar de alta el equipo', 'I', 'I', 'C', 'R', 'I', 'A'],
    ['1 · Se pide desde terreno', 'R/A', 'I', '–', 'I', '–', 'I'],
    ['2 · Autorización', 'I', 'R/A', 'I', 'I', 'I', 'C'],
    ['3 · Aprobación en el pañol', 'I', 'I', '–', 'R (B/C)', '–', 'A (clase A)'],
    ['4 · Cotización y orden de compra', 'I', 'I', 'R/A', 'I', 'C', 'I'],
    ['5 · Entrega verificada', 'C', 'I', '–', 'R/A', '–', 'I'],
    ['6 · Custodia y kardex', 'A', 'I', 'I', 'R', 'I', 'I'],
    ['7 · Devolución', 'R', 'I', '–', 'A', '–', 'I'],
    ['8 · Recepción', 'I', 'I', 'R/A', 'R', 'I', 'I'],
    ['9 · Factura y pago', '–', 'I', 'R', '–', 'A', 'I'],
    ['10 · Se anota el costo', '–', 'C', 'C', '–', 'R/A', 'I'],
    ['Después · Mantención', 'I', '–', 'C', 'C', 'I', 'A'],
    ['Después · Baja del equipo', 'I', 'C', 'I', 'R', 'C', 'A'],
];

const RACI_COLOR: Record<string, string> = {
    R: 'text-primary font-black',
    A: 'text-destructive font-black',
    C: 'text-info font-bold',
    I: 'text-muted-foreground',
};

function RaciCell({ value }: { value: string }) {
    // "R/A" y "R (B/C)" comparten celda: se colorea según la letra inicial.
    return <span className={RACI_COLOR[value.charAt(0)] ?? 'text-muted-foreground'}>{value}</span>;
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
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-6">
                    Actualizado: {ACTUALIZADO}
                </p>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tighter text-balance mb-5">
                    Control de activos
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
                    Desde que en terreno alguien necesita algo hasta que el equipo se da de baja,
                    incluyendo lo que costó. El recorrido completo, los diez pasos explicados uno por
                    uno, y quién responde por cada uno.
                </p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-10 lg:gap-14 items-start">
                {/* Índice */}
                {/* En móvil el índice sería una lista de 20 enlaces antes del contenido. */}
                <nav
                    aria-label="Contenido de la página"
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
                    {/* La idea de fondo */}
                    <div className="rounded-[1.5rem] border-2 border-primary bg-primary/5 p-7">
                        <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-3">
                            La regla que sostiene todo
                        </p>
                        <p className="text-xl font-bold leading-snug text-balance">
                            Nada entra, sale, se mueve ni se gasta sin que quede anotado quién lo hizo
                            y para qué contrato fue.
                        </p>
                    </div>

                    <div className="space-y-4 leading-relaxed">
                        <p>De ahí salen las cuatro reglas que no se saltan nunca:</p>
                        <ol className="list-decimal pl-6 space-y-2 marker:font-bold marker:text-primary">
                            <li>
                                <strong>Toda compra empieza con un pedido.</strong> No existe la orden
                                de compra que aparece sola.
                            </li>
                            <li>
                                <strong>Todo pedido de terreno lo autoriza el ADC</strong> antes de que
                                Abastecimiento lo vea.
                            </li>
                            <li>
                                <strong>El stock total siempre calza</strong> con lo que hay en cada
                                contrato y en cada pañol. Si no calza, algo se hizo mal.
                            </li>
                            <li>
                                <strong>Los movimientos de plata no se editan ni se borran</strong>: si
                                hay un error, se anota un movimiento en contra.
                            </li>
                        </ol>
                    </div>

                    {/* ── CÓMO FUNCIONA ── */}
                    <section id="flujo" className="scroll-mt-24 space-y-6 pt-4">
                        <div className="border-t-2 border-foreground pt-5">
                            <h2 className="text-3xl font-black tracking-tight">
                                Cómo funciona, de principio a fin
                            </h2>
                        </div>

                        <ProcessFlow />

                        <div id="puertas" className="scroll-mt-24 space-y-4">
                            <h3 className="text-xl font-bold tracking-tight">Las tres formas de pedir</h3>
                            <Table
                                head={['Tipo de pedido', 'Cuándo se usa', 'Dónde se hace']}
                                rows={[
                                    [<strong key="a">Pedido de material</strong>, 'El ítem existe y hay stock en el pañol', <Route key="b">/supervisor/request</Route>],
                                    [<strong key="c">Pedido de compra</strong>, 'No hay stock, o el ítem no existe todavía', <Route key="d">/supervisor/purchase-request-form</Route>],
                                    [<strong key="e">Pedido de arriendo</strong>, 'El equipo se arrienda, no se compra', <Route key="f">/supervisor/rental-request</Route>],
                                ]}
                            />
                            <p className="leading-relaxed">
                                Los tres llegan a <strong>la misma bandeja del ADC</strong>. Por ahí pasa
                                todo el gasto, sin excepción.
                            </p>
                        </div>
                    </section>

                    {/* ── PASO A PASO ── */}
                    <section className="space-y-8 pt-4">
                        <div className="border-t-2 border-foreground pt-5">
                            <h2 className="text-3xl font-black tracking-tight">Paso a paso</h2>
                        </div>

                        <Phase id="f0" code="Antes" title="Dar de alta el equipo o material">
                            <Meta donde="/pagnol/activos" quien="Pañolero · Jefe de Mantención · Administrador" />
                            <p>
                                Antes de que haya movimiento tiene que existir la ficha. Pagnol la arma
                                con estos datos, siguiendo la norma internacional de gestión de activos
                                (ISO 55001):
                            </p>
                            <Table
                                head={['Dato', 'Para qué sirve', 'Opciones']}
                                rows={[
                                    [<strong key="1">Qué tan crítico es</strong>, <>Define <strong>quién puede aprobar</strong> un pedido de ese ítem</>, 'A crítico · B importante · C fungible'],
                                    [<strong key="2">Tipo de uso</strong>, 'Separa lo que se consume de lo que se devuelve', 'Consumible · Reutilizable controlado · Herramienta menor · Repuesto crítico · Activo fijo · Equipo informático'],
                                    [<strong key="3">Cómo se contabiliza</strong>, 'Si es inversión o gasto del mes', 'CAPEX · OPEX · Inventario estratégico · Activo menor'],
                                    [<strong key="4">De quién es</strong>, 'Distingue lo propio de lo prestado', 'Propio · Arrendado · Del cliente (prestado) · De un subcontrato'],
                                    [<strong key="5">Cómo está hoy</strong>, 'Situación actual del equipo', 'Disponible · En uso · En mantención · Para baja · Extraviado'],
                                    [<strong key="6">Riesgo de falla</strong>, 'Ordena el plan de mantención por prioridad', 'Qué tan probable es que falle × qué tan grave sería'],
                                    [<strong key="7">Confiabilidad</strong>, 'Cuánto aguanta y cuánto tarda en repararse', 'Horas entre fallas, horas de reparación, % disponible'],
                                ]}
                            />
                            <p>
                                Se suman número de serie, marca, vida útil, costo, ficha técnica, fotos,
                                documentos (manual, garantía, certificado) y de qué equipo mayor forma
                                parte.
                            </p>
                            <p>
                                <strong>Cómo se decide si es A, B o C:</strong> la empresa fija dos montos
                                de referencia. Sobre el primero el ítem es crítico; entre los dos es
                                importante; bajo el segundo es fungible. También se puede fijar a mano
                                ítem por ítem.
                            </p>
                            <Note tone="warn" title="Ojo con esto">
                                Que un ítem sea A, B o C no es una etiqueta de adorno: es lo que decide
                                quién firma. Si está mal clasificado, un gasto importante puede salir con
                                la firma de alguien que no correspondía.
                            </Note>
                            <p>
                                <strong>Para cargar muchos de una vez:</strong> <Route>/pagnol/carga-masiva</Route>{' '}
                                sube el inventario inicial desde una planilla.
                            </p>
                        </Phase>

                        <Phase id="f1" code="Paso 1" title="Alguien en terreno necesita algo">
                            <Meta
                                donde="/supervisor"
                                quien="Supervisor · Jefe de Terreno · Jefe de Mantención · Jefe de Oficina Técnica · ADC"
                            />
                            <p>Quien pide arma un <strong>carrito</strong> con uno o varios ítems y dice:</p>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>
                                    <strong>Para qué contrato o área es</strong> — de ahí sale después a
                                    quién se le carga el costo.
                                </li>
                                <li>
                                    <strong>Para qué lo necesita</strong>, obligatorio cuando hay que comprar.
                                </li>
                                <li>
                                    <strong>Quién lo va a retirar</strong>: él mismo, otra persona en
                                    particular, o nadie definido todavía — en ese caso el que retira se
                                    identifica recién en el pañol.
                                </li>
                            </ul>
                            <p>
                                Al enviarlo, el pedido recibe un <strong>número</strong> (por ejemplo{' '}
                                <Route>PAG-PRQ-0007</Route>) y queda pendiente de autorización. Hasta que
                                el ADC no lo autorice, <strong>ni Abastecimiento ni el pañol lo ven</strong>.
                            </p>
                            <Note title="Cuando el material lo pone el cliente">
                                Un pedido de compra puede ir dirigido al cliente del contrato en vez de a
                                un proveedor: el ADC lo autoriza, se le manda el correo al cliente, y
                                cuando llega se ingresa como equipo <em>del cliente</em>. Es material
                                prestado — se devuelve cuando termina el contrato, y su stock se lleva
                                aparte del propio: nunca se mezclan.
                            </Note>
                        </Phase>

                        <Phase id="f2" code="Paso 2" title="El Administrador de Contratos lo autoriza">
                            <Meta donde="/authorizations" quien="ADC · Director de Faena · Administrador" />
                            <p>
                                Este es <strong>el filtro del proceso</strong>: una sola bandeja con tres
                                pestañas — material, compra y arriendo — que muestra sólo lo que está
                                esperando autorización.
                            </p>
                            <p>
                                El ADC ve quién pide, para qué contrato, qué ítems, para qué los necesita,
                                qué tan crítico es lo más crítico del carrito y cuánto costaría. Si
                                autoriza, queda grabado quién y cuándo. Si rechaza, queda cerrado con el
                                motivo y la fecha.
                            </p>
                            <Note tone="ok" title="Por qué importa">
                                La autorización no es un simple visto bueno: queda con nombre y hora, y
                                acompaña al pedido el resto de su vida. Siempre se puede saber quién
                                dejó pasar un gasto.
                            </Note>
                        </Phase>

                        <Phase id="f3" code="Paso 3" title="El pañol lo aprueba según qué tan crítico sea">
                            <Meta donde="/bodega/requests" quien="Pañolero · Administrador · Director de Faena" />
                            <p>
                                Con la autorización del ADC, el pedido llega al pañol. Quien aprueba tiene
                                que estar habilitado para{' '}
                                <strong>el ítem más crítico que traiga el carrito</strong>:
                            </p>
                            <Table
                                head={['Clase', 'Qué significa', 'Quién aprueba']}
                                rows={[
                                    [<strong key="a">A</strong>, 'Crítico', 'Administrador · Director de Faena'],
                                    [<strong key="b">B</strong>, 'Importante', <>Los anteriores <strong>+ Pañolero</strong></>],
                                    [<strong key="c">C</strong>, 'Fungible', <>Los anteriores <strong>+ Pañolero</strong></>],
                                ]}
                            />
                            <p>
                                Si el pañolero no está habilitado para esa clase, no puede aprobar: el
                                pedido queda esperando al jefe que sí puede.
                            </p>
                        </Phase>

                        <Phase id="abastecimiento" code="Paso 4" title="Abastecimiento compra o arrienda">
                            <Meta donde="/abastecimiento" quien="Abastecimiento" />
                            <p>
                                El módulo muestra el camino obligatorio en la propia pantalla:{' '}
                                <strong>
                                    Pedidos → Cotizaciones → Comparar → Orden de compra → Recepción → Pagos
                                </strong>
                                .
                            </p>
                            <Table
                                head={['Etapa', 'Dónde', 'Qué pasa ahí']}
                                rows={[
                                    [<strong key="1">Pedidos</strong>, <Route key="1r">/solicitudes</Route>, <>Lo que el ADC ya autorizó. Se juntan varios pedidos en un <strong>lote</strong> para cotizar de una vez lo que conviene junto.</>],
                                    [<strong key="2">Cotizaciones (RFQ)</strong>, <Route key="2r">/rfq</Route>, 'Se le pide precio a uno o varios proveedores.'],
                                    [<strong key="3">Comparar</strong>, <Route key="3r">/comparador</Route>, 'Las cotizaciones se ponen lado a lado para elegir.'],
                                    [<strong key="4">Órdenes de compra</strong>, <Route key="4r">/ordenes</Route>, 'Se emite la orden, con su contrato y centro de costo. Pasa de generada a enviada y después a cerrada, o se anula.'],
                                    [<strong key="5">Proveedores</strong>, <Route key="5r">/proveedores</Route>, 'La ficha de cada proveedor: sus órdenes, lo que entregó y lo que se le pagó.'],
                                ]}
                            />
                            <p>
                                <strong>Arriendo:</strong> al confirmar la orden, el equipo entra solo al
                                inventario marcado como <em>arrendado</em>, con el vínculo a su contrato
                                de arriendo. Cuando se devuelve al arrendador, se cierra.
                            </p>
                            <Note title="Se puede seguir el hilo completo">
                                La orden de compra guarda de qué pedido salió, ese pedido guarda quién lo
                                autorizó, y esa autorización guarda quién lo pidió. Se puede reconstruir la
                                cadena entera, empezando por cualquier punta.
                            </Note>
                        </Phase>

                        <Phase id="f5" code="Paso 5" title="Se entrega en el pañol, verificando quién retira">
                            <Meta donde="/pagnol/movimientos" quien="Pañolero" />
                            <p>
                                Este es el momento más delicado: el equipo cambia de manos. Pagnol lo
                                cierra <strong>verificando la cara de quien retira</strong>.
                            </p>
                            <ol className="list-decimal pl-6 space-y-2 marker:font-bold marker:text-primary">
                                <li>El pañolero abre el pedido aprobado y confirma ítems y cantidades.</li>
                                <li>
                                    La cámara toma la cara y la compara con la que esa persona registró al
                                    ingresar.{' '}
                                    <strong>La comparación se hace en el mismo equipo</strong>: la foto
                                    nunca sale del dispositivo.
                                </li>
                                <li>
                                    Si coincide, la entrega se cierra: queda quién entregó, quién recibió,
                                    cuándo y cómo se comprobó.
                                </li>
                            </ol>
                            <Note tone="warn" title="Cuando no se puede verificar">
                                Si no hay cámara o las condiciones no lo permiten, la entrega puede salir
                                igual, pero necesita que la autorice un ADC o el Administrador. Queda
                                marcada como excepción: no se disfraza de entrega verificada.
                            </Note>
                            <p>
                                <strong>Lo que el sistema completa solo.</strong> El <strong>contrato</strong>{' '}
                                sale de a qué contrato está asignada la persona: si tiene uno, se llena
                                solo; si tiene varios, el pañolero elige; si no tiene ninguno, se carga al
                                stock general de la empresa. El <strong>pañol</strong> se marca solo si
                                quien atiende tiene uno a cargo.
                            </p>
                        </Phase>

                        <Phase id="f6" code="Paso 6" title="Todo queda anotado y cuadrado">
                            <Meta donde="/reports/contract-stock" quien="Pañolero · Supervisor · Reportes" />
                            <p>Cada movimiento se escribe en <strong>dos lados que tienen que dar lo mismo</strong>:</p>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>
                                    <strong>El kardex</strong> — la historia: qué se movió, cuánto, cuándo,
                                    quién, para qué contrato y desde qué pañol.
                                </li>
                                <li>
                                    <strong>El saldo</strong> — cuánto hay hoy de cada cosa, separado por
                                    contrato y por pañol. Lo que no está asignado a ningún contrato es el
                                    stock general de la empresa.
                                </li>
                            </ul>
                            <p>
                                La suma de todos los saldos siempre tiene que dar el stock total. Cuando se
                                descuenta, el sistema saca primero del contrato que pidió, después del
                                stock general, y recién ahí de otros contratos, empezando por el que más
                                tiene.
                            </p>
                            <Note tone="ok" title="Quién queda responsable de lo entregado">
                                En este orden: la persona que se verificó con la cara al retirar; si no, la
                                persona a la que iba dirigido; si no, quien lo pidió. Con esa misma regla se
                                calcula «cuánto tengo pendiente de devolver» y «quién tiene este equipo», así
                                las dos pantallas nunca se contradicen.
                            </Note>
                            <p>
                                El reporte de stock por contrato muestra cuánto vale lo que hay (cantidad ×
                                costo), qué material está en qué contrato, y todos los movimientos del
                                período, con salida a Excel.
                            </p>
                        </Phase>

                        <Phase id="f7" code="Paso 7" title="Se devuelve lo que no se usó">
                            <Meta
                                donde="/supervisor/return-request → /bodega/return-requests"
                                quien="Quien lo tiene a cargo · Pañolero"
                            />
                            <p>
                                Quien lo tiene declara qué devuelve. Antes de aceptarlo, el sistema{' '}
                                <strong>recalcula cuánto debe esa persona</strong>: suma lo que retiró y
                                resta lo que ya devolvió. La pantalla puede mostrar un número optimista,
                                pero nunca es lo único que revisa — nadie puede devolver más de lo que
                                tiene.
                            </p>
                            <p>
                                El pañolero acepta o rechaza. Si acepta, la cantidad vuelve{' '}
                                <strong>al mismo contrato y pañol de donde salió</strong>, y queda el
                                movimiento de vuelta en el kardex.
                            </p>
                        </Phase>

                        <Phase id="f8" code="Paso 8" title="Llega lo que se compró">
                            <Meta donde="/abastecimiento/recepcion" quien="Abastecimiento · Pañolero" />
                            <p>
                                La recepción va <strong>contra la orden de compra</strong>: se recibe
                                contra lo que se pidió, no contra lo que llegó suelto. Se anota cuánto
                                llegó de verdad, se pueden adjuntar fotos, y ahí pasa lo importante:
                            </p>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>
                                    Si el ítem <strong>no existía</strong> en el inventario, la recepción lo{' '}
                                    <strong>crea</strong> — y hay que completarle la ficha.
                                </li>
                                <li>
                                    Si ya existía, <strong>suma stock</strong> al contrato y pañol que
                                    corresponde, y escribe el movimiento en el kardex.
                                </li>
                                <li>
                                    Si vino del cliente, entra marcado como <em>del cliente</em> y su stock
                                    queda aparte.
                                </li>
                            </ul>
                            <Note tone="warn" title="Todavía en construcción">
                                Separar comprar un <strong>producto</strong> de contratar un{' '}
                                <strong>servicio</strong>. Un servicio no debería tocar el inventario cuando
                                se recibe; el sistema ya lo tiene contemplado y la pantalla está en camino.
                            </Note>
                        </Phase>

                        <Phase id="f9" code="Paso 9" title="Se factura y se paga">
                            <Meta donde="/abastecimiento/pagos" quien="Abastecimiento · Jefe de Finanzas" />
                            <p>
                                Recibido el pedido, se registra la factura del proveedor y se lleva su
                                pago: <strong>pendiente → pagada</strong>, o <strong>vencida</strong> si se
                                pasó la fecha. La portada de Abastecimiento muestra cuánto hay por pagar
                                (pendiente + vencido) y cuántos pagos están atrasados.
                            </p>
                            <Note tone="warn" title="Todavía en construcción">
                                La factura electrónica (SII) tiene las pantallas listas, falta conectarla.
                            </Note>
                        </Phase>

                        <Phase id="f10" code="Paso 10" title="Se anota el costo donde corresponde">
                            <Meta donde="/finanzas" quien="Jefe de Finanzas · Administrador" />
                            <p>
                                Comprar no termina en la bodega: termina en cuánto ganó o perdió el
                                contrato. Cada vez que el pedido cambia de estado, se anota un movimiento
                                que ya no se toca:
                            </p>
                            <Table
                                head={['Cuándo', 'Qué queda anotado']}
                                rows={[
                                    ['Se emite la orden de compra', <><strong>Comprometido</strong> — plata que ya está tomada, aunque todavía no se haya gastado</>],
                                    ['Llega la mercadería', <><strong>Gastado</strong> — la compra ya ocurrió</>],
                                    ['Se paga la factura', <><strong>Pagado</strong> — la plata salió</>],
                                ]}
                            />
                            <p>
                                Esos tres momentos alimentan el{' '}
                                <strong>presupuesto contra lo real</strong> y{' '}
                                <strong>cuánto gana o pierde cada contrato</strong> — ingresos contra
                                costos, incluyendo sueldos y arriendos.
                            </p>
                            <Note tone="ok" title="La regla de oro">
                                Un movimiento de plata nunca se edita ni se borra. Si hay un error, se anota
                                otro en contra. Por eso siempre se puede ver cómo estaba el contrato en
                                cualquier fecha pasada, sin que nadie haya podido cambiar la historia.
                            </Note>
                        </Phase>

                        <Phase id="ciclo" code="Después" title="Mantención y baja del equipo">
                            <p>
                                <strong>Mantención</strong> (<Route>/pagnol/mantenimiento</Route>): órdenes
                                de trabajo preventivas, correctivas o por falla, con prioridad, responsable,
                                repuestos usados — que descuentan del stock —, horas que el equipo estuvo
                                parado, costo total y por qué falló. El equipo pasa a{' '}
                                <em>En mantención</em> y vuelve a <em>Disponible</em> al cerrarla.
                            </p>
                            <p>
                                <strong>Baja:</strong> un equipo llega a <em>Para baja</em> (se acabó su
                                vida útil, quedó obsoleto) o <em>Extraviado</em>. Los arrendados se cierran
                                al devolverlos; los del cliente, cuando termina el contrato. El equipo se
                                archiva — <strong>no se borra</strong>: su historia sigue disponible.
                            </p>
                        </Phase>
                    </section>

                    {/* ── QUIÉN HACE QUÉ ── */}
                    <section id="roles" className="scroll-mt-24 space-y-6 pt-4">
                        <div className="border-t-2 border-foreground pt-5">
                            <h2 className="text-3xl font-black tracking-tight">Quién hace qué</h2>
                        </div>

                        <Table
                            head={['Rol', 'De qué se hace cargo', 'Dónde trabaja']}
                            rows={[
                                [<strong key="1">Supervisor</strong>, 'Detecta lo que hace falta y lo pide. Registra las devoluciones. Responde por lo que su cuadrilla tiene a cargo.', 'Pedidos, devoluciones'],
                                [<strong key="2">Jefe de Terreno</strong>, 'Lo mismo que el supervisor, sobre el avance de la obra.', 'Pedidos, devoluciones'],
                                [<strong key="3">Jefe de Mantención</strong>, 'Pide repuestos y materiales para los equipos. Ejecuta las órdenes de trabajo y mantiene la ficha del equipo.', 'Pedidos, mantención'],
                                [<strong key="4">Jefe de Oficina Técnica</strong>, 'Pide cargando a cualquier contrato. Vigila que el gasto calce con el presupuesto y el programa.', 'Pedidos, control de obra'],
                                [<span key="5"><strong>ADC</strong><br /><span className="text-muted-foreground text-xs">Administrador de Contratos</span></span>, <><strong>Autoriza o rechaza todo pedido de terreno</strong> antes de que llegue a Abastecimiento. Es quien controla el gasto.</>, 'Autorizaciones'],
                                [<strong key="6">Abastecimiento</strong>, 'Cotiza, compara, elige, emite las órdenes de compra, recibe la mercadería, mantiene los proveedores y lleva los pagos.', 'Módulo Abastecimiento'],
                                [<strong key="7">Pañolero</strong>, 'Tiene el inventario a su cargo. Aprueba pedidos B y C, entrega verificando quién retira, recibe devoluciones, ingresa stock y mueve material entre pañoles.', 'Pañol'],
                                [<strong key="8">Jefe de Finanzas</strong>, 'Facturas, pagos a proveedores y control de lo comprometido y lo gastado.', 'Pagos, Finanzas'],
                                [<strong key="9">Director de Faena</strong>, 'Responsable técnico y legal de la faena. Autoriza como jefatura superior y aprueba los pedidos clase A.', 'Autorizaciones, reportes'],
                                [<strong key="10">Administrador</strong>, 'Dueño de la cuenta. Configura montos de referencia, pañoles, contratos, usuarios y permisos.', 'Toda la aplicación'],
                                [<strong key="11">Operador</strong>, <><strong>No usa la aplicación: queda registrado en ella.</strong> Recibe equipos verificándose con la cara y ve las herramientas que tiene a cargo.</>, 'Recibe entregas'],
                                [<strong key="12">Gerente General</strong>, 'Mira y descarga, sin editar ni aprobar.', 'Reportes'],
                            ]}
                        />

                        <div className="rounded-[1.25rem] border bg-card p-5 flex items-start gap-4">
                            <Users className="h-5 w-5 shrink-0 text-primary mt-0.5" aria-hidden="true" />
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                La lista completa de roles de Pagnol, con lo que ve cada uno, está en{' '}
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
                                                        i === 0 ? 'text-left min-w-[200px]' : 'text-center'
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
                            <h3 className="text-xl font-bold tracking-tight">
                                Nadie puede cerrar el círculo solo
                            </h3>
                            <p className="leading-relaxed">
                                El sistema está armado para que una sola persona no pueda pedir, autorizar,
                                comprar, recibir y pagar:
                            </p>
                            <Table
                                head={['La regla', 'Cómo se hace cumplir']}
                                rows={[
                                    [<strong key="1">Quien pide no autoriza</strong>, 'El que pide desde terreno no tiene el permiso del ADC.'],
                                    [<strong key="2">Quien autoriza no compra</strong>, 'El ADC no puede emitir órdenes de compra.'],
                                    [<strong key="3">Quien compra no guarda</strong>, 'Abastecimiento emite la orden; el pañolero tiene el material.'],
                                    [<strong key="4">Quien guarda no aprueba lo crítico</strong>, 'El pañolero aprueba B y C; la clase A la firma un jefe.'],
                                    [<strong key="5">Quien recibe queda identificado</strong>, 'La entrega se cierra verificando la cara, o con una excepción autorizada — nunca en silencio.'],
                                    [<strong key="6">Quien corrige deja rastro</strong>, 'Los movimientos de plata no se editan: se corrigen con otro movimiento, con nombre y fecha.'],
                                ]}
                            />
                            <p className="leading-relaxed">
                                Los permisos se configuran empresa por empresa: esta tabla muestra cómo
                                viene de fábrica, y cada organización puede apretarlo o soltarlo.
                            </p>
                        </div>

                        <div id="aislamiento" className="scroll-mt-24 space-y-4">
                            <h3 className="text-xl font-bold tracking-tight">Cada empresa ve sólo lo suyo</h3>
                            <p className="leading-relaxed">
                                En Pagnol conviven varias empresas. Cada dato sabe a cuál pertenece, y la
                                base de datos <strong>bloquea por sí misma</strong> cualquier intento de
                                leer o escribir fuera de ella — no depende de que la aplicación se acuerde
                                de filtrar. Ninguna empresa ve el inventario, los precios ni la gente de
                                otra.
                            </p>
                        </div>
                    </section>

                    {/* ── LO QUE FALTA ── */}
                    <section id="pendiente" className="scroll-mt-24 space-y-6 pt-4">
                        <div className="border-t-2 border-foreground pt-5">
                            <h2 className="text-3xl font-black tracking-tight">
                                Lo que todavía estamos construyendo
                            </h2>
                        </div>
                        <p className="leading-relaxed">
                            El proceso funciona completo, de principio a fin. Esto es lo que sigue en
                            camino:
                        </p>
                        <Table
                            head={['Qué', 'Cómo va']}
                            rows={[
                                [<>Recibir <strong>servicios</strong> sin que toquen el inventario</>, 'En construcción'],
                                [<>Que el ADC pueda autorizar <strong>varios pedidos de una vez</strong></>, 'Anotado, todavía no empieza'],
                                [<>Factura electrónica conectada al <strong>SII</strong></>, 'Pantallas listas, falta conectar'],
                                [<>Material de <strong>subcontratistas</strong></>, 'Pensado, sin pantalla todavía'],
                            ]}
                        />
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            Esta página se actualiza junto con la aplicación: cuenta lo que Pagnol hace
                            hoy, no lo que va a hacer.
                        </p>
                    </section>
                </main>
            </div>
        </div>
    );
}
