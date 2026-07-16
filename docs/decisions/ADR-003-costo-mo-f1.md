# ADR-003 — Costo de mano de obra (F1): materialización por cron

**Fecha:** 2026-07-16
**Estado:** Aceptado
**Decisores:** Steven Nuñez (dispone) + Chief Software Architect IA (propone)
**Documentos relacionados:** RFC-002, RFC-002-F1-Plan, ADR-002

## Contexto

F1 emite el costo devengado de mano de obra desde la asistencia. A diferencia de compras
(documentos con transiciones de estado nítidas), el "día trabajado" es una **derivación** de
un stream de marcas in/out que se edita retroactivamente (`updateAttendanceLog`,
`deleteAttendanceLog`, correcciones del guardia). El patrón F0 "emisor dentro de la
mutación" no calza: el costo del día no se conoce hasta que el día cierra.

## Decisiones

1. **Modelo: solo días asistidos** (Steven): `presencia × sueldo/30 × factor`. Sesgo
   conocido y documentado: subcuenta el costo real en turnos rotativos (descansos pagados no
   devengan). Rechazados: "asistidos + descansos del ciclo" (exige turnos perfectamente
   configurados para todos) y "devengo calendario" (la asistencia dejaría de mandar el monto,
   contradice la decisión del RFC).
2. **Materialización por cron diario con ventana de reconciliación (35 días)**, no
   emisor-en-mutación. El cron materializa días CERRADOS (hoy en America/Santiago excluido) y
   re-verifica la ventana: si marcas/sueldo/factor cambiaron, reverso + re-emisión
   automáticos. Idempotente. Rechazado: emisor por marca (N marcas = N recomputaciones de un
   día aún abierto; ciego a ediciones directas en BD).
3. **Presencia = ≥1 marca 'in' en el día.** El pareo in/out es para horas, no para presencia;
   una salida olvidada no borra el costo del día. Divergencia posible (leve) con el
   `workedDays` del reporte de asistencia: se reporta, no se esconde.
4. **Sin sueldo base ⇒ sin hecho + alerta** (Steven). No se emiten hechos $0. La alerta en el
   panel es del mismo tipo que "Sin contrato": calidad de dato visible y gestionable.
5. **Contrato del día = el de la primera marca 'in'** (el scan lo resolvió en el momento vía
   `contract_workers`). Sin contrato en la marca ⇒ "Sin contrato"; no se adivina
   retroactivamente con la asignación actual.
6. **Espejos de reverso insertados directo por el materializador** (service role): el RPC
   `finance_reverse_source` exige `auth.uid()` y el cron no tiene usuario. Misma semántica
   (espejo negativo por grupo, `reversal_of`, `entry_date` = hoy), lógica pura testeada en
   `financeMath.ts`. El esquema sigue sin conceder UPDATE/DELETE a nadie (Art. 2).
7. **Autor de sistema**: hechos con `created_by_name = 'Sistema (costo MO)'` y
   `created_by = NULL`. El Art. 5 ("todo hecho lleva autor") se satisface con autoría
   explícita del proceso — el dato de origen (la marca) sí conserva su autor humano.
8. **Sueldo/factor vigentes rigen la ventana**: un cambio de sueldo re-refleja los últimos
   35 días; más allá, el hecho queda congelado. No hay historial de sueldos (limitación
   documentada; corrección fuera de ventana = decisión manual futura).
9. **Solo día-persona en F1** (Steven): horas extra (sueldo/180 × 1.5 × factor) en una
   iteración posterior corta, con el día-persona ya probado en terreno.

## Consecuencias

- Primer emisor del ledger que NO vive en una mutación: los módulos con hechos derivados
  (no documentales) usan el patrón materializador-con-ventana. Candidatos futuros: consumo
  de pañol (F2), ciclos de arriendo.
- Los hechos de MO revelan sueldos individuales (`amount_net × 30 / factor`): la visibilidad
  cerrada de ADR-002 §5 (`is_finance_viewer`) pasa de prudente a obligatoria.
- El cron corre para TODOS los tenants (service role); el respaldo manual
  (`/api/finance/labor-refresh`) solo para el tenant del admin que lo invoca.
