# ADR-005 — F3: presupuesto de costo por contrato

**Fecha:** 2026-07-16
**Estado:** Aceptado
**Decisores:** Steven Nuñez (dispone) + Chief Software Architect IA (propone)
**Documentos relacionados:** RFC-002, RFC-002-F3-Plan, ADR-002/003/004

## Contexto

El panel de Finanzas ya muestra costos (F0-F2) e ingresos/margen (F2), pero sin
referencia: no dice si un contrato va bien o mal. F3 agrega el presupuesto de COSTO.
En el sistema ya existían dos "presupuestos" que NO son este: `CostCenter.budget`
(compras por centro administrativo — queda como está, RFC-002) y
`WorkItem.unitPrice×quantity` (presupuesto de VENTA al mandante).

## Decisiones

1. **Granularidad de captura: contrato × categoría** (Steven). Los hechos del ledger
   llevan contrato y categoría pero NO partida (eso llega cuando work-reports
   distribuya HH×OT): capturar por partida hoy sería detalle incontrastable.
   La entidad deja `work_item_id` nullable para esa evolución (F5/EVM).
2. **Solo CLP en v1** (Steven). Sin moneda origen ni tasa en las líneas de
   presupuesto; UF se agrega si duele (los HECHOS sí siguen guardando UF, ADR-002).
3. **Versionado = append-only** (mismo ADN del ledger, Art. 2): la tabla
   `finance_budget_entries` solo INSERTa. Línea inicial + modificaciones
   (aumentos/rebajas con MOTIVO obligatorio y autor); presupuesto vigente = SUM.
   El historial de modificaciones presupuestarias —la pregunta original de
   RFC-001— sale gratis.
4. **El presupuesto NO es un hecho económico**: tabla propia, jamás entra a
   `finance_entries` (comprometido/devengado/pagado registran realidad; el
   presupuesto es intención).
5. **Visibilidad**: SELECT e INSERT solo para visores financieros
   (`is_finance_viewer()` — el presupuesto revela estructura de costos); en el
   cliente, editar exige `finance:manage` (permiso ya existente de F0).
6. **Convenciones del panel**: disponible = presupuesto − comprometido;
   % ejecución = devengado / presupuesto. La comparación vive en
   `/dashboard/finanzas/presupuesto` (el panel principal conserva su foco en
   margen y enlaza allí).
7. **Carga**: manual (diálogo) + importación Excel/CSV (papaparse, patrón
   existente) con columnas Contrato | Categoría | Monto | Motivo.

## Consecuencias

- El panel puede responder "¿cómo vamos contra el plan?" por contrato y categoría,
  la mitad que faltaba de "presupuesto vs real" del RFC-001.
- Deuda consciente: presupuesto por partida y su comparación (requiere hechos con
  `work_item_id`); APU como generador (fase posterior, RFC-002).
