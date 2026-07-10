import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/modules/auth/AuthProvider";
import { ServiceWorkerUpdater } from "@/components/service-worker-updater";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  themeColor: '#f15a24',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.pagnol.cl';

const SEO_DESCRIPTION =
  'PAGNOL es el ERP chileno de gestión de activos para faenas mineras y de construcción: ' +
  'control de inventario y activos en tiempo real, pañol digital con QR y biometría, ' +
  'mantenimiento de equipos, bodega, abastecimiento, asistencia y reportes de terreno.';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: 'PAGNOL — ERP de Gestión de Activos para Minería y Construcción',
    template: '%s | PAGNOL ERP',
  },
  description: SEO_DESCRIPTION,
  keywords: [
    'ERP', 'ERP minero', 'ERP minería', 'ERP construcción', 'ERP Chile',
    'soluciones mineras', 'servicios mineros', 'software minero',
    'control de inventario', 'control de activos', 'gestión de activos',
    'activos mineros', 'trazabilidad de activos', 'pañol digital',
    'bodega minera', 'mantenimiento de equipos', 'gestión de faena',
  ],
  applicationName: 'PAGNOL',
  authors: [{ name: 'TeoLabs', url: 'https://teolabs.app' }],
  creator: 'TeoLabs',
  // './' se resuelve contra metadataBase por ruta → canonical correcto en cada página.
  alternates: { canonical: './' },
  openGraph: {
    type: 'website',
    locale: 'es_CL',
    url: APP_URL,
    siteName: 'PAGNOL',
    title: 'PAGNOL — ERP de Gestión de Activos para Minería y Construcción',
    description: SEO_DESCRIPTION,
    images: [
      {
        url: '/img/landing/dashboard.png',
        width: 1200,
        height: 630,
        alt: 'Panel de control PAGNOL — gestión de activos mineros en tiempo real',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PAGNOL — ERP de Gestión de Activos para Minería y Construcción',
    description: SEO_DESCRIPTION,
    images: ['/img/landing/dashboard.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'PAGNOL',
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

// Datos estructurados (schema.org) para resultados enriquecidos en Google.
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${APP_URL}/#org`,
      name: 'PAGNOL',
      url: APP_URL,
      logo: `${APP_URL}/logo.png`,
      email: 'contacto@pagnol.cl',
      description: SEO_DESCRIPTION,
      parentOrganization: { '@type': 'Organization', name: 'TeoLabs', url: 'https://teolabs.app' },
      areaServed: 'CL',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'PAGNOL',
      url: APP_URL,
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'ERP de gestión de activos para minería y construcción',
      operatingSystem: 'Web',
      inLanguage: 'es-CL',
      description: SEO_DESCRIPTION,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'CLP', description: 'Demo gratuita' },
      publisher: { '@id': `${APP_URL}/#org` },
      featureList: [
        'Control de inventario en tiempo real',
        'Control y trazabilidad de activos mineros',
        'Pañol digital con credenciales QR y biometría facial',
        'Mantenimiento de equipos y órdenes de trabajo',
        'Bodega, abastecimiento y compras',
        'Asistencia, turnos y gestión de personal de faena',
        'Reportes de terreno con firmas digitales',
      ],
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning className="scroll-smooth light">
      <body className={`${inter.className} antialiased`} suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <AuthProvider>
            {children}
            <Toaster />
            <ServiceWorkerUpdater />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
