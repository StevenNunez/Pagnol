import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Info } from 'lucide-react';

export const metadata: Metadata = {
    title: 'Roles y Responsabilidades',
    description:
        'Los 24 roles de PAGNOL: qué hace cada uno, qué módulos ve y cómo se resuelve un permiso. ' +
        'Referencia para decidir quién entra a qué dentro del ERP.',
};

const FECHA_CORTE = '27 de agosto de 2026';

type Role = { name: string; what: string; sees: string };

const GROUPS: { title: string; hint: string; roles: Role[] }[] = [
    {
        title: 'Administración de la plataforma',
        hint: 'Control total, con distinto alcance',
        roles: [

            {
                name: 'Administrador',
                what: 'Dueño de la cuenta. Control total de su empresa: usuarios, roles, módulos y configuración.',
                sees: 'Todos los de su empresa',
            },
            {
                name: 'Soporte Pagnol',
                what: 'Cuenta de soporte interno creada por el administrador de la empresa. Mismos permisos, pero identificable por separado en la lista de usuarios y en la auditoría.',
                sees: 'Todos los de su empresa',
            },
        ],
    },
    {
        title: 'Mando operacional',
        hint: 'Quienes autorizan, validan y firman',
        roles: [
            {
                name: 'Director de Faena',
                what: 'Responsable técnico y legal de la operación minera (DS 132). Visibilidad total operacional; autoriza como mando superior y aprueba solicitudes clase A.',
                sees: 'Pagnol · Bodega · Control de Obra · Reportes de Trabajo · Seguridad · Asistencia · Reportes · Compras · Usuarios · Autorizaciones',
            },
            {
                name: 'ADC — Administrador de Contratos',
                what: 'Autoriza las solicitudes de terreno (material, compra y arriendo) antes de que Abastecimiento las gestione. Da la aprobación final de los informes de trabajo y aprueba y paga estados de pago.',
                sees: 'Autorizaciones · Reportes de Trabajo · Arriendos',
            },
            {
                name: 'Jefe de Operaciones',
                what: 'Valida, firma y descarga los informes de terreno en revisión operacional.',
                sees: 'Reportes de Trabajo',
            },
            {
                name: 'Gerente General',
                what: 'Observador de alto nivel: visualiza y descarga informes, sin editar ni aprobar.',
                sees: 'Reportes de Trabajo',
            },
            {
                name: 'Jefe de Turno',
                what: 'Gestiona un turno: personal presente, herramientas y seguridad del período.',
                sees: 'Pagnol · Asistencia · Seguridad',
            },
        ],
    },
    {
        title: 'Terreno y ejecución',
        hint: 'De donde nace la necesidad',
        roles: [
            {
                name: 'Jefe de Terreno',
                what: 'Gestiona el avance físico de la obra y a los supervisores. Solicita y devuelve.',
                sees: 'Control de Obra · Bodega · Reportes de Trabajo · Arriendos',
            },
            {
                name: 'Supervisor',
                what: 'Solicita materiales, registra devoluciones y gestiona su cuadrilla. Crea y firma los informes de terreno.',
                sees: 'Pagnol · Reportes de Trabajo',
            },
            {
                name: 'Operador',
                what: 'No opera la aplicación: queda registrado en ella. Ve las herramientas a su cargo; su participación es ser identificado en asistencia, entregas y firmas.',
                sees: 'Pagnol (sólo sus herramientas)',
            },
            {
                name: 'Contratista',
                what: 'Accede a sus contratos y estados de pago, y registra el avance de sus partidas.',
                sees: 'Control de Obra',
            },
        ],
    },
    {
        title: 'Técnica y calidad',
        hint: 'Planificación, medición y verificación',
        roles: [
            {
                name: 'Jefe de Oficina Técnica',
                what: 'Planifica la Carta Gantt y los presupuestos; supervisa el avance técnico y financiero de la obra. Solicita imputando a cualquier contrato.',
                sees: 'Control de Obra · Compras · Bodega · Reportes · Reportes de Trabajo · Arriendos',
            },
            {
                name: 'Calidad',
                what: 'Verifica la correcta ejecución de las partidas de obra y aprueba los protocolos.',
                sees: 'Control de Obra · Reportes de Trabajo',
            },
            {
                name: 'Geólogo',
                what: 'Datos técnicos de avance, cubicaciones y reportes geológicos.',
                sees: 'Control de Obra · Reportes',
            },
            {
                name: 'Topógrafo',
                what: 'Registra mediciones y avances; genera reportes de levantamiento.',
                sees: 'Control de Obra · Reportes',
            },
        ],
    },
    {
        title: 'Activos, abastecimiento y dinero',
        hint: 'El ciclo que documenta PROC-01',
        roles: [
            {
                name: 'Pañolero',
                what: 'Operador diario del pañol digital: inventario, entregas verificadas, devoluciones, ingreso de stock y transferencias. Aprueba solicitudes clase B y C.',
                sees: 'Pagnol · Bodega',
            },
            {
                name: 'Abastecimiento',
                what: 'Ciclo completo de compras: solicitudes, RFQ, comparación, órdenes de compra, recepción, proveedores, pagos y arriendos.',
                sees: 'Abastecimiento · Compras · Pagos · Bodega · Pagnol · Arriendos',
            },
            {
                name: 'Jefe de Mantención',
                what: 'Mantenimiento de equipos y herramientas; solicita repuestos y materiales.',
                sees: 'Pagnol · Bodega · Compras · Reportes',
            },
            {
                name: 'Jefe de Finanzas',
                what: 'Facturas, pagos a proveedores y control de la planilla.',
                sees: 'DTE · Pagos · Compras · Asistencia · Reportes · Reportes de Trabajo',
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
                sees: 'RRHH · Asistencia · Usuarios · Reportes de Trabajo',
            },
            {
                name: 'APR (Prevencionista)',
                what: 'Checklists, inspecciones y observaciones de seguridad.',
                sees: 'Seguridad · Usuarios · Bodega · Reportes · Reportes de Trabajo',
            },
            {
                name: 'Comité Paritario (CPHS)',
                what: 'Comité Paritario de Higiene y Seguridad: charlas diarias, checklists e inspecciones.',
                sees: 'Seguridad · Bodega · Usuarios',
            },
            {
                name: 'Guardia',
                what: 'Registra asistencia con QR en el acceso a faena.',
                sees: 'Asistencia',
            },
        ],
    },
];

