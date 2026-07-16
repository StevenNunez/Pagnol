# RFC-002 — Plan F1: Costo de Mano de Obra

**Estado:** Ejecutado y verificado E2E (2026-07-16, tenant DEMO). La verificación
descubrió y reparó un drift preexistente de `attendance_logs` (el registro de
asistencia estaba 100% roto en la BD viva — migración `20260723000000`, aplicada)
**Documentos:** RFC-002 (arquitectura), ADR-002 (convenciones F0), ADR-003 (decisiones F1)

---

## Objetivo

El ledger financiero (F0) ya registra el ciclo de compras. F1 agrega el segundo costo más
grande de una faena: la **mano de obra**, devengada desde la asistencia biométrica que
Pagnol ya captura — el diferenciador del RFC-001 ("HH biométricas que nadie más tiene").

## Decisiones tomadas (Steven, 2026-07-16)

1. **Modelo del día-persona: solo días asistidos.** `día con presencia × (sueldo base / 30)
   × factor costo-empresa`. Fiel a la decisión del RFC ("asistencia manda el monto").
   **Sesgo documentado:** subcuenta el costo real en turnos rotativos (los descansos pagados
   no devengan — un 14x14 perfecto devenga ~50% del sueldo). Sirve para comparar contratos
   entre sí; el ajuste de cierre mensual podrá llegar en F3/F4 con el presupuesto.
2. **Materialización por cron diario + reconciliación**, no emisor-en-mutación. El día-persona
   es una *derivación* de marcas in/out que se editan retroactivamente; el costo del día no se
   conoce hasta que el día cierra. El cron materializa el día cerrado y re-verifica una ventana
   móvil (35 días): si las marcas, el sueldo o el factor cambiaron, emite reverso + hecho
   corregido. Desviación consciente del patrón F0, registrada en ADR-003.
3. **Sin sueldo base ⇒ no se emite hecho** (no se inventa un costo $0) **+ alerta de calidad
   de dato** en el panel: "N trabajadores con asistencia sin sueldo base". Al configurar el
   sueldo, la reconciliación emite los días pendientes de la ventana.
4. **Solo día-persona en F1.** Horas extra (sueldo/180 × 1.5 × factor) quedan para una
   iteración corta posterior, cuando el día-persona esté probado en terreno.

## Especificación del hecho

| Campo | Valor |
|---|---|
| `source_type` / `source_id` | `labor_day` / `{userId}:{yyyy-MM-dd}` |
| `nature` / `stage` / `category` | cost / **accrued** / **labor** |
| `amount_net` | `round(baseSalary / 30 × labor_cost_factor)` |
| `entry_date` | el día trabajado (aunque se materialice después) |
| `contract_id` | el de la **primera marca 'in' del día** (el scan ya lo resuelve vía `contract_workers`); sin él ⇒ "Sin contrato" (alerta, no se adivina retroactivamente) |
| `counterparty` | worker / userId / nombre |
| `created_by_name` | `Sistema (costo MO)` (autor de sistema; Art. 5 se satisface con autoría explícita del proceso) |

**Presencia** = el día tiene ≥1 marca `'in'` (una presencia verificada por el guardia es
presencia; el pareo in/out es para horas, no para presencia). Puede divergir levemente del
`workedDays` del reporte de asistencia (que exige par con horas > 0) — se reporta, no se
esconde (RFC-002, riesgos).

## Reconciliación (idempotente)

Para cada `(trabajador, día)` en la ventana [hoy−35, ayer] — unión de días con marcas y
días con hechos vivos:

```
esperado = presencia && sueldo>0 ? { monto: round(sueldo/30 × factor), contrato } : ∅
vivo     = Σ hechos labor_day de esa fuente, agrupados por contrato
si vivo == esperado → no-op
si no → espejos negativos por grupo (reversal_of al primer id del grupo,
        entry_date = hoy, mismo patrón que finance_reverse_source)
        + hecho nuevo si esperado > 0
```

- El RPC `finance_reverse_source` NO es invocable por el cron (exige `auth.uid()`); el
  materializador construye los espejos con la misma semántica vía lógica pura testeada
  (`financeMath.ts`) e inserta con service role (INSERT-only: el esquema sigue sin permitir
  UPDATE/DELETE a nadie).
- Sueldo y factor **vigentes** rigen dentro de la ventana (un cambio de sueldo re-refleja los
  últimos 35 días); más allá de la ventana el hecho queda congelado.
- "Hoy" se calcula en **America/Santiago**: nunca se materializa un día aún abierto.

## Piezas

1. `financeMath.ts` (+tests): `laborDayCost`, `laborDaySourceId`, `reconcileLaborDay`
   (decisión pura no-op / rewrite con espejos).
2. `src/lib/labor-cost.ts` (server-only): `materializeLaborForTenant(admin, tenant, opts)` —
   consulta paginada de marcas/hechos, aplica la reconciliación, inserta en lotes; devuelve
   stats (emitidos, reversados, sin-sueldo, sin-contrato).
3. `/api/cron/labor-cost` (GET, CRON_SECRET fail-closed): itera todos los tenants.
   `vercel.json`: `0 6 * * *` (≈02:00–03:00 Chile, día ya cerrado).
4. `/api/finance/labor-refresh` (POST, admin del tenant): respaldo manual, patrón uf-refresh.
5. Panel `/dashboard/finanzas`: alerta "asistencia sin sueldo base" (derivada client-side de
   `users` + `attendanceLogs` del rango) + botón "Recalcular MO" (llama al respaldo manual).
   La categoría **Mano de obra** ya se despliega en el rollup existente (F0).

**Sin migración SQL**: la categoría `labor`, `counterparty_type='worker'`, `entry_date`
retroactivo y `labor_cost_factor` ya existen desde F0.

## Qué NO hace F1

- Horas extra (F1.5), distribución a partidas vía HH×OT (cuando work-reports se cruce, F2+),
  ajuste de cierre mensual al sueldo real (F3/F4), historial de sueldos (limitación
  documentada de la ventana).
