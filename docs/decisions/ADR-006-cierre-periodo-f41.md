# ADR-006 — F4.1: cierre de período (soft-lock del ledger)

**Fecha:** 2026-07-28
**Estado:** Aceptado
**Decisores:** Steven Nuñez (dispone) + Chief Software Architect IA (propone)
**Documentos relacionados:** RFC-002 §"Cierre de período", RFC-002-F4-Plan, ADR-002…005

## Contexto

F0–F3 construyeron un ledger inmutable *por hecho*, pero el **pasado seguía siendo
mutable en conjunto**: nada impedía que un hecho fechado en enero naciera en julio y
cambiara un margen ya reportado al mandante. Los materializadores lo hacen de forma
rutinaria —el cron de MO reconcilia una ventana de 35 días hacia atrás—, así que no es
un riesgo teórico.

## Decisiones

1. **El guard vive en la base, no en los emisores.** Trigger `BEFORE INSERT` sobre
   `finance_entries`. Hay nueve emisores y dos crons: congelar el pasado no puede
   depender de que todos recuerden chequear, ni de que el próximo emisor lo sepa.
   Aplica también al **service role** — el cron es justamente quien más va a toparlo, y
   un cierre que no lo alcanza sería decorativo.
2. **Rechazar y reportar, no redirigir ni silenciar** (Steven, D1). Se descartaron:
   *redirigir* el hecho al período abierto (mentiría sobre cuándo ocurrió y dejaría el
   mes cerrado permanentemente incompleto) y *acotar la ventana del cron* (lo no
   devengado desaparecería sin que nadie se entere). Los materializadores apartan las
   filas bloqueadas, emiten el resto y devuelven `blocked` + meses afectados.
3. **Eventos append-only, no un estado editable.** `finance_period_events` con
   `close`/`reopen`; el estado vigente de un mes es su último evento. Cerrar → reabrir →
   cerrar queda completo, con autor y motivo. Reabrir **exige** motivo: deshace la
   garantía de que el histórico no cambia, y esa decisión lleva nombre.
4. **Chequeo previo, informativo y no bloqueante.** Cerrar sobre datos incompletos es
   peor que no cerrar. `finance_period_precheck` reporta: asistencia sin sueldo base
   (esa MO no está en el ledger), ciclos de arriendo vencidos sin devengar, EP aprobados
   sin cobrar, y meses anteriores todavía abiertos —cerrar julio con junio abierto hace
   que el "histórico cerrado" sea ilusorio—. El usuario decide; simplemente no decide a
   ciegas.
5. **El presupuesto no se bloquea.** `finance_budget_entries` es intención, no un hecho
   ocurrido: se replanifica hacia adelante aunque el mes esté cerrado (ADR-005 §4).
6. **Sin permiso nuevo.** `finance:manage` ya declaraba *"Administrar Finanzas
   (presupuestos, **cierres**)"*.

## Detalle no obvio que casi rompe los crons

El INSERT de los materializadores va en **lotes de 500**. Como el trigger aborta la
sentencia completa, una sola fila en mes cerrado habría tumbado la reconciliación entera
del tenant —fallando fuerte y a diario, no en un caso raro—. Por eso las filas se apartan
**antes** del lote (`splitByClosedPeriod`), no reaccionando al error.

## Consecuencias

- Los reportes históricos dejan de ser mutables: es lo que le da valor a todo F0–F3.
- La regla de "qué mes está cerrado" existe dos veces —SQL (`is_period_closed`) y
  TypeScript (`closedMonthsFromEvents`, con tests)—. Es duplicación consciente: el guard
  debe estar en la base y la UI no puede consultarla por cada fila. **Si una cambia, la
  otra también.**
- El caso (c) del precheck (EP aprobados sin cobrar) quedó implementado pero **no
  ejercitado** en el E2E: es severidad `info` y no bloquea nada. Verificarlo si se toca.
- Deuda consciente: no hay cierre *anual* ni bloqueo por rango libre; el período es
  mensual, como fija RFC-002.
