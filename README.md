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
| Biometría | Face-API.js (reconocimiento facial 1:N) |
| Reportes | jsPDF, ExcelJS, Recharts |
| Notificaciones | Web Push (VAPID) |
| Deploy | Vercel |

---

## Módulos Principales

- **Pagnol** — Pañol digital: activos, movimientos, personal, biometría, reportes IA
- **Bodega** — Materiales, solicitudes de compra, devoluciones
- **Asistencia** — Registro diario, horas extra, finiquitos
- **Seguridad (CPHS)** — Charlas, checklists, inspecciones, observaciones
- **Pagos** — Facturas, adelantos, proveedores
- **Compras** — Solicitudes y órdenes de compra
- **Control de Obra** — WBS, Gantt, protocolos
- **Estado de Pago** — Contratos y contratos de obra

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
│   ├── core/         # Tipos, permisos, cliente Supabase
│   └── data/         # DataProvider, mutations, mappers
├── ai/               # Flujos Genkit (assistant, safety, reports)
├── actions/          # Server Actions
├── hooks/            # Hooks personalizados
└── lib/              # Utilidades (PDF, push, seguridad)
```
