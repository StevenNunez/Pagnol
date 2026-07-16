# RFC-002 / F0 — Plan de implementación: Fundaciones del Ledger Financiero

**Estado:** EJECUTADO en código (2026-07-16, aprobado por Steven) — pendiente: aplicar la
migración `20260722000000_finance_ledger.sql` en el editor SQL de Supabase y luego la prueba
E2E en navegador. Decisiones de implementación registradas en `docs/decisions/ADR-002`.
Desviaciones del plan: el fallback de UF es re-consulta a la fuente (botón), no digitación
manual (ver ADR-002 §7); se reconstruyó `payments/pago-facturas` (no existía superficie para
registrar/pagar facturas — era un duplicado copy-paste del procesador de cotizaciones).

**Fecha:** 2026-07-16

**Capa (manifiesto v2.0):** Capa 2 — dominio nuevo + esquema. Peajes: este plan + ADR al cierre;
migración de datos no aplica (corte limpio, dominio nuevo); regido por los Artículos 2, 3 y 5.

---

# Decisiones de esta planificación (Steven, 2026-07-15/16)

1. **Corte limpio:** el ledger registra hechos desde que F0 entra a producción. Sin backfill;
   la historia previa vive en sus módulos de origen. (Backfill evaluable después como tarea aparte.)
2. **UF automática:** cron diario (patrón `CRON_SECRET`) consulta mindicador.cl → tabla `uf_rates`,
   con carga manual de respaldo en Configuración. Primer consumidor real: arriendos en F2.
3. **Visibilidad cerrada:** el panel financiero nace solo para `administrador`/`soporte-pagnol`
   (permiso `module_finance:view`). Abrir después es fácil; cerrar después de abrir, caro.
4. **Toda OC nace valorizada + retroalimentación de precios** (idea de Steven, supera las opciones
   originales): la generación de OC precarga precios reales desde el catálogo (`materials.unitCost`,
   calzando por id o nombre), el usuario los confirma/ajusta, y el total queda en la OC. A la
   inversa, cada compra con precio real **actualiza el precio actual del catálogo** cuando el
   producto calza. Compras se convierte en la fuente viva de precios de Pagnol.

# Convenciones de dinero (fijadas aquí, valen para todo el dominio)

- El ledger almacena **montos netos en CLP congelados** al momento del hecho (`amount_net`).
- Moneda origen + monto origen + tasa se guardan siempre (`currency`, `amount_original`, `fx_rate`;
  CLP ⇒ tasa 1). Artículo 2: la tasa del día queda congelada en el hecho.
- Los pagos de factura (`supplier_payments.amount`) se asumen **brutos con IVA 19%**; el emisor
  deriva el neto (`amount / 1.19`) y registra `tax_rate = 19`. Facturas exentas se soportarán
  cuando el dato exista en el documento (hoy no existe).

---

# Entregables

## 1. Migración `supabase/migrations/20260716000000_finance_ledger.sql` (aplicación manual)

**`finance_entries`** — la tabla de hechos económicos:

- Identidad y tiempo: `id`, `tenant_id`, `entry_date` (fecha contable), `created_at`.
- Naturaleza: `nature` ('cost' | 'income'), `stage` ('committed' | 'accrued' | 'paid'),
  `category` ('materials' | 'labor' | 'equipment' | 'subcontract' | 'rental' | 'services' | 'indirect').
- Dinero: `amount_net` (CLP congelado), `currency`, `amount_original`, `fx_rate`, `tax_rate`.
- Dimensiones: `contract_id` + `contract_name` (snapshot), `work_item_id` (F3), `cost_center_id`
  (gasto administrativo), `source_type` + `source_id` + `source_code` (documento origen — texto,
  **sin FK**: el documento puede borrarse, el hecho no), `counterparty_type/id/name` (proveedor…).
- Correcciones: `reversal_of` (self-ref). Un reverso es un hecho nuevo con monto espejo.
- Autoría (Artículo 5): `created_by`, `created_by_name`.
- Índices: `(tenant_id, contract_id)`, `(tenant_id, entry_date)`, `(tenant_id, source_type, source_id)`.
- **RLS (Artículos 1 y 2):** SELECT solo `administrador`/`soporte-pagnol`/super-admin del tenant;
  INSERT cualquier miembro del tenant (sus acciones generan hechos); **UPDATE/DELETE: sin política
  para nadie**. GRANTs explícitos (proyecto post-30-may-2026).
- **No** entra a la publicación Realtime ni al `DataProvider` (decisión de RFC-002: agregación
  server-side).

**`uf_rates`** — global, sin tenant: `rate_date` (pk), `value`, `source`. SELECT para
`authenticated`; escritura solo service role (cron).

**RPC `finance_contract_summary(p_from, p_to)`** — agregación server-side: sumas por
contrato × categoría × etapa del tenant del solicitante. SECURITY INVOKER: hereda el RLS de la
tabla (si no eres admin, no ves nada). Primera ruptura consciente del patrón
`useSupabaseCollection`, tal como fija RFC-002.

**Aditivos:**
- `tenants.labor_cost_factor` numeric default 1.35 (se usa en F1; el campo y su UI de
  Configuración nacen ahora).
- `supplier_payments.purchase_order_id` uuid null — encadena OC → pago (hoy solo hay un string).

## 2. `src/modules/data/mutations/financeLedger.ts` — la librería emisora

Espejo del patrón `stockLedger.ts`:

- `emitFinanceEntries(entries[], ctx)` — inserta hechos con snapshots completos.
- `reverseEntriesForSource(sourceType, sourceId, reason, ctx)` — emite espejos negativos de todos
  los hechos vivos de un documento (idempotente: no re-reversa lo ya reversado).