const RESOLUTION = [
    { n: '1', q: '¿Es Super Admin?', a: 'Puede todo.' },
    { n: '2', q: '¿Es Administrador o Soporte Pagnol?', a: 'Control total de su empresa.' },
    { n: '3', q: '¿Tiene el permiso otorgado individualmente?', a: 'Los permisos extra dados a esa persona en particular.' },
    { n: '4', q: '¿Lo tiene el rol tal como esta empresa lo configuró?', a: 'La fila del rol en esta empresa.' },
    { n: '5', q: '¿Lo tiene el rol por defecto?', a: 'La definición de fábrica.' },
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
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-6">
                    <span className="text-primary">Roles</span>
                    <span>Documento vivo</span>
                    <span>Corte: {FECHA_CORTE}</span>
                </div>
                <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-balance mb-5">
                    Roles y responsabilidades
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl">
                    Pagnol trae 24 roles predefinidos, pensados para la estructura real de una faena
                    minera o de construcción. Cada rol es un punto de partida configurable: la empresa
                    puede endurecerlo o ampliarlo permiso a permiso.
                </p>
            </header>

            {/* Cómo se resuelve un permiso */}
            <section className="space-y-5">
                <h2 className="text-2xl font-black tracking-tight">Cómo se resuelve un permiso</h2>
                <p className="leading-relaxed">
                    Hay <strong>158 permisos</strong> agrupados en 20 familias. Cuando el sistema
                    pregunta «¿puede esta persona hacer esto?», resuelve en este orden y se detiene en
                    la primera respuesta afirmativa:
                </p>
                <ol className="space-y-3">
                    {RESOLUTION.map((r) => (
                        <li key={r.n} className="flex gap-4 rounded-[1.25rem] border bg-card px-5 py-4">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-black text-primary">
                                {r.n}
                            </span>
                            <div className="min-w-0">
                                <p className="font-bold leading-snug">{r.q}</p>
                                <p className="text-sm text-muted-foreground mt-0.5">{r.a}</p>
                            </div>
                        </li>
                    ))}
                </ol>
                <div className="rounded-[1.25rem] border-l-4 border-y border-r border-info bg-info-subtle text-info-subtle-foreground p-5 flex gap-4">
                    <Info className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="space-y-2 text-sm leading-relaxed">
                        <p>
                            <strong>Dos consecuencias prácticas:</strong> un permiso puede darse a una
                            persona sin cambiarle el rol a todo el mundo; y cambiar un rol en una empresa
                            no afecta a las demás.
                        </p>
                        <p>
                            Dos permisos tienen forma especial: los de{' '}
                            <strong>acceso a módulo</strong> controlan si el módulo aparece en el menú
                            lateral, y los de <strong>clase A / B / C</strong> escalonan la aprobación
                            según la criticidad del ítem — ver{' '}
                            <Link href="/ayuda/control-de-activos#f3" className="font-bold underline">
                                la fase F3 del control de activos
                            </Link>
                            .
                        </p>
                    </div>
                </div>
            </section>

            {/* Los 24 roles */}
            <section className="space-y-10">
                <h2 className="text-2xl font-black tracking-tight">Los 24 roles</h2>
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

            {/* Nota de dimensionamiento */}

        </div>
    );
}
