# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint via next lint
npm run demo:create  # Seed a demo tenant (requires DEMO_EMAIL + DEMO_PASSWORD in .env.local)
```

No test suite exists. TypeScript type-checking is the main correctness tool — `npx tsc --noEmit` to check types without building.

## Architecture

**Pagnol** is a multi-tenant SaaS ERP for mining/construction faenas. Stack: Next.js 16 App Router, React 19, Supabase (Postgres + Auth + Realtime), Tailwind/Radix/shadcn, Google Genkit for AI, `date-fns` for date math.

### Data Flow

```
Supabase (Postgres, RLS-enforced)
  └─ useSupabaseCollection (src/modules/core/hooks/use-supabase-collection.ts)
       Paginates 1000-row batches, filters by tenant_id, subscribes to Realtime
  └─ mappers.ts (src/modules/data/mappers.ts)
       Pure functions: DB snake_case rows → camelCase TypeScript interfaces
  └─ DataProvider (src/modules/data/DataProvider.tsx)
       useReducer with SET_DATA / SET_ROLES / SET_LOADING actions
       Holds 30+ collections in AppDataState
  └─ useAppState() → any page or component
```

`AppDataState` shape lives in `src/modules/data/types.ts`. All TypeScript domain types are in `src/modules/core/lib/data.ts`.

### Auth & Multi-Tenancy

`AuthProvider` (`src/modules/auth/AuthProvider.tsx`) listens to Supabase `onAuthStateChange`, then fetches the matching `profiles` row to build the `User` object. RLS on every Supabase table enforces `tenant_id` isolation — the anon client respects it automatically. The admin client (`getSupabaseAdmin()`) bypasses RLS and is server-only.

- Login supports email **or RUT** (resolves to email via `profiles.rut`).
- Super-admins can switch tenants via `setCurrentTenantId()`; selection is persisted in `localStorage`.

The `can(permission)` function (exposed via both `useAuth()` and `useAppState()`) checks in order: super-admin shortcut → `user.grantedPermissions[]` → `ROLES_DEFAULT[role].permissions[]`.

### Mutation Pattern

All mutations live in `src/modules/data/mutations/` grouped by domain (e.g. `attendanceMutations.ts`, `genericMutations.ts`). They are plain async functions with a `Context = { user, tenantId, db }` last argument:

```typescript
export async function addFoo(data: Partial<Foo>, { user, tenantId }: Context) { ... }
```

`DataProvider` wraps each mutation with `bindContext` to inject `user` and `tenantId` automatically, then exposes the bound versions through `useAppState()`. **Never call mutations directly — always get them from `useAppState()`.**

### Permissions

Defined in `src/modules/core/lib/permissions.ts`. Each permission has a `label` and `group`. Default sets per role live in `ROLES_DEFAULT`. To add a new permission:
1. Add to `ALL_PERMISSIONS` with label + group.
2. Add to the appropriate role(s) in `ROLES_DEFAULT`.
3. Check in components with `can('your:permission')`.

Key permission patterns:
- `module_{name}:view` gates sidebar visibility for entire modules.
- Approval workflows have tiered permissions: `_class_a` / `_class_b` / `_class_c` matching the material criticality field.

### Adding a New Data Entity

1. Define interface in `src/modules/core/lib/data.ts`.
2. Add mapper in `src/modules/data/mappers.ts`.
3. Add collection to `AppDataState` in `src/modules/data/types.ts`.
4. Create `src/modules/data/mutations/{entity}Mutations.ts`.
5. Wire into `DataProvider.tsx`: add `useSupabaseCollection` call + `bindContext` the mutations + include in the returned context value.
6. Create pages under `src/app/dashboard/{module}/`.
7. Add nav entry in `src/components/sidebar.tsx`.

### API Routes

Server-side operations that must bypass RLS (user creation, invitations, bulk upload) live in `src/app/api/`. They use `getSupabaseAdmin()`. Everything else should go through the client-side mutation pattern above.

### AI (Genkit)

Flows are in `src/ai/flows/`. Each exports an async function backed by `ai.defineFlow()` with Zod schemas. The `ai` instance (`src/ai/genkit.ts`) initializes `googleAI()` only when `GEMINI_API_KEY` is present. The `InventoryAssistant` component in the dashboard layout is the main AI entry point.

### UI Conventions

- All UI primitives come from `src/components/ui/` (shadcn/Radix wrappers).
- `@/*` resolves to `src/*` (see tsconfig paths).
- Forms use `react-hook-form` + `zodResolver`.
- PDF export uses `jspdf` + `jspdf-autotable` (see `monthly-report` and `severance` pages for the pattern).
- Page-level components are always `"use client"` and consume context; no server components inside `/dashboard`.

### Design System (UI Standard) — el módulo **Pagnol** es la referencia

Toda página de `/dashboard` DEBE seguir este estándar. El lenguaje visual canónico vive en `src/app/dashboard/pagnol/*` (activos, movimientos, personal).

**Tokens — nunca colores crudos.** Usa SIEMPRE tokens semánticos, nunca paletas de Tailwind (`slate`, `gray`, `amber`, `zinc`) ni hex (`bg-[#...]`). Los tokens ya se adaptan a dark mode; las paletas crudas no.
- Superficies: `bg-background` (página), `bg-card` (tarjetas/paneles), `bg-popover` (dropdowns).
- Texto: `text-foreground` (principal), `text-muted-foreground` (secundario/labels). NUNCA `text-slate-700`.
- Acción: `bg-primary text-primary-foreground` (naranja Pagnol). Bordes: `border` / `border-border`.
- Estados: `success` / `warning` / `info` / `destructive` y sus variantes `-subtle` / `-subtle-foreground` para badges. Helpers: `.badge-success`, `.badge-warning`, `.badge-info`.

**Layout maestro de página** (estructura idéntica en todo módulo):
```tsx
<div className="space-y-8 animate-in fade-in duration-500">
  <PageHeader title="…" description="…" />        {/* alimenta la barra superior */}
  {/* Toolbar opcional: filtros/búsqueda/acciones */}
  <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6"> … </div>
  {/* Contenido en <Card> */}
