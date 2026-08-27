import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Info } from 'lucide-react';

export const metadata: Metadata = {
    title: 'Roles y Responsabilidades',
    description:
        'Los roles de PAGNOL: qué hace cada uno y qué parte de la aplicación ve. ' +
        'La referencia para decidir a quién le das cada acceso.',
};

const ACTUALIZADO = '27 de agosto de 2026';

type Role = { name: string; what: string; sees: string };

const GROUPS: { title: string; hint: string; roles: Role[] }[] = [
    {
        title: 'Quien manda en la cuenta',
        hint: 'Control total de la empresa',
        roles: [
            {
                name: 'Administrador',
                what: 'Dueño de la cuenta. Control total de su empresa: usuarios, roles, módulos y configuración.',
                sees: 'Todo',
            },
            {
                name: 'Soporte Pagnol',
                what: 'Cuenta de apoyo que crea el administrador para el equipo de Pagnol. Puede lo mismo, pero se distingue en la lista de usuarios para saber quién hizo qué.',
                sees: 'Todo',
            },
        ],
    },
    {
        title: 'Jefaturas',
        hint: 'Quienes autorizan, validan y firman',
        roles: [
            {
                name: 'Director de Faena',
                what: 'Responsable técnico y legal de la faena (DS 132). Ve toda la operación, autoriza como jefatura superior y aprueba los pedidos más críticos.',
                sees: 'Pañol · Bodega · Control de Obra · Reportes de Terreno · Seguridad · Asistencia · Reportes · Compras · Usuarios · Autorizaciones',
            },
            {
                name: 'ADC — Administrador de Contratos',
                what: 'Autoriza los pedidos de terreno (material, compra y arriendo) antes de que Abastecimiento los gestione. Da la aprobación final de los reportes de terreno, y aprueba y paga los estados de pago.',
                sees: 'Autorizaciones · Reportes de Terreno · Arriendos',
            },
            {
                name: 'Jefe de Operaciones',
                what: 'Revisa, firma y descarga los reportes de terreno.',
                sees: 'Reportes de Terreno',
            },
            {
                name: 'Gerente General',
                what: 'Sólo mira y descarga informes. No edita ni aprueba nada.',
                sees: 'Reportes de Terreno',
            },
            {
                name: 'Jefe de Turno',
                what: 'Lleva un turno: quién está presente, las herramientas y la seguridad del período.',
                sees: 'Pañol · Asistencia · Seguridad',
            },
        ],
    },
    {
        title: 'Terreno',
        hint: 'De aquí nacen los pedidos',
        roles: [
            {
                name: 'Jefe de Terreno',
                what: 'Lleva el avance de la obra y a los supervisores. Pide y devuelve material.',
                sees: 'Control de Obra · Bodega · Reportes de Terreno · Arriendos',
            },
            {
                name: 'Supervisor',
                what: 'Pide materiales, registra devoluciones y maneja su cuadrilla. Crea y firma los reportes de terreno.',
                sees: 'Pañol · Reportes de Terreno',
            },
            {
                name: 'Operador',
                what: 'No usa la aplicación: queda registrado en ella. Ve las herramientas que tiene a cargo; su participación es quedar identificado en asistencia, entregas y firmas.',
                sees: 'Sólo sus herramientas',
            },
            {
                name: 'Contratista',
                what: 'Entra a sus contratos y estados de pago, y registra el avance de sus partidas.',
                sees: 'Control de Obra',
            },
        ],
    },
    {
        title: 'Oficina técnica y calidad',
        hint: 'Planificación, medición y control',
        roles: [
            {
                name: 'Jefe de Oficina Técnica',
                what: 'Arma el programa y los presupuestos; sigue el avance técnico y financiero de la obra. Puede pedir cargando a cualquier contrato.',
                sees: 'Control de Obra · Compras · Bodega · Reportes · Reportes de Terreno · Arriendos',
            },
            {
                name: 'Calidad',
                what: 'Verifica que las partidas estén bien ejecutadas y aprueba los protocolos.',
                sees: 'Control de Obra · Reportes de Terreno',
            },
            {
                name: 'Geólogo',
                what: 'Datos técnicos de avance, cubicaciones y reportes geológicos.',
                sees: 'Control de Obra · Reportes',
            },
            {
                name: 'Topógrafo',
                what: 'Registra mediciones y avances; genera los reportes de levantamiento.',
                sees: 'Control de Obra · Reportes',
            },
        ],
    },
    {
        title: 'Pañol, compras y plata',
        hint: 'El ciclo del control de activos',
        roles: [
            {
                name: 'Pañolero',
                what: 'Lleva el pañol día a día: inventario, entregas verificadas, devoluciones, ingreso de stock y traslados entre pañoles. Aprueba los pedidos de clase B y C.',
                sees: 'Pañol · Bodega',
            },
            {
                name: 'Abastecimiento',
                what: 'Todo el ciclo de compras: pedidos, cotizaciones, comparación, órdenes de compra, recepción, proveedores, pagos y arriendos.',
                sees: 'Abastecimiento · Compras · Pagos · Bodega · Pañol · Arriendos',
            },
            {
                name: 'Jefe de Mantención',
                what: 'Mantención de equipos y herramientas; pide repuestos y materiales.',
                sees: 'Pañol · Bodega · Compras · Reportes',
            },
            {
                name: 'Jefe de Finanzas',
                what: 'Facturas, pagos a proveedores y control de la planilla.',
                sees: 'Facturación · Pagos · Compras · Asistencia · Reportes · Reportes de Terreno',
            },
        ],
    },
    {
        title: 'Personas y seguridad',
        hint: 'Quién cuida a la gente',
        roles: [
            {
                name: 'Recursos Humanos',
                what: 'Ficha de empleados, vacaciones y licencias, documentos, asistencia y usuarios.',
                sees: 'RRHH · Asistencia · Usuarios · Reportes de Terreno',
            },
            {
                name: 'APR (Prevencionista)',
                what: 'Checklists, inspecciones y observaciones de seguridad.',
                sees: 'Seguridad · Usuarios · Bodega · Reportes · Reportes de Terreno',
            },
            {
                name: 'Comité Paritario (CPHS)',
                what: 'Comité Paritario de Higiene y Seguridad: charlas diarias, checklists e inspecciones.',
                sees: 'Seguridad · Bodega · Usuarios',
            },
            {
                name: 'Guardia',
                what: 'Toma la asistencia con código QR en la entrada a la faena.',
                sees: 'Asistencia',
            },
        ],
    },
];

