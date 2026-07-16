# RFC-002 — Plan F2: Ingresos y emisores restantes

**Estado:** Aprobado (decisiones de Steven, 2026-07-16) — en ejecución
**Documentos:** RFC-002 (arquitectura), ADR-002/003 (convenciones F0/F1), ADR-004 (decisiones F2)

---

## Objetivo

El ledger ya registra compras (F0) y mano de obra (F1) — puro costo. F2 agrega el **lado
INGRESOS** (estado de pago → devengado/cobrado) y los emisores de costo restantes
(**arriendos** y **consumo de pañol**), con lo que el panel puede por fin mostrar
**margen por contrato** — el diferenciador del RFC-001.

## Decisiones tomadas (Steven, 2026-07-16)

1. **Puente WBS↔contratos: `contract_id` en la raíz del WBS** (work_item tipo obra).
   Selector al crear/editar la obra en Control de Obra; el EP lo hereda solo. Deja listo
   F3/F5 (presupuesto vs real, EVM por contrato).
2. **Cobro manual con fecha en v1**: botón "Marcar cobrado" sobre el EP aprobado. El
   backend DTE podrá automatizarlo después.
3. **Alcance = F2 completa del RFC**: ingresos + arriendos + consumo de pañol…
4. **…excepto mantenciones: DIFERIDA con ADR** (ADR-004 §6). `total_cost`/`parts_used`
   son digitación libre que no mueve stock; sus componentes reales ya los capturan
   MO (F1) y consumo de pañol (F2) — emitir duplicaría.

## Hallazgos de la crítica (estado actual)

- 🔴 **Drift #4: generar EP está 100% roto en la BD viva** — `payment_states` no tiene
  `total_value` ni `earned_value` (las columnas que `addPaymentState` inserta → PGRST204).
  Tabla con 0 filas: la migración F2 la completa sin migrar datos.
- El EP no tiene `contract_id`; su "contrato" es el work_item raíz, que tampoco tiene FK
  a `contracts`. Sin puente no hay margen por contrato.
- El EP guarda `earnedValue` ACUMULADO → devengarlo por EP duplica (EP2 contiene EP1).
  El hecho de ingreso es el **delta del período**, congelado al crear el EP.
- No existe máquina de estados (nada transita pending→approved→paid) ni permisos del
  módulo, ni correlativo, ni anulación.
- `rental_contracts` no tiene imputación a contrato cliente (las solicitudes de arriendo
  SÍ traen `contract_id` — se hereda al adjudicar).

## Diseño

### A. Ingresos desde Estado de Pago

**Migración** (una sola para F2): `work_items.contract_id` (FK contracts, SET NULL);
`payment_states` += `total_value`, `earned_value` (reparación drift), `contract_id`,
`contract_name` (snapshot), `internal_code` (correlativo `EP`), `previous_earned`,
`period_earned` (congelados al crear), `approved_at/by/by_name`, `paid_at/by`,
`annulled_at/by`, `notes`; status CHECK `pending|approved|paid|annulled`; check de
categoría del ledger += `'revenue'`.

**Flujo:**
- **Crear EP** (existente, reparado): calcula `previous_earned` = acumulado del último EP
  vivo (no anulado) del contrato; `period_earned = earned_value − previous_earned`;
  bloquea si ≤ 0 ("no hay avance nuevo que cobrar"). Hereda `contract_id` de la raíz WBS.
- **Aprobar** (`payment_states:approve`, nuevo permiso; ADC + admin/soporte por bypass) →
  emite **ingreso devengado**: `nature='income', stage='accrued', category='revenue'`,
  `amount_net = period_earned`, source `payment_state/{id}`, contraparte = cliente del
  contrato.
- **Marcar cobrado** (`payment_states:pay`) → **ingreso pagado** (mismo monto, fecha
  digitada como `entry_date`).
- **Anular** → soft-annul + `finance_reverse_source` (patrón F0). Aprobado o cobrado:
  reversa todo lo vivo del documento.

**Panel finanzas:** filas income + columna **Margen** (ingreso devengado − costo
devengado) y **% margen** por contrato; KPI Ingresos del período.

