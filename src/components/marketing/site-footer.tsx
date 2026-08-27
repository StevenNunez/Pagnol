import Link from 'next/link';
import { Mail } from 'lucide-react';

/**
 * Pie compartido por las páginas públicas (landing, precios, Centro de Ayuda).
 * Fondo teal de marca — el mismo del sidebar — así que va sobre superficie fija,
 * no sobre tokens de tema: los colores del texto se declaran en blanco/opacidad.
 */

type FooterLink = { href: string; label: string; external?: boolean };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
    {
        title: 'Producto',
        links: [
            { href: '/#panol', label: 'Pañol Digital' },
            { href: '/#modules', label: 'Módulos' },
            { href: '/#iso', label: 'ISO 55001' },
            { href: '/#hardware', label: 'Hardware' },
            { href: '/pricing', label: 'Planes y Precios' },
            { href: '/demo', label: 'Ver Demo' },
        ],
    },
    {
        title: 'Centro de Ayuda',
        links: [
            { href: '/ayuda', label: 'Manual de Uso' },
            { href: '/ayuda/control-de-activos', label: 'Control de Activos' },
            { href: '/ayuda/control-de-activos#abastecimiento', label: 'Abastecimiento' },
            { href: '/ayuda/roles', label: 'Roles y Responsabilidades' },
        ],
    },
    {
        title: 'Empresa',
        links: [
            { href: '/#about', label: 'Quiénes Somos' },
            { href: '/register', label: 'Crear Cuenta' },
            { href: '/login', label: 'Acceso Personal' },
        ],
    },
];

/** Firma de Teo Labs — letra por letra, reacciona al mouse. */
function TeoLabsSignature() {
    const name = 'Teo Labs';
    return (
        <span className="inline-flex items-baseline">
            <a
                href="https://www.teolabs.app"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-baseline font-black"
                aria-label="Teo Labs"
            >
                <span className="sr-only">Teo Labs</span>
                {name.split('').map((char, i) => (
                    <span
                        key={i}
                        aria-hidden="true"
                        className="inline-block bg-gradient-to-r from-blue-600 via-purple-500 to-green-500 bg-clip-text text-transparent transition-transform duration-200 group-hover:-translate-y-0.5"
                        style={{ transitionDelay: `${i * 20}ms` }}
                    >
                        {char === ' ' ? ' ' : char}
                    </span>
                ))}
            </a>
        </span>
    );
}

export function SiteFooter() {
    return (
        // text-left explícito: la landing lo envuelve en un <footer text-center>.
        <div className="border-t border-white/10 bg-pagnol-teal text-left">
            <div className="max-w-7xl mx-auto px-6 sm:px-8 py-16">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-12">
                    {/* Marca */}
                    <div className="space-y-4">
                        <Link href="/" className="flex flex-col">
                            <span className="text-xl font-black tracking-tighter text-white leading-none">PAGNOL</span>
                            <span className="text-[9px] font-bold tracking-[0.2em] text-pagnol-orange uppercase mt-1">
                                Asset Management
                            </span>
                        </Link>
                        <p className="text-sm text-white/60 leading-relaxed max-w-[28ch]">
                            ERP de gestión de activos para faenas mineras y de construcción.
                        </p>
                        <a
                            href="mailto:contacto@pagnol.cl"
                            className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-pagnol-orange transition-colors"
                        >
                            <Mail className="h-4 w-4" />
                            contacto@pagnol.cl
                        </a>
                    </div>

                    {/* Columnas de enlaces */}
                    {COLUMNS.map((col) => (
                        <div key={col.title} className="space-y-4">
                            <p className="text-[10px] font-black uppercase tracking-widest text-pagnol-orange">
                                {col.title}
                            </p>
                            <ul className="space-y-2.5">
                                {col.links.map((link) => (
                                    <li key={link.href + link.label}>
                                        <Link
                                            href={link.href}
                                            className="text-sm text-white/70 hover:text-white transition-colors"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>

            {/* Línea legal */}
            <div className="border-t border-white/10">
                <div className="max-w-7xl mx-auto px-6 sm:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 text-center sm:text-left">
                        © {new Date().getFullYear()} Pagnol Asset Management. Todos los derechos reservados.
                    </p>
                    <p className="text-[14px] text-white/60">
                        Desarrollado por <TeoLabsSignature /> ®
                    </p>
                </div>
            </div>
        </div>
    );
}
