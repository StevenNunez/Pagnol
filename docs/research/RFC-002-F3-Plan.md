# RFC-002 — Plan F3: Presupuesto de costo

**Estado:** Aprobado (decisiones de Steven, 2026-07-16) — en ejecución
**Documentos:** RFC-002 (arquitectura), ADR-005 (decisiones F3)

## Objetivo

Darle referencia al margen: presupuesto de costo por **contrato × categoría**
(decisión ADR-005 §1) comparado contra comprometido/devengado/pagado del ledger.

## Piezas

1. **Migración** `20260723020000_finance_budget.sql`: tabla `finance_budget_entries`
   append-only (id, tenant_id, contract_id FK, category CHECK de categorías de costo,
   `work_item_id` nullable para el futuro, amount_net numeric — negativo = rebaja,
   reason text NOT NULL, created_by/name, created_at). RLS: SELECT/INSERT solo
   `is_finance_viewer()`; sin UPDATE/DELETE ni sus GRANTs (Art. 2). Índice
   (tenant_id, contract_id).
2. **Dominio**: interface `FinanceBudgetEntry` + `budgetMutations.ts`
   (`addBudgetEntry` con guard `finance:manage`) + helper puro `budgetRollup`
   en financeMath (+tests): vigente por contrato×categoría, disponible y % ejecución.
3. **UI** `/dashboard/finanzas/presupuesto`: tabla presupuesto | comprometido |
   devengado | pagado | disponible | % ejecución por contrato (expandible a
   categoría), diálogo "línea inicial / modificación" (motivo obligatorio) con
   historial, e importación CSV/Excel (papaparse: Contrato | Categoría | Monto |
   Motivo). Botón "Presupuesto" en la toolbar del panel Finanzas.
4. Lectura de líneas: select directo RLS-protegido en la página (tabla pequeña,
   sin DataProvider — patrón del panel F0).

## Qué NO hace F3

Presupuesto por partida (los hechos aún no llevan `work_item_id` — ADR-005 §1);
UF en líneas de presupuesto (§2); APU (fase posterior); flujo de caja y cierre
mensual (F4).