</div>
```
- Espaciado vertical de página: `space-y-8` (NO `gap-6`/`gap-8` sueltos, NO `space-y-4/6`).
- Animación de entrada: `animate-in fade-in duration-500` en el wrapper raíz.

**Radios (firma Pagnol):** tarjetas/paneles grandes `rounded-[1.5rem]`–`rounded-[2.5rem]`; controles (inputs, selects, badges) `rounded-xl`. Evita `rounded-md`/`rounded-lg` sueltos en superficies grandes.

**Tipografía:**
- Título de página → solo vía `<PageHeader>` (lo pinta el layout). No dupliques `<h1 text-3xl>` en el cuerpo.
- Micro-label industrial (la firma): `text-[10px] font-black uppercase tracking-widest text-muted-foreground`.
- Título de sección/tarjeta: `CardTitle` o `text-lg font-bold`. No inventes escalas nuevas.

**Componentes base compartidos (úsalos, no los re-implementes):** primitivos `Button`, `Card`, `Input`, `Select`, `Dialog`, `Table`, `Badge` desde `src/components/ui/`. Y los compartidos de página:
- `PageShell` (`src/components/page-shell.tsx`) — layout maestro (wrapper + animación + PageHeader + toolbar). Envuelve toda página en esto.
- `EmptyState` (`src/components/empty-state.tsx`) — estado vacío. NO escribas "No hay datos" a mano.
- `LoadingState` (`src/components/loading-state.tsx`) — spinner. NO copies `<Loader2 className="animate-spin">` por página.
- `DataTable` (`src/components/data-table.tsx`) — tabla con columnas tipadas + estados loading/vacío integrados.
- `PageHeader` (`src/components/page-header.tsx`) — setea el título de la barra superior (lo usa PageShell internamente).

**Botones:** `<Button>` con sus variantes (`default`/`outline`/`secondary`/`ghost`/`destructive`). Acciones primarias destacadas pueden añadir `rounded-[1.5rem]` + `shadow-lg shadow-primary/10` + `hover:scale-105 active:scale-95`.

**Dark mode:** garantizado por usar tokens. Si necesitas un par claro/oscuro manual es señal de que deberías usar un token. Prohibido `text-slate-*`/`bg-*-50` sin su `dark:`.

### Module Map

`/dashboard` sub-routes and their purpose:
- `pagnol/` — Asset management core (activos, movimientos, mantenimiento, OT)
- `bodega/` — Materials warehouse, stock, requests
- `attendance/` — Daily attendance, weekly/monthly reports, payroll calc, severance
- `safety/` — CPHS: daily talks, checklists, inspections, behavior observations
- `purchasing/` — Purchase requests, orders, suppliers, lots
- `payments/` — Invoices, advances, supplier payments
- `construction-control/` — Gantt, WBS, quality protocols
- `estado-pago/` — Contract payment states
- `users/` — User management, QR credentials, permissions
- `wallet/` — Salary advances
- `dte/` — Chilean tax invoicing (UI complete, backend pending)
