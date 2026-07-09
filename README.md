# PAGNOL — Asset Management

**Control Total en el Corazón de la Faena**

PAGNOL es un SaaS multi-tenant de gestión operativa para empresas de construcción y faenas mineras. El núcleo del producto es el **módulo Pagnol**: un pañol digital que centraliza inventario, activos, personal y trazabilidad en tiempo real.

---

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS, Radix UI, Framer Motion |
| Backend | Next.js API Routes (App Router) |
| Base de datos | PostgreSQL via Supabase (RLS multi-tenant) |
| Auth | Supabase Auth (email/password + OAuth) |
| AI | Google Genkit + Gemini API |
| Biometría | Face-API.js (`@vladmandic/face-api`) — verificación facial 1:1 en el navegador |
| Credenciales | QR (`html5-qrcode` / `qrcode.react`), tokens de enrolamiento |
| Reportes | jsPDF, ExcelJS, Recharts; PDFs de servidor con puppeteer-core + @sparticuz/chromium |
| Notificaciones | Web Push (VAPID) + Service Worker |
| Offline | Dexie (IndexedDB) + outbox de sincronización (scoped a Órdenes de Trabajo) |
| Deploy | Vercel |

---

## Módulos Principales

Núcleo operacional

- **Pagnol** — Pañol digital y superficie única de activos: activos (ISO 55001), movimientos/despacho biométrico, personal, mantenimiento (OT), reportes IA. Es también la referencia del sistema de diseño.
- **Bodega / Pañol** — Materiales, stock, solicitudes; **stock por contrato y pañol** (`material_stocks` + warehouses) con valorización por centro de costo.
- **Reportes de Trabajo** — Reportes de terreno en cascada: OT → diario → semanal (formato SQM 4 páginas), con PDF y firmas en cada nivel.
- **Reportes** — Tableros de entregas, inventario, estadísticas y valorización de stock por contrato (export Excel).

Abastecimiento y finanzas

- **Abastecimiento** — Hub de compras: solicitudes, RFQ + comparador de cotizaciones, órdenes, recepción ligada a OC, proveedores 360°, costos (centros de costo), reportes/alertas.
- **Compras** — Solicitudes y órdenes de compra, proveedores, lotes.
- **Pagos** — Facturas, adelantos, pagos a proveedores.
- **Arriendos** — Contratos de arriendo, arrendadores (unificados con proveedores), pagos; las OC de arriendo materializan cada equipo como activo Pagnol.
- **Estado de Pago** — Estados de pago de contratos.
- **DTE** — Facturación electrónica Chile (UI lista, backend pendiente).

Personas, seguridad y control

- **Asistencia** — Registro diario, reportes semanales/mensuales, cálculo de remuneraciones, finiquitos.
- **RRHH** — Empleados, documentos, solicitudes de trabajadores.
- **Seguridad (CPHS)** — Charlas diarias, checklists, inspecciones, observaciones de conducta.
- **Control de Obra** — WBS, Gantt, protocolos de calidad.
- **Autorizaciones (ADC)** — Gate previo a Abastecimiento para solicitudes de material, compra y arriendo.

Administración

- **Usuarios** — Gestión de usuarios, credenciales QR, permisos por tenant.
- **Configuración** — Datos de empresa, logo, prefijos de correlativos.
- **Wallet** — Anticipos de sueldo.

---

## Configuración Local

### 1. Clonar e instalar

```bash
git clone https://github.com/tu-usuario/pagnol.git
cd pagnol
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env.local
# Edita .env.local con tus credenciales de Supabase, Gemini, SMTP y VAPID
```

### 3. Modelos biométricos (Face-API)

```bash
node scripts/download-models.js
```

### 4. Desarrollo

```bash
npm run dev
```

---

## Deploy en Vercel

1. Conecta el repositorio en [vercel.com](https://vercel.com)
2. Framework: **Next.js** (detección automática)
3. Agrega las variables de entorno del `.env.example` en Vercel → Settings → Environment Variables
4. Deploy

---

## Seguridad

- Nunca subas `.env`, `.env.local` ni `.env.production` al repositorio
- Las variables de entorno se configuran en Vercel Dashboard, no en el código
- Supabase RLS (Row Level Security) aísla los datos por tenant en todas las queries
- Service Role Key solo se usa en API Routes del servidor, nunca en el cliente

---

## Estructura del Proyecto

```
src/
├── app/              # Next.js App Router (páginas y API routes)
├── components/       # Componentes UI reutilizables
├── modules/
│   ├── auth/         # AuthProvider, hooks de autenticación
│   ├── core/         # Tipos, permisos, cliente Supabase, hooks de datos
│   ├── data/         # DataProvider, mutations, mappers
│   └── offline/      # Motor offline (Dexie + outbox + sync) — solo OT
├── ai/               # Flujos Genkit (assistant, safety, reports, extracción de PDF)
├── actions/          # Server Actions
├── hooks/            # Hooks personalizados
└── lib/              # Utilidades (PDF, push, seguridad)
```