export default function RolesPage() {
    return (
        <div className="max-w-4xl mx-auto px-6 sm:px-8 py-12 sm:py-16 space-y-14 animate-in fade-in duration-500">
            <Link
                href="/ayuda"
                className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
                <ArrowLeft className="h-4 w-4" />
                Centro de Ayuda
            </Link>

            <header className="border-b-2 border-foreground pb-8">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-6">
                    Actualizado: {ACTUALIZADO}
                </p>
                <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-balance mb-5">
                    Roles y responsabilidades
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl">
                    Cada persona en Pagnol tiene un rol, y ese rol decide qué ve y qué puede hacer.
                    Están pensados para cómo se organiza de verdad una faena, y ninguno está grabado
                    en piedra: la empresa puede apretarlos o soltarlos.
                </p>
            </header>

            {/* Cómo funcionan */}
            <section className="space-y-5">
                <h2 className="text-2xl font-black tracking-tight">Cómo funcionan</h2>
                <p className="leading-relaxed">
                    Hay más de 150 permisos distintos, agrupados por tema: materiales y stock, pedidos,
                    compras, pagos, autorizaciones, reportes, seguridad, personas, control de obra,
                    arriendos, usuarios y configuración. Un rol es simplemente un paquete de esos
                    permisos, armado para un cargo real.
                </p>
                <ul className="space-y-3">
                    {[
                        {
                            t: 'El rol define el piso',
                            d: 'Cada rol viene con un paquete de permisos pensado para ese cargo. Es el punto de partida.',
                        },
                        {
                            t: 'La empresa lo ajusta',
                            d: 'Se le pueden agregar o quitar permisos al rol completo, y eso vale sólo para esa empresa: no afecta a las demás.',
                        },
                        {
                            t: 'Y una persona puede tener algo extra',
                            d: 'Si alguien necesita un permiso puntual, se le da a esa persona sin cambiarle el rol a todo el mundo.',
                        },
                    ].map((r, i) => (
                        <li key={r.t} className="flex gap-4 rounded-[1.25rem] border bg-card px-5 py-4">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-black text-primary">
                                {i + 1}
                            </span>
                            <div className="min-w-0">
                                <p className="font-bold leading-snug">{r.t}</p>
                                <p className="text-sm text-muted-foreground mt-0.5">{r.d}</p>
                            </div>
                        </li>
                    ))}
                </ul>
                <div className="rounded-[1.25rem] border-l-4 border-y border-r border-info bg-info-subtle text-info-subtle-foreground p-5 flex gap-4">
                    <Info className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="space-y-2 text-sm leading-relaxed">
                        <p>
                            <strong>Dos permisos que conviene entender:</strong> los de{' '}
                            <strong>acceso a un módulo</strong> deciden si ese módulo aparece o no en el
                            menú de la izquierda — son el interruptor grueso.
                        </p>
                        <p>
                            Y los de <strong>clase A, B y C</strong> escalonan quién puede aprobar un
                            pedido según qué tan crítico sea lo que se pide — está explicado en{' '}
                            <Link href="/ayuda/control-de-activos#f3" className="font-bold underline">
                                el paso 3 del control de activos
                            </Link>
                            .
                        </p>
                    </div>
                </div>
            </section>

            {/* Los roles */}
            <section className="space-y-10">
                <h2 className="text-2xl font-black tracking-tight">Los roles, uno por uno</h2>
                {GROUPS.map((group) => (
                    <div key={group.title} className="space-y-4">
                        <div className="border-t pt-5">
                            <h3 className="text-xl font-bold tracking-tight">{group.title}</h3>
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-1">
                                {group.hint}
                            </p>
                        </div>
                        <div className="space-y-3">
                            {group.roles.map((role) => (
                                <div key={role.name} className="rounded-[1.25rem] border bg-card p-5 space-y-2">
                                    <p className="font-bold text-lg tracking-tight">{role.name}</p>
                                    <p className="text-sm leading-relaxed text-muted-foreground">{role.what}</p>
                                    <p className="text-[11px] font-bold text-muted-foreground pt-1">
                                        <span className="uppercase tracking-widest text-primary">Ve:</span>{' '}
                                        {role.sees}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </section>

        </div>
    );
}