- Helpers puros de dinero (`toClp`, derivación neto/bruto) — testeables sin Supabase.

Los emisores son llamadas explícitas dentro de las mutaciones (visibles, con contexto de usuario);
nada de triggers.

## 3. Emisores en compras + fixes de integridad preexistentes

| Mutación | Cambio |
|---|---|
| `createPurchaseOrder` (RFQ) | Emite **comprometido** por ítem (precio × cantidad, neto); contrato por ítem vía `requestId` → solicitud; proveedor como contraparte |
| `generatePurchaseOrder` | **Cambio de flujo (decisión 4):** la UI precarga precio por ítem desde el catálogo, exige valorización y guarda `total_amount`; emite comprometido igual que la otra ruta |
| `cancelPurchaseOrder` | **Fix:** hoy hace DELETE de la OC; pasa a `status='cancelled'` (la UI de costos ya filtra ese estado) + reverso de sus hechos |
| `receiveGoodsReceipt` | Emite **devengado** por ítem recibido (precio del ítem de la OC; la resolución de contrato por ítem ya existe) + **retroalimentación de precios**: actualiza `materials.unit_cost` con el precio real de compra cuando el producto calza |
| `deleteGoodsReceipt` | **Fix de bug preexistente:** hoy borra la recepción sin revertir el stock ingresado (viola el espíritu del Artículo 3). Pasa a revertir stock + ledger de stock + kardex, y emite reverso de los hechos financieros |
| `markPaymentAsPaid` | Emite **pagado** (bruto→neto según convención); contrato heredado de la OC vinculada cuando es único, si no "sin contrato" |
| `deleteSupplierPayment` / `updateSupplierPayment` | Reverso de hechos si estaba pagada; update de monto sobre pagada = reverso + hecho nuevo |
| `addSupplierPayment` + UI | Campo opcional "Orden de Compra" (selector) → `purchase_order_id` |

Hechos sin contrato resoluble ⇒ `contract_id = null`, visibles como **"Sin contrato"** en el panel
(dato de calidad de primera clase, patrón áreas internas — nunca se esconden).

## 4. Cron UF — `src/app/api/cron/uf-rate/route.ts`

Bearer `CRON_SECRET` (patrón existente); consulta `mindicador.cl/api/uf`; upsert en `uf_rates`.
Registro en la config de crons del deploy. Fallback: input manual del valor UF en
`/dashboard/configuracion`.

## 5. Permisos y navegación

- `ALL_PERMISSIONS`: `module_finance:view` ('Acceso a Módulos') + `finance:manage`
  ('Finanzas' — reservado para presupuestos F3).
- `ROLES_DEFAULT`: ningún rol lo recibe por defecto (admin/soporte pasan por el bypass de `can()`);
  se otorga explícito a otros roles cuando Steven decida abrirlo.
- Sidebar: entrada "Finanzas" gated por `module_finance:view`.
- Gotcha conocido: tras tocar permisos, recarga dura (HMR deja `AuthProvider` viejo).

## 6. Panel `/dashboard/finanzas` (v1 mínima)

- `PageShell` + firma Pagnol (tokens, radios, micro-labels).
- Selector de rango (default: mes actual).
- KPIs: Comprometido | Devengado | Pagado | Sin contrato (alerta).
- Tabla por contrato: comprometido / devengado / pagado / % devengado sobre comprometido, con
  desglose por categoría expandible.
- Datos vía `supabase.rpc('finance_contract_summary')` — **sin** colección en DataProvider,
  sin Realtime; refetch al cambiar rango.

## 7. Tipos y tests

- Interface `FinanceEntry` en `data.ts` (tipa la librería; sin mapper/colección en F0).
- `financeLedger.test.ts` para los helpers puros de dinero (neto/bruto, UF→CLP, construcción de
  reversos); ampliar el `include` de Vitest para cubrirlo (hoy solo corre `src/modules/offline`).

## 8. Cierre

- `CHANGELOG.md` + actualización de estado en RFC-002 + **ADR-002** (decisiones de esta F0 y
  alternativas rechazadas; el registro pertenece al proyecto).
- **Recordatorio: la migración se aplica manualmente en el editor SQL de Supabase.**

---

# Orden de ejecución

1. Migración SQL (+ aviso de aplicación manual antes de probar).
2. `financeLedger.ts` + tipos + tests de helpers.
3. Emisores en mutaciones de compras + los 2 fixes de integridad.
4. UI: valorización en generación de OC + selector de OC en pagos.
5. Cron UF + campo manual en Configuración (+ `labor_cost_factor` en la misma pantalla).
6. Permisos + sidebar + panel `/dashboard/finanzas`.
7. Verificación: `npx tsc --noEmit`, `npm run build`, y E2E en navegador
   (solicitud → OC valorizada → recepción → pago → panel refleja las tres etapas;
   dev con `npx next dev --webpack`).
8. CHANGELOG + ADR-002 + RFC-002 actualizado.

# Riesgos de esta F0

| Riesgo | Mitigación |
|---|---|
| UPDATE silencioso de 0 filas (RLS) | `.select()` guarda en todo update crítico (gotcha documentado) |
| Doble emisión de comprometido (dos rutas de OC) | Emisión centralizada en `financeLedger` por `source_id`; test de idempotencia |
| Recepciones de OC legacy sin precio (pre-F0) | Fallback a `unitCost` del catálogo + hecho marcado en `notes`; las OC nuevas siempre traen precio |
| Cambio de flujo en `generatePurchaseOrder` rompe hábito de usuarios | Precios precargados del catálogo: el caso feliz es "confirmar y seguir", sin fricción nueva |
| `cancelPurchaseOrder` soft-cancel altera listados | La UI de costos ya filtra `cancelled`; revisar los demás listados de OC en la implementación |
