# ADR-004 — F2: ingresos por EP, arriendos y consumo de pañol

**Fecha:** 2026-07-16
**Estado:** Aceptado
**Decisores:** Steven Nuñez (dispone) + Chief Software Architect IA (propone)
**Documentos relacionados:** RFC-002, RFC-002-F2-Plan, ADR-002, ADR-003

## Contexto

F2 agrega el lado ingresos (estado de pago) y los emisores de costo restantes. El módulo
estado-pago existente no tenía máquina de estados ni vínculo con `contracts`, y la BD
viva tenía su tabla rota (drift #4: sin `total_value`/`earned_value`). El WBS de Control
de Obra es un mundo paralelo sin FK a `contracts`.

## Decisiones

1. **Puente WBS↔contratos en la raíz** (Steven): `work_items.contract_id` solo se usa en
   la raíz de la obra; el EP lo hereda. Rechazado: selector por-EP (el WBS seguía
   huérfano y cada EP repetía la elección).
2. **El ingreso devengado es el DELTA del período**, congelado al crear el EP
   (`previous_earned` + `period_earned`). El acumulado (`earned_value`) se conserva como
   dato del documento, pero JAMÁS se devenga (duplicaría los EP anteriores). Un EP sin
   avance nuevo (delta ≤ 0) no puede crearse.
3. **Cobro manual con fecha** (Steven): "Marcar cobrado" emite el ingreso pagado con la
   fecha digitada. DTE lo automatizará cuando exista backend.
4. **Comprometido de arriendo = Σ del calendario de pagos generado** (no una proyección
   infinita): contratos sin fecha fin comprometen exactamente los ciclos que su
   calendario tiene. Cierre/anulación: reverso de todo lo vivo del contrato de arriendo
   como fuente + los ciclos ya devengados se mantienen (costo real incurrido); v1 acepta
   este orden de aproximación.
5. **Ciclos de arriendo devengan por materializador diario** (patrón ADR-003, que ya
   los anticipaba): `due_date ≤ ayer` ⇒ devengado, idempotente por
   `rental_payment/{id}`, ventana 35 días, mismo cron diario que MO (misma URL
   `/api/cron/labor-cost` para no tocar prod).
6. **Mantenciones NO emiten en F2** (Steven): `total_cost`/`parts_used` son digitación
   libre que no consume stock; la MO del mantenedor ya la devenga F1 y los repuestos
   que salen de bodega los devenga el consumo de pañol. Emitir duplicaría. Iniciativa
   futura: conectar `parts_used` al stockLedger y emitir solo el costo EXTERNO
   (servicios de terceros) — requiere su propio diseño.
7. **Anti-doble-conteo de materiales** (regla RFC-002, implementable hoy): la compra
   devenga al contrato si la OC venía imputada (F0); la entrega de pañol devenga SOLO la
   porción que `consumeFromLedger` sacó del pool central. Una unidad nunca costea dos
   veces. Solo consumibles (`usage_type='consumible'`): herramientas y activos se
   PRESTAN, no se consumen.
8. **El costo de materiales sigue a las unidades entre dimensiones** con hechos propios
   (negativo origen / positivo destino), no con reversos: entregas con origen en otra
   dimensión y transferencias entre contratos emiten el par. Las devoluciones NO emiten:
   reingresan a la misma dimensión registrada en la devolución (el costo ya vive ahí).
   Corolario: el costo `materials` de un contrato = unidades que viven en él (en bodega
   de faena o consumidas), la convención estándar de obra ("cargado al enviarse a faena").
9. **Categoría `revenue`** para hechos de ingreso (el CHECK de `finance_entries` se
   extiende). Las categorías existentes siguen siendo taxonomía de costo.
10. **Permisos**: `payment_states:approve` y `payment_states:pay`, default al rol ADC
    (administra el contrato) además del bypass admin/soporte-pagnol.

## Consecuencias

- El panel puede mostrar **margen por contrato** (ingreso devengado − costo devengado):
  primer entregable visible de la apuesta estratégica del RFC-001.
- El materializador diario pasa de "costo MO" a "devengos diarios" (MO + ciclos de
  arriendo); futuros devengos por calendario se suman ahí.
- La reparación del drift #4 revive el módulo estado-pago completo (crear EP estaba
  roto en la BD viva).
- Queda deuda documentada: costo de mantención externa (§6) y distribución del ingreso
  a partidas (F3).