### B. Arriendos (categoría `rental`, dirección lease-in = costo)

**Migración:** `rental_contracts.client_contract_id` (FK contracts, SET NULL) — se
precarga desde la solicitud de arriendo al adjudicar; editable en la ficha.

- **OC confirmada** (`confirmRentalOc`) → **comprometido** = Σ calendario de pagos ya
  generado (`rental_payments` del contrato). UF/USD → CLP congelado con la tasa del día
  (uf_rates; USD queda 1:1 documentado hasta que exista tasa — igual que F0).
- **Ciclo vencido** → **devengado**: materializador diario (patrón ADR-003, ya
  anticipado ahí para "ciclos de arriendo"): rental_payment con `due_date ≤ ayer` ⇒
  hecho devengado por el monto del ciclo; idempotente por source `rental_payment/{id}`;
  ventana 35 días; se cuelga del cron existente `/api/cron/labor-cost` (renombrado
  conceptualmente a "devengos diarios" — misma URL para no tocar vercel.json/prod).
- **Pago marcado** (`markRentalPaymentPaid`) → **pagado**. Des-marcar/editar/eliminar
  pago → reverso del hecho pagado (y del devengado si el ciclo se elimina).
- **Cerrar contrato / anular OC** → reverso del comprometido restante (espejo del
  comprometido − ciclos ya devengados… v1 simple: reverso total del comprometido vivo y
  re-emisión por lo efectivamente devengado — ver ADR-004 §4).

### C. Consumo de pañol (categoría `materials`)

Anti-doble-conteo (regla RFC-002 validada): la compra ya devenga al contrato cuando la
OC está imputada (F0). El consumo devenga SOLO la porción que sale del **pool central**
hacia un contrato — y `consumeFromLedger` ya devuelve exactamente de dónde salió cada
unidad (`sources`).

- **Entrega de solicitud** (2 rutas en `materialRequestMutations`): para cada ítem
  **consumible** (`usage_type='consumible'`) entregado a un contrato, emitir devengado
  `qty_del_pool × unitCost` (source `material_request/{internal_code}`, dimensión
  contrato). Herramientas/activos NO devengan (préstamo, no consumo).
- **Transferencia entre contratos** (`transferMaterialStock`): hecho negativo al origen +
  positivo al destino (consumibles; mismo monto qty × unitCost).
- **Devoluciones: sin emisor.** Reingresan a la misma dimensión registrada en la
  devolución (el costo ya vive ahí). El costo `materials` de un contrato = unidades que
  viven en él — convención estándar de obra (ADR-004 §8).

### D. Mantenciones — NO emite en F2 (ADR-004 §6)

## Piezas

1. Migración `2026...._finance_f2.sql` (todo lo anterior + índices) — la aplica Steven.
2. `financeMath.ts` (+tests): `epPeriodEarned` (delta y guardas), `rentalCommitTotal`,
   `poolPortionOfSources` (porción pool de un consumo).
3. Emisores: `paymentStateMutations.ts` (nuevo — crear/aprobar/cobrar/anular),
   `rentalMutations.ts` (confirmar OC, pago, ciclos en `src/lib/finance-accruals.ts`
   junto a labor), `materialRequestMutations.ts` + `warehouseMutations.ts` (consumo).
4. Cron: `materializeRentalAccrualsForTenant` se suma al route handler de
   `/api/cron/labor-cost` y al respaldo manual labor-refresh (mismo botón del panel,
   renombrado "Recalcular devengos").
5. UI: selector de contrato en crear/editar obra (Control de Obra); acciones
   aprobar/cobrar/anular en `estado-pago/historial`; imputación en ficha de arriendo;
   panel finanzas con ingresos y margen.
6. Permisos: `payment_states:approve` / `payment_states:pay` (grupo Estado de Pago;
   default ADC además del bypass admin).

## Qué NO hace F2

Mantenciones (diferida, ADR-004 §6); tesorería/conciliación (nunca — RFC-002);
presupuesto por partida y cierre mensual (F3/F4); distribución de ingreso a partidas
(el EP ya trae items, la dimensión partida del ingreso queda para F3 con el
presupuesto); DTE (cuando exista backend, automatiza "cobrado").
